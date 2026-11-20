/* ============================================================================
   STARSHIP & SUPER HEAVY — 3D FLIGHT SIMULATOR
   File 6/6: js/main.js
   Pengendali utama aplikasi:
   - Mesin fisika roket dunia nyata (Tsiolkovsky, gravitasi ketinggian, Max-Q, TVC)
   - Urutan separasi presisi: Booster terlepas dulu (00:02:22) sebelum Raptor Starship menyala (00:02:23.2)
   - Implementasi penuh Countdown & Flight Timeline resmi SpaceX (hingga 09:50:30)
   - Pendaratan paralel Booster di Pad Laut ASDS & 1x Orbit Bumi 360° -> Mechazilla Catch
   - Kamera Orbit Bumi anti-bug & Dual Live Monitor (Multi-Viewport WebGL PiP)
   - Interaksi UI, Pad Gimbal X/Y, Keyboard WASD/T/Space/P, Cluster & Mini-Map
   ============================================================================ */

import * as THREE from 'three';
import {
  PHYSICS,
  WORLD_COORDS,
  SPECS,
  TIMELINE,
  TIMELINE_EVENTS,
  sim,
  mechazilla,
  camState,
  isShipInOrbitalScene,
  getOceanWaveHeight
} from './config.js';
import {
  initAudio,
  setAudioEnabled,
  updateAudio,
  playIgnitionBoom,
  playSonicBoom,
  playMechanicalClank
} from './audio.js';
import {
  world,
  buildWorld,
  applyBoosterEngineVisuals,
  applyShipEngineVisuals,
  applySkyForAltitude,
  renderFlightView,
  toggleGoogleWorld,
  updateGoogleWorld,
  computeOrbitalCameraFrame,
  spawnStarlinkSatellite,
  clearStarlinkSats
} from './world.js';

// Cache referensi elemen DOM agar pembaruan HUD 60 FPS tetap ringan
const ui = {};
let toastTimer = null;
let lastTimelineRenderTick = -1;

// ============================================================================
// 1. UTILITAS FORMAT & NOTIFIKASI TOAST
// ============================================================================
function showToast(title, msg) {
  if (!ui.toast) return;
  ui.toastTitle.textContent = title;
  ui.toastMsg.textContent = msg;
  ui.toast.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    ui.toast.style.opacity = '0';
  }, 5200);
}

function formatMissionClock(sec) {
  const sign = sec < 0 ? 'T- ' : 'T+ ';
  const abs = Math.abs(sec);
  const hrs = Math.floor(abs / 3600).toString().padStart(2, '0');
  const mins = Math.floor((abs % 3600) / 60).toString().padStart(2, '0');
  const secs = Math.floor(abs % 60).toString().padStart(2, '0');
  return `${sign}${hrs}:${mins}:${secs}`;
}

function formatAlt(meters) {
  if (meters >= 10000) return `${(meters / 1000).toFixed(1)} km`;
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${Math.round(meters)} m`;
}

// ============================================================================
// 2. MESIN FISIKA ROKET & SEKUENS PENERBANGAN RESMI SPACEX
// ============================================================================

/**
 * Separasi Tahap (00:02:22):
 * Super Heavy Booster terpisah lebih dulu secara fisik, sementara 6 mesin Raptor Starship
 * tetap padam hingga jarak aman tercapai (00:02:23.2).
 */
function triggerStageSeparation() {
  if (sim.staged) return;
  sim.staged = true;
  sim.mecoTriggered = true;
  sim.shipIgnitedAfterSep = false;

  const b = sim.booster;
  const s = sim.ship;
  const upDir = new THREE.Vector3(0, 1, 0).applyQuaternion(b.quat);

  // Dorongan mekanis pegas/pneumatik memisahkan Starship dan Booster
  s.pos.copy(b.pos).addScaledVector(upDir, SPECS.boosterHeight + SPECS.interstageHeight);
  const shipMass = SPECS.sDryMass + s.mainProp + s.headerProp;
  const boosterMass = SPECS.bDryMass + b.mainProp + b.headerProp;
  const separationImpulse = shipMass * 2;
  s.vel.copy(b.vel).addScaledVector(upDir, separationImpulse / shipMass);
  s.quat.copy(b.quat);
  s.activeEngines = 0;
  s.throttle = 0;

  // Booster mundur lembut dan mulai manuver Flip (00:02:22 -> 00:02:27)
  b.vel.addScaledVector(upDir, -separationImpulse / boosterMass);
  b.activeEngines = 0;
  b.throttle = 0;
  b.angVel.set(0, 0, 0.42);
  b.phase = 'SEPARATED — FLIP MANEUVER';
  s.phase = 'SEPARATED — SIAP IGNITION';

  applyBoosterEngineVisuals(0, 0, 1.0);
  applyShipEngineVisuals(0, 0, 0, 1.0);
  world.boosterEngineLight.intensity = 0;
  world.shipEngineLight.intensity = 0;

  playMechanicalClank(95);
  camState.shake = Math.max(camState.shake, 1.15);
  showToast(
    'BOOSTER SEPARATION (00:02:22)! 🚀',
    'Super Heavy terlepas lebih dulu! Starship menyalakan 6 Raptor setelah jarak aman tercapai.'
  );
}

// Semi-implicit rigid-body landing step. Guidance commands forces/torques,
// never a position curve. Body +Y thrust matches the actual nozzle pivots.
function integrateLanding(v, dt, ship) {
  const targetY = ship ? WORLD_COORDS.SHIP_CAUGHT_BASE_Y : WORLD_COORDS.BOOSTER_CAUGHT_BASE_Y;
  const dry = ship ? SPECS.sDryMass : SPECS.bDryMass;
  const height = ship ? SPECS.shipHeight : SPECS.boosterHeight;
  const mass = dry + v.headerProp;
  const single = ship ? SPECS.sSingleSLThrust : SPECS.bMaxThrust / 33;
  const gap = Math.max(0, v.pos.y - targetY);
  const gravity = PHYSICS.G0 * (PHYSICS.EARTH_RADIUS / (PHYSICS.EARTH_RADIUS + Math.max(0, v.pos.y))) ** 2;
  const aligned = Math.hypot(v.pos.x, v.pos.z) < 0.4 && Math.hypot(v.vel.x, v.vel.z) < 0.2;
  const desiredVy = gap < 18 && !aligned
    ? THREE.MathUtils.clamp((12 - gap) * 0.5, -1, 2)
    : -Math.min(70, Math.max(0.45, Math.min(Math.sqrt(gap * 4), gap * 0.25)));
  const demand = new THREE.Vector3(
    THREE.MathUtils.clamp(-v.pos.x * 0.018 - v.vel.x * 0.3, -2, 2),
    Math.max(2, gravity + (desiredVy - v.vel.y) * 1.5),
    THREE.MathUtils.clamp(-v.pos.z * 0.018 - v.vel.z * 0.3, -2, 2)
  );
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(v.quat);
  const desiredQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), demand.clone().normalize());
  const error = v.quat.clone().invert().multiply(desiredQ);
  if (error.w < 0) error.set(-error.x, -error.y, -error.z, -error.w);
  const angle = 2 * Math.acos(THREE.MathUtils.clamp(error.w, -1, 1));
  const axis = new THREE.Vector3(error.x, error.y, error.z).normalize();
  const angularAccel = axis.multiplyScalar(angle * (ship ? 4 : 1.2)).addScaledVector(v.angVel, ship ? -3.8 : -2.5);
  const requested = mass * demand.y / Math.max(0.35, up.y);
  const engines = ship ? (gap > 180 ? 3 : gap > 55 ? 2 : 1) : (requested > single * 2.85 ? 13 : 3);
  v.activeEngines = v.headerProp > 0 ? engines : 0;
  const capacity = single * v.activeEngines;
  const throttle = capacity ? THREE.MathUtils.clamp(requested / capacity, 0.25, ship && up.y < 0.85 ? 0.3 : 1) : 0;
  v.throttle += THREE.MathUtils.clamp(throttle - v.throttle, -dt * 3, dt * 3);
  if (!capacity) v.throttle = 0;
  const thrust = capacity * v.throttle;
  const inertia = mass * (height * height + 3 * 4.5 ** 2) / 12;
  const authority = Math.max(0.1, Math.max(thrust, requested * 0.6) * height * 0.5 / inertia);
  const max = PHYSICS.MAX_GIMBAL_RAD;
  const gx = sim.autoMode ? THREE.MathUtils.clamp(-angularAccel.x / authority, -max, max) : sim.manualGimbalX * max;
  const gz = sim.autoMode ? THREE.MathUtils.clamp(-angularAccel.z / authority, -max, max) : sim.manualGimbalY * max;
  v.gimbalX += THREE.MathUtils.clamp(gx - v.gimbalX, -dt * 0.7, dt * 0.7);
  v.gimbalY += THREE.MathUtils.clamp(gz - v.gimbalY, -dt * 0.7, dt * 0.7);
  const localForce = new THREE.Vector3(0, thrust, 0).applyEuler(new THREE.Euler(v.gimbalX, 0, v.gimbalY));
  const torque = new THREE.Vector3(0, -height * 0.5, 0).cross(localForce);
  v.angVel.addScaledVector(torque, dt / inertia);
  v.angVel.multiplyScalar(Math.exp(-0.12 * dt));
  // Roll stabilisation represents differential steering of the engine cluster.
  v.angVel.y += THREE.MathUtils.clamp(angularAccel.y, -0.08, 0.08) * dt;
  v.quat.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(v.angVel.x * dt, v.angVel.y * dt, v.angVel.z * dt))).normalize();
  const rho = PHYSICS.RHO0 * Math.exp(-Math.max(0, v.pos.y) / PHYSICS.SCALE_HEIGHT);
  const area = 32 + height * 9 * (1 - Math.abs(up.y));
  const force = localForce.applyQuaternion(v.quat).addScaledVector(v.vel, -0.5 * rho * area * v.vel.length());
  const accel = force.divideScalar(mass); accel.y -= gravity;
  v.vel.addScaledVector(accel, dt); v.pos.addScaledVector(v.vel, dt);
  v.headerProp = Math.max(0, v.headerProp - thrust / (327 * PHYSICS.G0) * dt);
  v.twr = thrust / (mass * gravity); v.gForce = force.clone().add(new THREE.Vector3(0, gravity, 0)).length() / PHYSICS.G0;
  v.q = 0.5 * rho * v.vel.lengthSq();
}

function stepBoosterCatch(dt) {
  const b = sim.booster;
  if (b.landed || b.failed) return;
  const previousY = b.pos.y;
  integrateLanding(b, dt, false);
  const gap = b.pos.y - WORLD_COORDS.BOOSTER_CAUGHT_BASE_Y;
  mechazilla.targetCarriageY = WORLD_COORDS.CATCH_RAIL_Y;
  mechazilla.targetArmAngle = 0.65 * THREE.MathUtils.smoothstep(gap, 10, 65);
  mechazilla.statusText = gap > 65 ? 'BOOSTER APPROACH' : 'MENYIAPKAN KONTAK PIN';
  b.phase = `TOWER LANDING · ${b.activeEngines} RAPTOR`;
  b.gridFinTilt = THREE.MathUtils.clamp(-b.vel.x * 0.012, -0.25, 0.25);
  applyBoosterEngineVisuals(b.activeEngines, b.throttle, 0);
  world.boosterEngineLight.position.copy(b.pos); world.boosterEngineLight.intensity = b.throttle * 60;
  if (previousY >= WORLD_COORDS.BOOSTER_CAUGHT_BASE_Y && gap <= 0) {
    if (Math.abs(b.vel.y) < 3 && pinsOnPads(b, world.boosterRoot, world.boosterCatchPins, 0.25)) {
      b.landed = true; b.phase = 'BOOSTER TERTANGKAP ✓';
      b.pos.y = WORLD_COORDS.BOOSTER_CAUGHT_BASE_Y;
      b.vel.set(0, 0, 0); b.angVel.set(0, 0, 0);
      b.activeEngines = 0; b.throttle = 0; b.twr = 0;
      mechazilla.statusText = 'BOOSTER CATCH ✓';
      applyBoosterEngineVisuals(0, 0, 0); world.boosterEngineLight.intensity = 0;
      playMechanicalClank(95);
      showToast('BOOSTER CATCH ✓', 'Kedua pin bertumpu pada bantalan; Raptor shutdown.');
    } else {
      b.failed = true; b.phase = 'CATCH TERLEWAT';
      sim.paused = true; ui.btnPause.textContent = '▶ Lanjut';
      showToast('Catch terlewat', 'Posisi, kemiringan, atau kecepatan kontak di luar toleransi. Ulangi latihan.');
    }
  }
}

/**
 * Fase Gabungan (Liftoff 00:00:00 -> Max-Q 00:00:58 -> MECO 00:02:20 -> Sep 00:02:22).
 */
function stepStackedAscent(dt) {
  const b = sim.booster;
  const s = sim.ship;
  const h = Math.max(0, b.pos.y - WORLD_COORDS.OLM_Y);
  const rho = PHYSICS.RHO0 * Math.exp(-h / PHYSICS.SCALE_HEIGHT);
  const g = PHYSICS.G0 * Math.pow(PHYSICS.EARTH_RADIUS / (PHYSICS.EARTH_RADIUS + h), 2);
  const vacFactor = THREE.MathUtils.clamp(1.0 - rho / PHYSICS.RHO0, 0, 1);

  let throttle = 1.0;
  let activeEngines = 33;

  if (sim.missionTime >= TIMELINE.T_MAXQ_START && sim.missionTime <= TIMELINE.T_MAXQ_END) {
    const dist = Math.abs(sim.missionTime - TIMELINE.T_MAXQ_PEAK) / 10.0;
    throttle = THREE.MathUtils.lerp(0.74, 1.0, Math.min(1, dist));
    b.phase = 'MAX-Q THROTTLE (00:58)';
    s.phase = 'MAX-Q THROTTLE (00:58)';
  } else if (sim.missionTime >= TIMELINE.T_MECO && sim.missionTime < TIMELINE.T_SEP) {
    if (!sim.mecoTriggered) {
      sim.mecoTriggered = true;
      showToast(
        'SUPER HEAVY MECO (00:02:20)',
        'Sebagian besar mesin Booster padam — bersiap melakukan Booster Separation pada 00:02:22.'
      );
    }
    // 30 mesin luar padam, 3 mesin tengah idle; mesin Starship masih mati hingga AFTER separation
    activeEngines = 3;
    throttle = 0.25;
    b.phase = 'MECO — SIAP SEPARASI';
    s.phase = 'SIAP SEPARASI BOOSTER';
    s.activeEngines = 0;
    s.throttle = 0;
  } else {
    b.phase = sim.missionTime > TIMELINE.T_PITCH_START ? 'GRAVITY TURN TIMUR' : 'PELUNCURAN VERTIKAL';
    s.phase = b.phase;
  }

  // Tepat pada T+00:02:22 -> Lepaskan Super Heavy Booster terlebih dahulu
  if (sim.missionTime >= TIMELINE.T_SEP) {
    triggerStageSeparation();
    return;
  }

  b.activeEngines = activeEngines;
  b.throttle = throttle;

  // Eastward Gravity Turn (+X Timur) otomatis atau manual TVC X/Y
  const targetPitchFromVert = sim.missionTime < TIMELINE.T_PITCH_START
    ? 0
    : THREE.MathUtils.clamp(((sim.missionTime - TIMELINE.T_PITCH_START) / 128.0) * 1.12, 0, 1.16);

  const upBody = new THREE.Vector3(0, 1, 0).applyQuaternion(b.quat);
  const currentPitchEast = Math.atan2(upBody.x, Math.max(0.001, upBody.y));

  if (sim.autoMode) {
    const pitchErr = targetPitchFromVert - currentPitchEast;
    const cmdZ = THREE.MathUtils.clamp(
      pitchErr * 0.7 + b.angVel.z * 1.8,
      -PHYSICS.MAX_GIMBAL_RAD,
      PHYSICS.MAX_GIMBAL_RAD
    );
    const cmdX = THREE.MathUtils.clamp(
      upBody.z * 0.7 + b.angVel.x * 1.8,
      -PHYSICS.MAX_GIMBAL_RAD,
      PHYSICS.MAX_GIMBAL_RAD
    );
    b.gimbalY = THREE.MathUtils.lerp(b.gimbalY, cmdZ, Math.min(1, dt * 8));
    b.gimbalX = THREE.MathUtils.lerp(b.gimbalX, cmdX, Math.min(1, dt * 8));
  } else {
    b.gimbalX = sim.manualGimbalX * PHYSICS.MAX_GIMBAL_RAD;
    b.gimbalY = sim.manualGimbalY * PHYSICS.MAX_GIMBAL_RAD;
  }

  // Persamaan Massa & Gaya Dorong Tsiolkovsky
  const totalMass = SPECS.bDryMass + b.mainProp + b.headerProp + SPECS.sDryMass + s.mainProp + s.headerProp;
  const thrustMag = b.mainProp > 0 ? SPECS.bMaxThrust * (activeEngines / 33) * throttle : 0;
  const isp = THREE.MathUtils.lerp(SPECS.bIspSL, SPECS.bIspVac, vacFactor);
  const mDot = thrustMag / (isp * PHYSICS.G0);
  b.mainProp = Math.max(0, b.mainProp - mDot * dt);

  const thrustLocal = new THREE.Vector3(
    -Math.sin(b.gimbalY),
    Math.cos(b.gimbalX) * Math.cos(b.gimbalY),
    Math.sin(b.gimbalX)
  ).normalize();
  const steerFraction = Math.min(activeEngines, 13) / activeEngines;
  const thrustWorld = thrustLocal.clone().multiplyScalar(steerFraction).addScaledVector(new THREE.Vector3(0, 1, 0), 1 - steerFraction).applyQuaternion(b.quat).multiplyScalar(thrustMag);

  // Torsi Rotasi TVC & Redaman SAS
  b.angVel.x -= Math.sin(b.gimbalX) * 0.65 * dt;
  b.angVel.z -= Math.sin(b.gimbalY) * 0.65 * dt;
  if (sim.sasEnabled) {
    b.angVel.multiplyScalar(Math.exp(-0.3 * dt));
  }

  const dQ = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(b.angVel.x * dt, b.angVel.y * dt, b.angVel.z * dt)
  );
  b.quat.multiply(dQ).normalize();

  // Hambatan Udara & Tekanan Dinamis (Max-Q)
  const speed = b.vel.length();
  const q = 0.5 * rho * speed * speed;
  b.q = q;
  s.q = q;
  s.isMaxQ = (sim.missionTime >= TIMELINE.T_MAXQ_START && sim.missionTime <= TIMELINE.T_MAXQ_END) ||
    (q > 16500 && h < 28000);

  // Dentuman Sonic Boom saat menembus kecepatan suara (Mach 1.0)
  const speedOfSound = Math.max(295.0, 340.3 - 0.004 * h);
  if (!sim.launchSonicBoomDone && speed >= speedOfSound && h > 1500) {
    sim.launchSonicBoomDone = true;
    playSonicBoom('single');
    camState.shake = Math.max(camState.shake, 1.45);
    showToast('SONIC BOOM — MACH 1.0! 💥🔊', 'Starship menembus kecepatan suara menuju puncak Max-Q (00:00:58)!');
  }

  if (world.vaporConeMesh) {
    const machProx = 1.0 - Math.min(1, Math.abs(speed - speedOfSound) / 75.0);
    world.vaporConeMesh.material.opacity = h < 24000 ? machProx * 0.42 : 0.0;
  }

  const dragForce = speed > 0.1
    ? b.vel.clone().normalize().multiplyScalar(-q * 36.0)
    : new THREE.Vector3();
  const accel = thrustWorld.add(dragForce).divideScalar(totalMass);
  accel.y -= g;

  b.vel.addScaledVector(accel, dt);
  b.pos.addScaledVector(b.vel, dt);
  if (b.pos.y < WORLD_COORDS.OLM_Y) {
    b.pos.y = WORLD_COORDS.OLM_Y;
    b.vel.y = Math.max(0, b.vel.y);
  }

  b.twr = thrustMag / (totalMass * g);
  b.gForce = Math.max(0.1, (accel.y + g) / PHYSICS.G0);
  s.twr = b.twr;
  s.gForce = b.gForce;

  // Sinkronkan posisi Starship di atas Super Heavy Booster
  const stackUp = new THREE.Vector3(0, 1, 0).applyQuaternion(b.quat);
  s.pos.copy(b.pos).addScaledVector(stackUp, SPECS.boosterHeight + SPECS.interstageHeight);
  s.vel.copy(b.vel);
  s.quat.copy(b.quat);
  s.gimbalX = b.gimbalX;
  s.gimbalY = b.gimbalY;

  applyBoosterEngineVisuals(activeEngines, throttle, vacFactor);
  applyShipEngineVisuals(0, 0, 0, vacFactor);

  world.boosterEngineLight.intensity = 90 * throttle * (activeEngines / 33);
  world.boosterEngineLight.position.copy(b.pos).addScaledVector(stackUp, -12);

  // Partikel uap landasan & jejak asap stratosfer
  if (h < 180) {
    for (let i = 0; i < 6; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 22 + Math.random() * 48;
      world.padSmokePool.spawn(
        (Math.random() - 0.5) * 18,
        2.5 + Math.random() * 5,
        (Math.random() - 0.5) * 18,
        Math.cos(ang) * spd,
        4 + Math.random() * 14,
        Math.sin(ang) * spd,
        0.95, 0.86, 0.78,
        3.2 + Math.random() * 2.2
      );
    }
  } else if (h < 28000 && Math.random() < 0.7) {
    const tail = b.pos.clone().addScaledVector(stackUp, -14);
    world.ascentTrailPool.spawn(
      tail.x, tail.y, tail.z,
      (Math.random() - 0.5) * 8, -12, (Math.random() - 0.5) * 8,
      0.92, 0.95, 1.0,
      2.5
    );
  }

  if (sim.simClock % 0.6 < dt) {
    s.path.push({ x: s.pos.x, y: s.pos.y });
    b.path.push({ x: b.pos.x, y: b.pos.y });
  }
}

/**
 * Fase Kembalinya Super Heavy Booster:
 * Flip (02:22) -> Boostback Burn 13 Raptor (02:27–03:07) -> Grid Fin Descent -> Landing Burn ASDS (06:36–07:01).
 */
function stepBoosterReturn(dt) {
  const b = sim.booster;
  const waveY = getOceanWaveHeight(WORLD_COORDS.ASDS_X, WORLD_COORDS.ASDS_Z, sim.simClock);
  const deckY = waveY + WORLD_COORDS.ASDS_DECK_OFFSET_Y;

  if (b.landed) {
    b.pos.set(WORLD_COORDS.ASDS_X, deckY + 0.35, WORLD_COORDS.ASDS_Z);
    b.vel.set(0, 0, 0);
    b.quat.setFromEuler(new THREE.Euler(Math.sin(sim.simClock * 1.1) * 0.015, 0, Math.cos(sim.simClock * 0.9) * 0.015));
    b.activeEngines = 0;
    b.throttle = 0;
    b.twr = 0;
    b.gForce = 1.0;
    b.legDeploy = 1.0;
    applyBoosterEngineVisuals(0, 0, 0);
    world.boosterEngineLight.intensity = 0;
    return;
  }

  const altAboveDeck = Math.max(0, b.pos.y - deckY);
  const rho = PHYSICS.RHO0 * Math.exp(-Math.max(0, b.pos.y) / PHYSICS.SCALE_HEIGHT);
  const g = PHYSICS.G0 * Math.pow(PHYSICS.EARTH_RADIUS / (PHYSICS.EARTH_RADIUS + Math.max(0, b.pos.y)), 2);
  const vacFactor = THREE.MathUtils.clamp(1.0 - rho / PHYSICS.RHO0, 0, 1);

  // 1. FLIP MANEUVER (00:02:22 -> 00:02:27)
  if (sim.missionTime < TIMELINE.T_BOOSTBACK_START) {
    b.activeEngines = 0;
    b.throttle = 0;
    b.twr = 0;
    b.phase = 'FLIP MANEUVER (02:22)';
    const flipTarget = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 1.35));
    b.quat.slerp(flipTarget, Math.min(1, dt * 1.8));
    b.vel.y -= g * dt;
    b.pos.addScaledVector(b.vel, dt);
    applyBoosterEngineVisuals(0, 0, vacFactor);
    world.boosterEngineLight.intensity = 0;
    return;
  }

  // 2. BOOSTBACK BURN (00:02:27 -> 00:03:07, 13 Raptor)
  if (sim.missionTime >= TIMELINE.T_BOOSTBACK_START && sim.missionTime < TIMELINE.T_BOOSTBACK_END) {
    if (!sim.boostbackStarted) {
      sim.boostbackStarted = true;
      showToast(
        'SUPER HEAVY BOOSTBACK BURN (00:02:27)! 🔥',
        '13 Mesin Raptor Booster menyala membalikkan arah menuju Pad Laut ASDS!'
      );
    }
    b.activeEngines = 13;
    b.throttle = 0.85;
    b.phase = 'BOOSTBACK BURN (13 RAPTOR)';

    const flipTarget = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 1.42));
    b.quat.slerp(flipTarget, Math.min(1, dt * 3.0));
    b.gimbalX = Math.sin(sim.simClock * 3.0) * 0.04;
    b.gimbalY = Math.cos(sim.simClock * 2.5) * 0.04;

    const mass = SPECS.bDryMass + b.headerProp;
    const thrust = b.headerProp > 0 ? SPECS.bMaxThrust * (13 / 33) * b.throttle : 0;
    const timeRemaining = Math.max(15, TIMELINE.T_BOOSTER_LAND_END - sim.missionTime);
    const targetVx = (WORLD_COORDS.ASDS_X - b.pos.x) / timeRemaining;
    const targetVz = (WORLD_COORDS.ASDS_Z - b.pos.z) / timeRemaining;
    const direction = new THREE.Vector3((targetVx - b.vel.x) * 0.3, g * 0.55, (targetVz - b.vel.z) * 0.3).normalize();
    b.quat.rotateTowards(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction), dt * 0.6);
    const accel = new THREE.Vector3(0, 1, 0).applyQuaternion(b.quat).multiplyScalar(thrust / mass);
    accel.addScaledVector(b.vel, -0.5 * rho * 35 * b.vel.length() / mass);
    accel.y -= g;
    b.vel.addScaledVector(accel, dt);
    b.pos.addScaledVector(b.vel, dt);
    b.twr = thrust / (mass * g);
    b.gForce = Math.max(0.4, thrust / (mass * PHYSICS.G0));
    b.headerProp = Math.max(0, b.headerProp - thrust / (SPECS.bIspVac * PHYSICS.G0) * dt);

    applyBoosterEngineVisuals(13, b.throttle, vacFactor);
    world.boosterEngineLight.intensity = 65;
    world.boosterEngineLight.position.copy(b.pos);
    return;
  }

  if (!sim.boostbackEnded && sim.missionTime >= TIMELINE.T_BOOSTBACK_END) {
    sim.boostbackEnded = true;
    showToast(
      'BOOSTBACK BURN SHUTDOWN (00:03:07)',
      'Super Heavy masuk fase Super Heavy Descent meluncur dengan 4 Grid Fins menuju ASDS.'
    );
  }

  const errX = WORLD_COORDS.ASDS_X - b.pos.x;
  const errZ = WORLD_COORDS.ASDS_Z - b.pos.z;

  // 3. SUPER HEAVY DESCENT (GRID FINS) -> LANDING BURN (00:06:36 -> 00:07:01)
  if (altAboveDeck > 1450 && sim.missionTime < TIMELINE.T_BOOSTER_LAND_START) {
    b.activeEngines = 0;
    b.throttle = 0;
    b.twr = 0;
    b.phase = 'SUPER HEAVY DESCENT (GRID FINS)';

    if (!sim.boosterSonicBoomDone && b.vel.y < -40 && altAboveDeck < 2600) {
      sim.boosterSonicBoomDone = true;
      playSonicBoom('double');
      camState.shake = Math.max(camState.shake, 1.25);
      showToast(
        'DOUBLE SONIC BOOM! 💥💥',
        'Gelombang kejut ganda (BOOM–BOOM!) dari Super Heavy Booster terdengar di sekitar Pad ASDS!'
      );
    }

    const timeToBurn = Math.max(4.0, TIMELINE.T_BOOSTER_LAND_START - sim.missionTime);
    const desVx = THREE.MathUtils.clamp(errX / (timeToBurn + 22.0), -280, 280);
    const desVz = THREE.MathUtils.clamp(errZ / (timeToBurn + 22.0), -140, 140);
    const mass = SPECS.bDryMass + b.headerProp;
    const aero = b.vel.clone().multiplyScalar(-0.5 * rho * 65 * b.vel.length() / mass);
    const finAuthority = Math.min(5, 0.5 * rho * b.vel.lengthSq() * 16 / mass);
    aero.x += THREE.MathUtils.clamp((desVx - b.vel.x) * 0.2, -finAuthority, finAuthority);
    aero.z += THREE.MathUtils.clamp((desVz - b.vel.z) * 0.2, -finAuthority, finAuthority);
    aero.y -= g;
    b.vel.addScaledVector(aero, dt);
    b.pos.addScaledVector(b.vel, dt);

    const tiltZ = THREE.MathUtils.clamp(-errX * 0.0004, -0.22, 0.22);
    b.quat.slerp(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, tiltZ)), Math.min(1, dt * 2.2));
    b.gridFinTilt = tiltZ * 2.4;
    b.gimbalX = 0;
    b.gimbalY = 0;
  } else {
    // Propulsive Hover-Slam: 13 Raptor -> 3 Raptor presisi ke atas dek ASDS
    const activeCount = altAboveDeck > 340 ? 13 : 3;
    b.activeEngines = activeCount;
    b.phase = activeCount === 13 ? 'LANDING BURN (13 RAPTOR)' : 'FINAL TOUCHDOWN (3 RAPTOR)';

    const targetVy = altAboveDeck > 140 ? -Math.sqrt(altAboveDeck * 10.5) : -Math.max(2.2, altAboveDeck * 0.19);
    const vyErr = targetVy - b.vel.y;
    const mass = SPECS.bDryMass + b.headerProp;
    const maxAvailThrust = SPECS.bMaxThrust * (activeCount / 33);
    b.throttle = THREE.MathUtils.clamp((mass * (g + vyErr * 2.4)) / maxAvailThrust, 0.22, 1.0);

    const desiredVx = THREE.MathUtils.clamp(errX * 0.45, -45, 45);
    const desiredVz = THREE.MathUtils.clamp(errZ * 0.45, -45, 45);
    const ax = THREE.MathUtils.clamp((desiredVx - b.vel.x) * 1.8, -14, 14);
    const az = THREE.MathUtils.clamp((desiredVz - b.vel.z) * 1.8, -14, 14);

    b.gimbalY = THREE.MathUtils.clamp(-ax * 0.025, -PHYSICS.MAX_GIMBAL_RAD, PHYSICS.MAX_GIMBAL_RAD);
    b.gimbalX = THREE.MathUtils.clamp(az * 0.025, -PHYSICS.MAX_GIMBAL_RAD, PHYSICS.MAX_GIMBAL_RAD);

    const actualThrust = b.headerProp > 0 ? maxAvailThrust * b.throttle : 0;
    b.headerProp = Math.max(0, b.headerProp - (actualThrust / (SPECS.bIspSL * PHYSICS.G0)) * dt);

    b.vel.x += ax * dt;
    b.vel.z += az * dt;
    b.vel.y += ((actualThrust / mass) - g) * dt;
    b.pos.addScaledVector(b.vel, dt);

    b.quat.slerp(new THREE.Quaternion().setFromEuler(new THREE.Euler(az * 0.012, 0, -ax * 0.012)), Math.min(1, dt * 5.0));
    b.twr = actualThrust / (mass * g);
    b.gForce = Math.max(0.2, actualThrust / (mass * PHYSICS.G0));

    if (altAboveDeck < 140) {
      b.legDeploy = Math.min(1.0, b.legDeploy + dt * 1.3);
    }
    if (altAboveDeck < 120) {
      for (let i = 0; i < 4; i++) {
        const a = Math.random() * Math.PI * 2;
        const spd = 16 + Math.random() * 28;
        world.oceanSprayPool.spawn(
          b.pos.x + (Math.random() - 0.5) * 12,
          deckY + 1.2,
          b.pos.z + (Math.random() - 0.5) * 12,
          Math.cos(a) * spd,
          4 + Math.random() * 10,
          Math.sin(a) * spd,
          0.82, 0.93, 1.0,
          1.6
        );
      }
    }

    if (altAboveDeck <= 0.65 && Math.hypot(errX, errZ) < 12 && Math.abs(b.vel.y) < 5) {
      b.landed = true;
      b.pos.set(WORLD_COORDS.ASDS_X, deckY + 0.35, WORLD_COORDS.ASDS_Z);
      b.vel.set(0, 0, 0);
      b.phase = 'LANDING BURN SHUTDOWN ✓';
      playMechanicalClank(82);
      showToast(
        'SUPER HEAVY LANDING SHUTDOWN (00:07:01)! 🚢✓',
        'Super Heavy Booster mendarat mulus di atas Pad Laut Apung (ASDS)!'
      );
    }
  }

  applyBoosterEngineVisuals(b.activeEngines, b.throttle, vacFactor);
  world.boosterEngineLight.intensity = b.activeEngines > 0 ? 70 * b.throttle : 0;
  world.boosterEngineLight.position.copy(b.pos).add(new THREE.Vector3(0, -10, 0));

  if (sim.simClock % 0.8 < dt) {
    b.path.push({ x: b.pos.x, y: b.pos.y });
  }
}

/**
 * Fase Starship Upper Stage:
 * Post-Separation Ignition -> Ascent -> SECO (08:11) -> 1x Orbit Bumi 360° (OIB + Starlink Deploy +
 * Deorbit + Reentry Plasma) -> Belly Flop -> Flip & Catch 3->2->1 Raptor -> Mechazilla Catch (09:50:30).
 */
function stepStarshipMission(dt, rawDt) {
  const s = sim.ship;

  if (s.caught) {
    s.vel.set(0, 0, 0);
    s.gimbalX = 0; s.gimbalY = 0;
    s.activeEngines = 0;
    s.throttle = 0;
    s.twr = 0;
    s.gForce = 1.0;
    s.phase = 'AN EXCITING LANDING! ✓';
    mechazilla.targetCarriageY = WORLD_COORDS.CATCH_RAIL_Y;
    mechazilla.targetArmAngle = 0;
    mechazilla.statusText = 'MECHAZILLA CATCH ✓';
    applyShipEngineVisuals(0, 0, 0, 0);
    world.shipEngineLight.intensity = 0;
    return;
  }

  // FASE A: STARSHIP ASCENT (00:02:23.2 Ignition -> 00:08:11 SECO)
  if (s.returnPhase === 'ASCENT') {
    const h = Math.max(0, s.pos.y - WORLD_COORDS.OLM_Y);
    const rho = PHYSICS.RHO0 * Math.exp(-h / PHYSICS.SCALE_HEIGHT);
    const g = PHYSICS.G0 * Math.pow(PHYSICS.EARTH_RADIUS / (PHYSICS.EARTH_RADIUS + h), 2);
    const vacFactor = THREE.MathUtils.clamp(1.0 - rho / PHYSICS.RHO0, 0, 1);

    // Tunggu jarak aman sesudah Booster terpisah sebelum menyalakan 6 Raptor Starship
    if (sim.missionTime < TIMELINE.T_SHIP_IGNITION) {
      s.activeEngines = 0;
      s.throttle = 0;
      s.phase = 'SEPARATED — IGNITION DELAY';
      s.vel.y -= g * dt;
      s.pos.addScaledVector(s.vel, dt);
      applyShipEngineVisuals(0, 0, 0, vacFactor);
      world.shipEngineLight.intensity = 0;
      return;
    }

    if (!sim.shipIgnitedAfterSep) {
      sim.shipIgnitedAfterSep = true;
      playIgnitionBoom();
      showToast(
        'STARSHIP RAPTOR IGNITION! 🔥🚀',
        'Booster sudah terpisah aman — 6 Mesin Raptor Starship (3 SL + 3 Vac) menyala menuju Orbit!'
      );
    }

    s.activeEngines = 6;
    s.throttle = 1.0;
    s.phase = 'STARSHIP ASCENT (6 RAPTOR)';

    const mass = SPECS.sDryMass + s.mainProp + s.headerProp;
    const thrustMag = SPECS.sMaxThrust * s.throttle;
    const burnFrac = THREE.MathUtils.clamp(
      (sim.missionTime - TIMELINE.T_SHIP_IGNITION) / (TIMELINE.T_SECO - TIMELINE.T_SHIP_IGNITION),
      0,
      1
    );
    s.mainProp = Math.max(0, s.mainProp - thrustMag / (SPECS.sIspVac * PHYSICS.G0) * dt);

    if (sim.autoMode) {
      s.quat.slerp(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -1.28)), Math.min(1, dt * 1.2));
      s.gimbalX = Math.sin(sim.simClock * 2.1) * 0.03;
      s.gimbalY = Math.cos(sim.simClock * 1.7) * 0.03;
    } else {
      s.gimbalX = sim.manualGimbalX * PHYSICS.MAX_GIMBAL_RAD;
      s.gimbalY = sim.manualGimbalY * PHYSICS.MAX_GIMBAL_RAD;
    }

    const dir = new THREE.Vector3(0, 1, 0).applyEuler(new THREE.Euler(s.gimbalX, 0, s.gimbalY)).applyQuaternion(s.quat);
    const accel = dir.multiplyScalar((s.mainProp > 0 ? thrustMag : 0) / mass);
    accel.addScaledVector(s.vel, -0.5 * rho * 32 * s.vel.length() / mass);
    accel.y -= g;
    s.vel.addScaledVector(accel, dt);
    s.pos.addScaledVector(s.vel, dt);

    s.twr = thrustMag / (mass * g);
    s.gForce = Math.max(0.2, accel.length() / PHYSICS.G0);
    s.q = 0.5 * rho * s.vel.lengthSq();
    s.apogeeKm = THREE.MathUtils.lerp(80, 185, burnFrac);
    s.perigeeKm = THREE.MathUtils.lerp(0, 145, burnFrac);

    applyShipEngineVisuals(3, 3, s.throttle, vacFactor);
    world.shipEngineLight.intensity = 65;
    world.shipEngineLight.position.copy(s.pos);

    if (sim.simClock % 0.8 < dt) {
      s.path.push({ x: s.pos.x, y: s.pos.y });
    }

    if (sim.missionTime >= TIMELINE.T_SECO) {
      s.returnPhase = 'ORBIT_COAST_OIB';
      s.orbitAngleDeg = 4.0;
      s.apogeeKm = 185.0;
      s.perigeeKm = 148.0;
      s.activeEngines = 0;
      s.throttle = 0;
      s.phase = 'SECO (00:08:11) — ORBIT COAST';
      if (camState.mode === 'starship') setCameraMode('orbit');
      showToast(
        'STARSHIP ENGINE CUTOFF (00:08:11)! 🌍🛰️',
        'SECO tercapai! Memasuki 1 putaran orbit Bumi 360° menuju Orbital Insertion Burn (00:25:17).'
      );
    }
    return;
  }

  // FASE B: 1 PUTARAN ORBIT BUMI FOTOREALISTIS (00:08:11 -> 09:47:29)
  if (isShipInOrbitalScene()) {
    const t = sim.missionTime;
    let angleDeg = 0;
    let altNorm = 1.0;

    if (t < TIMELINE.T_OIB_START) {
      sim.orbitalTimeRate = (TIMELINE.T_OIB_START - TIMELINE.T_SECO) / 5.0;
      const p = (t - TIMELINE.T_SECO) / (TIMELINE.T_OIB_START - TIMELINE.T_SECO);
      angleDeg = THREE.MathUtils.lerp(4.0, 14.0, p);
      s.returnPhase = 'ORBIT_COAST_OIB';
      s.phase = 'COAST TO ORBITAL INSERTION';
      s.activeEngines = 0; s.throttle = 0; s.twr = 0; s.gForce = 0.0;
      s.rcsActive = false; s.plasmaIntensity = 0;
    } else if (t < TIMELINE.T_OIB_END) {
      sim.orbitalTimeRate = 1.6;
      if (!sim.oibNotified) {
        sim.oibNotified = true;
        showToast(
          'ORBITAL INSERTION BURN (00:25:17)! 🔥🛰️',
          '3 Mesin Raptor Vacuum menyala menyempurnakan orbit lingkaran 185 x 185 km!'
        );
      }
      const p = (t - TIMELINE.T_OIB_START) / (TIMELINE.T_OIB_END - TIMELINE.T_OIB_START);
      angleDeg = THREE.MathUtils.lerp(14.0, 22.0, p);
      s.returnPhase = 'OIB_BURN';
      s.phase = 'ORBITAL INSERTION BURN (00:25:17)';
      s.activeEngines = 3; s.throttle = 0.85; s.twr = 1.1; s.gForce = 1.1;
      s.perigeeKm = THREE.MathUtils.lerp(148.0, 185.0, p);
      s.rcsActive = false; s.plasmaIntensity = 0;
    } else if (t < TIMELINE.T_DEPLOY_START) {
      sim.orbitalTimeRate = (TIMELINE.T_DEPLOY_START - TIMELINE.T_OIB_END) / 4.5;
      const p = (t - TIMELINE.T_OIB_END) / (TIMELINE.T_DEPLOY_START - TIMELINE.T_OIB_END);
      angleDeg = THREE.MathUtils.lerp(22.0, 40.0, p);
      s.returnPhase = 'ORBIT_COAST_DEPLOY';
      s.phase = 'OIB SHUTDOWN — SIAP DEPLOY';
      s.activeEngines = 0; s.throttle = 0; s.twr = 0; s.gForce = 0.0;
      s.perigeeKm = 185.0; s.rcsActive = false; s.plasmaIntensity = 0;
    } else if (t < TIMELINE.T_DEPLOY_END) {
      sim.orbitalTimeRate = (TIMELINE.T_DEPLOY_END - TIMELINE.T_DEPLOY_START) / 10.0;
      if (!sim.deployNotified) {
        sim.deployNotified = true;
        showToast(
          'PAYLOAD DEPLOY START (00:34:07)! 📡🛰️',
          'Pintu Pez-Dispenser terbuka melepaskan 10 satelit Starlink di orbit Bumi!'
        );
      }
      const p = (t - TIMELINE.T_DEPLOY_START) / (TIMELINE.T_DEPLOY_END - TIMELINE.T_DEPLOY_START);
      angleDeg = THREE.MathUtils.lerp(40.0, 98.0, p);
      s.returnPhase = 'PAYLOAD_DEPLOY';
      s.phase = `STARLINK DEPLOY (${s.starlinksDeployed}/10)`;
      s.activeEngines = 0; s.throttle = 0; s.twr = 0; s.gForce = 0.0;
      s.payloadDoorOpen = Math.sin(p * Math.PI);
      const targetSats = Math.floor(p * 10);
      while (s.starlinksDeployed < targetSats) {
        s.starlinksDeployed++;
        spawnStarlinkSatellite();
      }
    } else if (t < TIMELINE.T_DEORBIT_START) {
      sim.orbitalTimeRate = (TIMELINE.T_DEORBIT_START - TIMELINE.T_DEPLOY_END) / 15.0;
      const p = (t - TIMELINE.T_DEPLOY_END) / (TIMELINE.T_DEORBIT_START - TIMELINE.T_DEPLOY_END);
      angleDeg = THREE.MathUtils.lerp(98.0, 308.0, p);
      s.returnPhase = 'ORBIT_COAST_MAIN';
      s.phase = `ORBITAL COAST (${angleDeg.toFixed(0)}°/360°)`;
      s.activeEngines = 0; s.throttle = 0; s.twr = 0; s.gForce = 0.0;
      s.payloadDoorOpen = 0; s.rcsActive = false; s.plasmaIntensity = 0;
    } else if (t < TIMELINE.T_DEORBIT_END) {
      sim.orbitalTimeRate = 1.4;
      if (!sim.deorbitNotified) {
        sim.deorbitNotified = true;
        showToast(
          'DEORBIT BURN START (08:52:37)! 🔥',
          'RCS memutar Starship retrograde & 3 Raptor menyala menurunkan Perigee menuju atmosfer!'
        );
      }
      const p = (t - TIMELINE.T_DEORBIT_START) / (TIMELINE.T_DEORBIT_END - TIMELINE.T_DEORBIT_START);
      angleDeg = THREE.MathUtils.lerp(308.0, 318.0, p);
      s.returnPhase = 'DEORBIT_BURN';
      s.phase = 'DEORBIT BURN (08:52:37)';
      s.activeEngines = 3; s.throttle = 0.78; s.twr = 0.92; s.gForce = 0.92;
      s.perigeeKm = THREE.MathUtils.lerp(185.0, 28.0, p);
      s.rcsActive = true; s.plasmaIntensity = 0;
    } else if (t < TIMELINE.T_ENTRY_START) {
      sim.orbitalTimeRate = (TIMELINE.T_ENTRY_START - TIMELINE.T_DEORBIT_END) / 4.5;
      const p = (t - TIMELINE.T_DEORBIT_END) / (TIMELINE.T_ENTRY_START - TIMELINE.T_DEORBIT_END);
      angleDeg = THREE.MathUtils.lerp(318.0, 332.0, p);
      altNorm = THREE.MathUtils.lerp(1.0, 0.78, p);
      s.returnPhase = 'COAST_ENTRY';
      s.phase = 'DEORBIT SHUTDOWN — MENUJU ENTRY';
      s.activeEngines = 0; s.throttle = 0; s.twr = 0; s.gForce = 0.05;
      s.rcsActive = true; s.plasmaIntensity = 0;
    } else if (t < TIMELINE.T_TRANSONIC) {
      sim.orbitalTimeRate = (TIMELINE.T_TRANSONIC - TIMELINE.T_ENTRY_START) / 11.5;
      if (!sim.entryNotified) {
        sim.entryNotified = true;
        showToast(
          'STARSHIP ENTRY (09:28:56)! ☄️🔥',
          'Perisai panas Starship menerobos atmosfer 1.650°C menyala plasma menuju Starbase!'
        );
      }
      const p = (t - TIMELINE.T_ENTRY_START) / (TIMELINE.T_TRANSONIC - TIMELINE.T_ENTRY_START);
      angleDeg = THREE.MathUtils.lerp(332.0, 360.0, p);
      altNorm = THREE.MathUtils.lerp(0.78, 0.22, p);
      s.returnPhase = 'REENTRY_PLASMA';
      s.phase = 'STARSHIP ENTRY PLASMA (09:28:56)';
      s.activeEngines = 0; s.throttle = 0; s.twr = 0;
      s.gForce = 1.2 + 2.4 * Math.sin(p * Math.PI);
      s.rcsActive = false;
      s.plasmaIntensity = Math.sin(p * Math.PI);
    } else {
      // 09:47:29 -> Selesai 1 putaran 360°, masuk ruang udara Starbase!
      sim.orbitalTimeRate = 1.0;
      s.orbitAngleDeg = 360.0;
      s.orbitCompleted = true;
      s.plasmaIntensity = 0.0;
      s.rcsActive = false;
      s.returnPhase = 'BELLY_FLOP';
      s.phase = 'STARSHIP IS TRANSONIC (09:47:29)';
      s.pos.set(220, 3600, 18);
      s.vel.set(-14, -92, -1.2);
      s.quat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-0.98, 0.18, 0).normalize());
      s.flapAngle = 1.0;
      mechazilla.targetCarriageY = 108.0;
      mechazilla.targetArmAngle = 0.44;
      mechazilla.statusText = 'CHOPSTICKS TERBUKA';
      if (camState.mode === 'orbit') setCameraMode('starship');
      camState.needsSnap = true;
      if (!sim.shipLandingBoomDone) {
        sim.shipLandingBoomDone = true;
        playSonicBoom('double');
        camState.shake = Math.max(camState.shake, 1.35);
      }
      showToast(
        'STARSHIP IS TRANSONIC (09:47:29)! 💥🪂',
        'Double Sonic Boom menggema di Starbase! Starship turun Belly Flop menuju Mechazilla.'
      );
      return;
    }

    s.orbitAngleDeg = angleDeg;
    const rad = THREE.MathUtils.degToRad(angleDeg);
    const orbR = WORLD_COORDS.R_EARTH_ORBIT + 18 + altNorm * (WORLD_COORDS.R_ORBIT_LEO - WORLD_COORDS.R_EARTH_ORBIT - 18);

    const radialOut = world.orbitU.clone().multiplyScalar(Math.cos(rad))
      .addScaledVector(world.orbitV, Math.sin(rad))
      .normalize();
    const tangent = world.orbitU.clone().multiplyScalar(-Math.sin(rad))
      .addScaledVector(world.orbitV, Math.cos(rad))
      .normalize();
    world.orbitalShipGroup.position.copy(radialOut).multiplyScalar(orbR);

    s.pos.set(0, Math.round(14000 + altNorm * 171000), 0);
    const orbSpeed = s.returnPhase === 'REENTRY_PLASMA'
      ? THREE.MathUtils.lerp(7500, 420, (t - TIMELINE.T_ENTRY_START) / (TIMELINE.T_TRANSONIC - TIMELINE.T_ENTRY_START))
      : 7800;
    s.vel.set(orbSpeed, 0, 0);

    // Orientasi wahana sesuai manuver orbit
    if (s.returnPhase === 'DEORBIT_BURN') {
      world.orbitalShipGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent.clone().negate());
      applyShipEngineVisuals(3, 0, s.throttle, 1.0, world.orbitalShipSLEngines, world.orbitalShipVacEngines);
    } else if (s.returnPhase === 'OIB_BURN') {
      world.orbitalShipGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
      applyShipEngineVisuals(0, 3, s.throttle, 1.0, world.orbitalShipSLEngines, world.orbitalShipVacEngines);
    } else if (s.returnPhase === 'REENTRY_PLASMA' || s.returnPhase === 'COAST_ENTRY') {
      const reentryDir = tangent.clone().multiplyScalar(0.5).addScaledVector(radialOut, 0.866).normalize();
      world.orbitalShipGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), reentryDir);
      applyShipEngineVisuals(0, 0, 0, 0.6, world.orbitalShipSLEngines, world.orbitalShipVacEngines);
    } else {
      world.orbitalShipGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
      applyShipEngineVisuals(0, 0, 0, 1.0, world.orbitalShipSLEngines, world.orbitalShipVacEngines);
    }

    // Animasi pintu Starlink & satelit yang terlepas
    if (world.starlinkDoorMesh) {
      world.starlinkDoorMesh.rotation.z = s.payloadDoorOpen * 0.95;
    }
    for (let i = world.starlinkSats.length - 1; i >= 0; i--) {
      const sat = world.starlinkSats[i];
      sat.userData.age += rawDt;
      sat.position.addScaledVector(sat.userData.vel, rawDt);
      sat.rotation.y += rawDt * 0.4;
      if (sat.userData.age > 24) {
        world.starlinkPayloadGroup.remove(sat);
        world.starlinkSats.splice(i, 1);
      }
    }

    // Selubung Plasma Reentry & RCS Jets
    world.orbitalPlasmaMesh.visible = s.plasmaIntensity > 0.03;
    world.orbitalPlasmaUniforms.uIntensity.value = s.plasmaIntensity;
    world.orbitalPlasmaLight.intensity = s.plasmaIntensity * 55;
    world.orbitalRCSJets.forEach(j => { j.visible = s.rcsActive; });

    if (s.plasmaIntensity > 0.15) {
      camState.shake = Math.max(camState.shake, s.plasmaIntensity * 0.5);
      for (let i = 0; i < 3; i++) {
        world.orbitalPlasmaPool.spawn(
          world.orbitalShipGroup.position.x + (Math.random() - 0.5) * 8,
          world.orbitalShipGroup.position.y + (Math.random() - 0.5) * 8,
          world.orbitalShipGroup.position.z + (Math.random() - 0.5) * 8,
          -tangent.x * 45, -tangent.y * 45, -tangent.z * 45,
          1.0, 0.35 + Math.random() * 0.3, 0.15,
          0.75
        );
      }
    }

    // Perbarui busur progres lintasan orbit 3D
    const segs = Math.max(2, Math.floor(angleDeg / 3));
    const arcPts = [];
    for (let i = 0; i <= segs; i++) {
      const a = THREE.MathUtils.degToRad((i / segs) * angleDeg);
      arcPts.push(
        world.orbitU.clone().multiplyScalar(Math.cos(a) * (WORLD_COORDS.R_ORBIT_LEO + 2.5))
          .addScaledVector(world.orbitV, Math.sin(a) * (WORLD_COORDS.R_ORBIT_LEO + 2.5))
      );
    }
    world.orbitalRingProgressLine.geometry.dispose();
    world.orbitalRingProgressLine.geometry = new THREE.BufferGeometry().setFromPoints(arcPts);
    return;
  }

  // FASE C: TRANSONIC (09:47:29) -> SUBSONIC BELLY FLOP (09:48:07) -> LANDING BURN (09:50:11)
  if (s.returnPhase === 'BELLY_FLOP') {
    sim.orbitalTimeRate = 4.2;
    s.activeEngines = 0; s.throttle = 0; s.twr = 0; s.gForce = 1.0;
    s.phase = sim.missionTime < TIMELINE.T_SUBSONIC
      ? 'STARSHIP IS TRANSONIC (09:47:29)'
      : 'STARSHIP IS SUBSONIC — BELLY FLOP';

    const mass = SPECS.sDryMass + s.headerProp;
    const rho = PHYSICS.RHO0 * Math.exp(-Math.max(0, s.pos.y) / PHYSICS.SCALE_HEIGHT);
    const pressure = 0.5 * rho * s.vel.lengthSq();
    const aero = s.vel.clone().multiplyScalar(-0.5 * rho * 650 * s.vel.length() / mass);
    const authority = pressure * 140 / mass;
    aero.x += THREE.MathUtils.clamp(-s.pos.x * 0.02 - s.vel.x * 0.6, -authority, authority);
    aero.z += THREE.MathUtils.clamp(-s.pos.z * 0.02 - s.vel.z * 0.6, -authority, authority);
    aero.y -= PHYSICS.G0;
    s.vel.addScaledVector(aero, dt);
    s.q = pressure;
    s.pos.addScaledVector(s.vel, dt);

    const bellyQ = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(-0.98, 0.16, 0).normalize()
    );
    s.quat.slerp(bellyQ, Math.min(1, dt * 2.5));
    s.flapAngle = 0.85 + Math.sin(sim.simClock * 3.5) * 0.12;
    s.gimbalX = 0; s.gimbalY = 0;

    mechazilla.targetCarriageY = 104.0;
    mechazilla.targetArmAngle = 0.44;
    mechazilla.statusText = 'MENUNGGU LANDING FLIP';
    applyShipEngineVisuals(0, 0, 0, 0);
    world.shipEngineLight.intensity = 0;

    if (sim.missionTime >= TIMELINE.T_LAND_BURN || (s.pos.y - WORLD_COORDS.SHIP_CAUGHT_BASE_Y) <= 850) {
      sim.missionTime = Math.max(sim.missionTime, TIMELINE.T_LAND_BURN);
      sim.orbitalTimeRate = 1.0;
      s.returnPhase = 'FLIP_CATCH';
      s.flipStartY = s.pos.y;
      s.flipStartVy = s.vel.y;
      s.flipStartTime = sim.missionTime;
      s.flipStartPose = s.quat.clone();
      showToast(
        'LANDING BURN START (09:50:11)! 🔥🦾',
        '3 Mesin Raptor Sea-Level menyala diikuti Landing Flip (09:50:13) menuju Chopsticks Mechazilla!'
      );
    }
    return;
  }

  // FASE D: LANDING FLIP & MECHAZILLA CATCH (09:50:11 3->2->1 ENGINE -> 09:50:30 CATCH!)
  if (s.returnPhase === 'FLIP_CATCH') {
    sim.orbitalTimeRate = 1.0;
    const altAboveCatch = Math.max(0, s.pos.y - WORLD_COORDS.SHIP_CAUGHT_BASE_Y);
    const t = sim.missionTime;
    const previousY = s.pos.y;

    s.flapAngle = THREE.MathUtils.lerp(s.flapAngle, 0.1, Math.min(1, dt * 3.5));

    integrateLanding(s, dt, true);
    const activeSL = s.activeEngines;
    s.phase = `LANDING TVC · ${activeSL} RAPTOR`;

    // Lengan Chopsticks Mechazilla melacak ketinggian pin tangkap lalu menjepit
    mechazilla.targetCarriageY = WORLD_COORDS.CATCH_RAIL_Y;
    if (altAboveCatch < 45) {
      mechazilla.targetArmAngle = 0.42 * THREE.MathUtils.smoothstep(altAboveCatch, 6, 45);
      mechazilla.statusText = 'MENJEPIT STARSHIP...';
    } else {
      mechazilla.targetArmAngle = 0.42;
      mechazilla.statusText = 'MELACAK TARGET';
    }

    applyShipEngineVisuals(activeSL, 0, s.throttle, 0);
    world.shipEngineLight.intensity = 65 * s.throttle;
    world.shipEngineLight.position.copy(s.pos).add(new THREE.Vector3(0, -10, 0));

    if (altAboveCatch < 65) {
      for (let i = 0; i < 3; i++) {
        const a = Math.random() * Math.PI * 2;
        world.padSmokePool.spawn(
          s.pos.x + (Math.random() - 0.5) * 6, 3.0, s.pos.z + (Math.random() - 0.5) * 6,
          Math.cos(a) * 24, 5, Math.sin(a) * 24,
          0.9, 0.88, 0.84, 2.0
        );
      }
    }

    const crossedRail = previousY >= WORLD_COORDS.SHIP_CAUGHT_BASE_Y && s.pos.y <= WORLD_COORDS.SHIP_CAUGHT_BASE_Y;
    if (crossedRail && Math.abs(s.vel.y) < 3 && pinsOnPads(s, world.shipRoot, world.shipCatchPins, 0.25)) {
      s.caught = true;
      s.phase = 'STARSHIP TERTANGKAP ✓';
      s.returnPhase = 'CAUGHT';
      s.activeEngines = 0; s.throttle = 0; s.twr = 0;
      s.gimbalX = 0; s.gimbalY = 0;
      applyShipEngineVisuals(0, 0, 0, 0);
      world.shipEngineLight.intensity = 0;
      sim.missionTime = Math.max(sim.missionTime, TIMELINE.T_LAND_CATCH);
      s.vel.set(0, 0, 0);
      s.pos.y = WORLD_COORDS.SHIP_CAUGHT_BASE_Y;
      s.angVel.set(0, 0, 0);
      mechazilla.targetCarriageY = WORLD_COORDS.CATCH_RAIL_Y;
      mechazilla.targetArmAngle = 0;
      mechazilla.statusText = 'MECHAZILLA CATCH ✓';
      playMechanicalClank(120);
      camState.shake = 0.7;
      showToast(
        '09:50:30 — AN EXCITING LANDING! 🦾🎉',
        'Chopsticks Menara Mechazilla berhasil menangkap Starship dengan sempurna!'
      );
    } else if (crossedRail || s.pos.y < 0) {
      s.returnPhase = 'MISSED';
      s.phase = 'PENANGKAPAN TERLEWAT';
      mechazilla.statusText = 'PIN DI LUAR BANTALAN';
      showToast('Penangkapan terlewat', 'Ulangi fase Catch untuk mencoba pendekatan lagi.');
      s.activeEngines = 0; s.throttle = 0; s.twr = 0;
      applyShipEngineVisuals(0, 0, 0, 0);
      world.shipEngineLight.intensity = 0;
      sim.sequenceStarted = false;
    }
  }
}

// Test each pin's underside in its own moving pad's coordinate system.
function pinsOnPads(vehicle = sim.ship, root = world.shipRoot, pins = world.shipCatchPins, tolerance = 0.05) {
  root.position.copy(vehicle.pos);
  root.quaternion.copy(vehicle.quat);
  return pins.every((pin, i) => {
    const pad = world.catchPads[i];
    const local = pad.worldToLocal(pin.localToWorld(new THREE.Vector3(0, -0.5, 0)));
    const { width, height, depth } = pad.geometry.parameters;
    return Math.abs(local.x) <= width / 2 && Math.abs(local.z) <= depth / 2 &&
      Math.abs(local.y - height / 2) < tolerance;
  });
}

function stepSimulation(rawDt) {
  if (sim.paused) {
    updateAudio(0, 1, false);
    return;
  }

  const dt = Math.min(rawDt, 0.05) * sim.timeWarp;
  sim.simClock += dt;
  world.sharedShaderUniforms.uTime.value = sim.simClock;

  // Input Keyboard W/A/S/D untuk kendali Manual TVC X/Y
  if (!sim.autoMode) {
    const kx = (sim.keys.w ? 1 : 0) - (sim.keys.s ? 1 : 0);
    const ky = (sim.keys.d ? 1 : 0) - (sim.keys.a ? 1 : 0);
    if (kx !== 0 || ky !== 0) {
      sim.manualGimbalX = THREE.MathUtils.lerp(sim.manualGimbalX, kx, Math.min(1, rawDt * 10));
      sim.manualGimbalY = THREE.MathUtils.lerp(sim.manualGimbalY, ky, Math.min(1, rawDt * 10));
    }
  }

  // Gerakan mengapung Pad Laut ASDS mengikuti shader ombak 3D
  const asdsWaveY = getOceanWaveHeight(WORLD_COORDS.ASDS_X, WORLD_COORDS.ASDS_Z, sim.simClock);
  world.asdsGroup.position.y = asdsWaveY;
  world.asdsGroup.rotation.z = Math.cos(sim.simClock * 0.9) * 0.014;
  world.asdsGroup.rotation.x = Math.sin(sim.simClock * 1.1) * 0.012;

  let delugeActive = false;
  const b = sim.booster;
  const s = sim.ship;

  if (sim.sequenceStarted) {
    const timeStep = (isShipInOrbitalScene() || s.returnPhase === 'BELLY_FLOP') ? dt * sim.orbitalTimeRate : dt;
    sim.missionTime += timeStep;

    if (!sim.launched) {
      if (sim.missionTime < TIMELINE.T_FLAME_DIVERTER) {
        b.phase = 'GO FOR LAUNCH (T-18s)';
        s.phase = 'GO FOR LAUNCH (T-18s)';
      } else if (sim.missionTime < TIMELINE.T_IGNITION) {
        if (!sim.flameDiverterTriggered) {
          sim.flameDiverterTriggered = true;
          showToast(
            'FLAME DIVERTER ACTIVATION (T-00:00:17)! 💧',
            'Sistem semprotan air bertekanan tinggi (Water Deluge) aktif mendinginkan landasan OLM!'
          );
        }
        b.phase = 'FLAME DIVERTER AKTIF';
        s.phase = 'FLAME DIVERTER AKTIF';
        delugeActive = true;
        for (let i = 0; i < 6; i++) {
          const a = Math.random() * Math.PI * 2;
          world.padSmokePool.spawn(
            (Math.random() - 0.5) * 14, 2.0, (Math.random() - 0.5) * 14,
            Math.cos(a) * 24, 6 + Math.random() * 10, Math.sin(a) * 24,
            0.95, 0.98, 1.0, 2.4
          );
        }
      } else if (sim.missionTime < 0) {
        if (!sim.ignitionBoomDone) {
          sim.ignitionBoomDone = true;
          playIgnitionBoom();
          camState.shake = Math.max(camState.shake, 1.2);
          showToast('BOOSTER ENGINE STARTUP (T-00:00:03)! 🔥', 'Perintah penyalaan bertahap 33 Mesin Raptor Super Heavy!');
        }
        b.phase = 'BOOSTER STARTUP (33 RAPTOR)';
        s.phase = 'BOOSTER STARTUP (33 RAPTOR)';
        delugeActive = true;
        const ramp = THREE.MathUtils.clamp((sim.missionTime - TIMELINE.T_IGNITION) / 3.0, 0.1, 1.0);
        b.activeEngines = Math.min(33, Math.ceil(ramp * 33));
        b.throttle = ramp;
        applyBoosterEngineVisuals(b.activeEngines, ramp, 0);
        world.boosterEngineLight.intensity = 95 * ramp;
        world.boosterEngineLight.position.set(0, 6, 0);
        camState.shake = Math.max(camState.shake, 0.45 * ramp);

        for (let i = 0; i < 10; i++) {
          const a = Math.random() * Math.PI * 2;
          const spd = 30 + Math.random() * 55;
          world.padSmokePool.spawn(
            (Math.random() - 0.5) * 16, 2.0, (Math.random() - 0.5) * 16,
            Math.cos(a) * spd, 6 + Math.random() * 16, Math.sin(a) * spd,
            1.0, 0.82, 0.65, 3.0
          );
        }
      } else {
        sim.launched = true;
        showToast('00:00:00 — EXCITEMENT GUARANTEED! 🚀🔥', 'LIFTOFF! 33 Mesin Raptor Super Heavy mengangkat Starship!');
      }
    }

    if (sim.launched) {
      if (!sim.staged) {
        stepStackedAscent(dt);
      } else {
        if (sim.boosterCatchMode) stepBoosterCatch(dt);
        else { stepBoosterReturn(dt); stepStarshipMission(dt, rawDt); }
      }
    }
  }

  // Animasi halus Mechazilla Carriage & Chopsticks
  const release = THREE.MathUtils.smoothstep(sim.missionTime, -12, -4);
  world.qdArmPivot.rotation.y = 1.24 * THREE.MathUtils.smoothstep(sim.missionTime, -2, 0);
  if (!sim.boosterCatchMode && (!sim.staged || s.returnPhase === 'ASCENT')) {
    mechazilla.targetArmAngle = 0.76 * release;
    mechazilla.statusText = release === 1 ? 'LENGAN BEBAS' : release > 0 ? 'LENGAN MEMBUKA' : 'SIAGA';
  }
  const follow = 1 - Math.exp(-4 * dt);
  mechazilla.carriageY = THREE.MathUtils.lerp(mechazilla.carriageY, mechazilla.targetCarriageY, follow);
  mechazilla.armAngle = THREE.MathUtils.lerp(mechazilla.armAngle, mechazilla.targetArmAngle, follow);
  world.catchCarriageGroup.position.y = mechazilla.carriageY;
  world.chopstickLeftPivot.rotation.y = mechazilla.armAngle;
  world.chopstickRightPivot.rotation.y = -mechazilla.armAngle;

  // Sinkronisasi transform 3D Booster & Starship
  world.boosterRoot.position.copy(b.pos);
  world.boosterRoot.quaternion.copy(b.quat);
  world.boosterGridFins.forEach(f => { f.rotation.z = b.gridFinTilt; });
  world.boosterLandingLegs.forEach(l => { l.rotation.z = b.legDeploy * 0.58; });
  world.boosterLandingLegs.forEach(l => { l.visible = !sim.boosterCatchMode; });

  world.shipRoot.position.copy(s.pos);
  world.shipRoot.quaternion.copy(s.quat);
  const flapRad = s.flapAngle * 0.85;
  if (world.shipFlaps.fwdL) {
    world.shipFlaps.fwdL.rotation.y = flapRad;
    world.shipFlaps.fwdR.rotation.y = -flapRad;
    world.shipFlaps.aftL.rotation.y = flapRad;
    world.shipFlaps.aftR.rotation.y = -flapRad;
  }

  // Rotasi lambat lapisan awan global + sinkron bayangan awan pada Bumi 3D
  if (world.orbitalCloudsMesh) {
    world.orbitalCloudsMesh.rotation.y += rawDt * 0.0045;
    if (world.orbitalEarthMesh && world.orbitalEarthMesh.material.uniforms) {
      world.orbitalEarthMesh.material.uniforms.uCloudOffset.value =
        (world.orbitalCloudsMesh.rotation.y / (Math.PI * 2)) % 1.0;
    }
  }

  // Perbarui seluruh sistem partikel
  world.padSmokePool.update(dt, 0.96, 3.5);
  world.ascentTrailPool.update(dt, 0.97, 0.5);
  world.oceanSprayPool.update(dt, 0.95, 1.5);
  world.fireSparkPool.update(dt, 0.94, -4.0);
  world.orbitalPlasmaPool.update(rawDt, 0.96, 0);

  // Perbarui audio mesin Raptor & Water Deluge
  const activeThrust = Math.max(
    b.activeEngines > 0 ? (b.activeEngines / 33) * b.throttle : 0,
    s.activeEngines > 0 ? (s.activeEngines / 6) * s.throttle * 0.72 : 0
  );
  const refAlt = (camState.mode === 'booster' || camState.mode === 'asds') ? b.pos.y : s.pos.y;
  const atmF = Math.exp(-Math.max(0, refAlt) / 14000);
  updateAudio(activeThrust, atmF, delugeActive);
}

// ============================================================================
// 3. KAMERA UTAMA (ANTI-BUG ORBIT) & RENDERING DUAL LIVE MONITOR (PiP)
// ============================================================================
function updateMainCamera(rawDt) {
  const s = sim.ship;
  const b = sim.booster;
  const inOrbitScene = isShipInOrbitalScene();

  if (camState.mode === 'orbit' || (camState.mode === 'starship' && inOrbitScene)) {
    const shipPos = world.orbitalShipGroup.position.clone();
    const { camPos, lookTarget } = computeOrbitalCameraFrame(shipPos, s.orbitAngleDeg);

    if (camState.needsSnap) {
      world.camera.position.copy(camPos);
      world.controls.target.copy(lookTarget);
      camState.lastTarget.copy(lookTarget);
      camState.needsSnap = false;
    } else {
      const delta = lookTarget.clone().sub(camState.lastTarget);
      world.camera.position.add(delta);
      world.controls.target.copy(lookTarget);
      camState.lastTarget.copy(lookTarget);
    }

    // Guard anti-clipping: kamera orbit tidak boleh menembus atmosfer Bumi
    const minOrbCamDist = WORLD_COORDS.R_EARTH_ORBIT + 36.0;
    if (world.camera.position.length() < minOrbCamDist) {
      world.camera.position.normalize().multiplyScalar(minOrbCamDist);
    }

    if (camState.shake > 0.01) {
      world.camera.position.x += (Math.random() - 0.5) * camState.shake * 1.4;
      world.camera.position.y += (Math.random() - 0.5) * camState.shake * 1.4;
      camState.shake = Math.max(0, camState.shake - rawDt * 2.4);
    }

    world.controls.update();
    return;
  }

  const target = new THREE.Vector3(0, 62, 0);
  const snapOffset = new THREE.Vector3(86, 42, 128);

  if (camState.mode === 'starship') {
    target.copy(sim.staged ? s.pos : b.pos).add(new THREE.Vector3(0, sim.staged ? SPECS.shipHeight / 2 : 62, 0));
    snapOffset.set(78, 28, 108);
  } else if (camState.mode === 'booster') {
    target.copy(b.pos).add(new THREE.Vector3(0, 32, 0));
    snapOffset.set(92, 34, 118);
  } else if (camState.mode === 'mechazilla') {
    target.set(-8, 73, 0);
    snapOffset.set(66, 24, 92);
  } else if (camState.mode === 'asds') {
    target.set(WORLD_COORDS.ASDS_X, 26, WORLD_COORDS.ASDS_Z);
    snapOffset.set(75, 36, 98);
  } else if (camState.mode === 'engine') {
    const ref = (!sim.staged || sim.boosterCatchMode) ? b : s;
    target.copy(ref.pos).add(new THREE.Vector3(0, -4, 0));
    snapOffset.set(22, -6, 26);
  }

  if (camState.needsSnap) {
    if (camState.mode !== 'engine') {
      const radius = camState.mode === 'mechazilla' ? 82 : !sim.staged ? 79 : camState.mode === 'starship' ? 35 : 45;
      const halfFov = THREE.MathUtils.degToRad(world.camera.fov / 2);
      const limitingFov = Math.min(halfFov, Math.atan(Math.tan(halfFov) * world.camera.aspect));
      snapOffset.setLength(Math.max(snapOffset.length(), radius / Math.sin(limitingFov) * 1.12));
    }
    world.camera.position.copy(target).add(snapOffset);
    world.controls.target.copy(target);
    camState.lastTarget.copy(target);
    camState.needsSnap = false;
  } else {
    const delta = target.clone().sub(camState.lastTarget);
    world.camera.position.add(delta);
    world.controls.target.copy(target);
    camState.lastTarget.copy(target);
  }

  if (camState.shake > 0.01) {
    world.camera.position.x += (Math.random() - 0.5) * camState.shake * 1.8;
    world.camera.position.y += (Math.random() - 0.5) * camState.shake * 1.8;
    camState.shake = Math.max(0, camState.shake - rawDt * 2.4);
  }

  world.controls.update();
}

function renderFrame() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const s = sim.ship;
  const b = sim.booster;
  const inOrbitScene = isShipInOrbitalScene();
  const mainUsesOrbit = camState.mode === 'orbit' || (camState.mode === 'starship' && inOrbitScene);

  world.renderer.setScissorTest(false);
  world.renderer.setViewport(0, 0, w, h);
  const view = mainViewport;
  world.camera.aspect = view.width / view.height;
  world.camera.updateProjectionMatrix();
  world.renderer.clear(true, true, false);
  world.renderer.setViewport(view.left, h - view.top - view.height, view.width, view.height);
  world.camera.userData.viewport = view;
  updateGoogleWorld();

  if (mainUsesOrbit) {
    renderFlightView(world.orbitalScene, world.camera, true);
  } else {
    applySkyForAltitude(world.camera.position.y);
    renderFlightView(world.scene, world.camera, true);
  }

  if (!sim.pipVisible) return;
  world.renderer.setScissorTest(true);

  // MONITOR 1: CAM-01 // STARSHIP (ORBIT BUMI / BELLY FLOP / CHOPSTICKS CATCH)
  if (ui.pipViewShip) {
    const rect = ui.pipViewShip.getBoundingClientRect();
    if (rect.width > 10 && rect.height > 10) {
      const bottom = h - rect.bottom;
      world.renderer.setViewport(rect.left, bottom, rect.width, rect.height);
      world.renderer.setScissor(rect.left, bottom, rect.width, rect.height);
      world.starshipMonitorCam.aspect = rect.width / rect.height;
      world.starshipMonitorCam.updateProjectionMatrix();

      if (inOrbitScene) {
        const { camPos, lookTarget } = computeOrbitalCameraFrame(world.orbitalShipGroup.position, s.orbitAngleDeg);
        world.starshipMonitorCam.position.copy(camPos);
        world.starshipMonitorCam.lookAt(lookTarget);
        world.renderer.clearDepth();
        renderFlightView(world.orbitalScene, world.starshipMonitorCam);
      } else {
        const distToTower = s.pos.distanceTo(new THREE.Vector3(0, WORLD_COORDS.CATCH_RAIL_Y, 0));
        if (distToTower < 280 && sim.staged) {
          world.starshipMonitorCam.position.set(WORLD_COORDS.TOWER_X + 18, WORLD_COORDS.CATCH_RAIL_Y + 26, 48);
          world.starshipMonitorCam.lookAt(s.pos.x, s.pos.y + 22, s.pos.z);
        } else {
          world.starshipMonitorCam.position.set(s.pos.x + 48, s.pos.y + 18, s.pos.z + 64);
          world.starshipMonitorCam.lookAt(s.pos.x, s.pos.y + 22, s.pos.z);
        }
        applySkyForAltitude(world.starshipMonitorCam.position.y);
        world.renderer.clearDepth();
        renderFlightView(world.scene, world.starshipMonitorCam);
      }
    }
  }

  // MONITOR 2: CAM-02 // SUPER HEAVY BOOSTER ASDS LANDING CAM
  if (ui.pipViewBooster) {
    const rect = ui.pipViewBooster.getBoundingClientRect();
    if (rect.width > 10 && rect.height > 10) {
      const bottom = h - rect.bottom;
      world.renderer.setViewport(rect.left, bottom, rect.width, rect.height);
      world.renderer.setScissor(rect.left, bottom, rect.width, rect.height);
      world.boosterMonitorCam.aspect = rect.width / rect.height;
      world.boosterMonitorCam.updateProjectionMatrix();

      const distToASDS = b.pos.distanceTo(new THREE.Vector3(WORLD_COORDS.ASDS_X, WORLD_COORDS.ASDS_DECK_OFFSET_Y, WORLD_COORDS.ASDS_Z));
      if (sim.boosterCatchMode) {
        world.boosterMonitorCam.position.set(60, WORLD_COORDS.CATCH_RAIL_Y + 20, 75);
        world.boosterMonitorCam.lookAt(b.pos.x, b.pos.y + 32, b.pos.z);
      } else if ((distToASDS < 320 || b.landed) && sim.staged) {
        const waveY = getOceanWaveHeight(WORLD_COORDS.ASDS_X, WORLD_COORDS.ASDS_Z, sim.simClock);
        world.boosterMonitorCam.position.set(WORLD_COORDS.ASDS_X + 38, waveY + 14, WORLD_COORDS.ASDS_Z + 46);
        world.boosterMonitorCam.lookAt(b.pos.x, b.pos.y + 24, b.pos.z);
      } else {
        world.boosterMonitorCam.position.set(b.pos.x + 62, b.pos.y + 24, b.pos.z + 78);
        world.boosterMonitorCam.lookAt(b.pos.x, b.pos.y + 32, b.pos.z);
      }
      applySkyForAltitude(world.boosterMonitorCam.position.y);
      world.renderer.clearDepth();
      renderFlightView(world.scene, world.boosterMonitorCam);
    }
  }

  world.renderer.setScissorTest(false);
}

// ============================================================================
// 4. VISUALISASI HUD 2D (KLASTER RAPTOR, MINI-MAP ORBIT 360° & TIMELINE DRAWER)
// ============================================================================
function drawEngineCluster(canvas, total, active, isShip) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.beginPath();
  ctx.arc(cx, cy, 35, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.3)';
  ctx.lineWidth = 1.6;
  ctx.stroke();

  if (isShip) {
    // 3 Vacuum (luar) + 3 Sea-Level (dalam)
    const activeVac = active > 3 ? 3 : 0;
    const activeSL = Math.min(active, 3);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.PI / 3;
      const on = i < activeVac;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * 21, cy + Math.sin(a) * 21, 8.2, 0, Math.PI * 2);
      ctx.fillStyle = on ? '#818cf8' : '#1e293b';
      ctx.fill();
      ctx.strokeStyle = on ? '#e0e7ff' : '#475569';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const on = i < activeSL;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * 9.5, cy + Math.sin(a) * 9.5, 5.8, 0, Math.PI * 2);
      ctx.fillStyle = on ? '#38bdf8' : '#1e293b';
      ctx.fill();
      ctx.strokeStyle = on ? '#e0f2fe' : '#475569';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    return;
  }

  // Super Heavy 33 Raptor: 3 pusat + 10 cincin tengah + 20 cincin luar
  const drawRing = (count, radius, dotR, offsetIdx) => {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const idx = offsetIdx + i;
      const on = idx < active;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, dotR, 0, Math.PI * 2);
      ctx.fillStyle = on ? (offsetIdx < 13 ? '#38bdf8' : '#fb923c') : '#1e293b';
      ctx.fill();
    }
  };
  drawRing(3, 7.5, 3.2, 0);
  drawRing(10, 17.5, 3.0, 3);
  drawRing(20, 29.0, 2.7, 13);
}

function drawOrbitalMiniMap() {
  const c = ui.minimapCanvas;
  if (!c) return;
  const ctx = c.getContext('2d');
  const w = c.width;
  const h = c.height;
  const cx = w * 0.5;
  const cy = h * 0.52;
  const rEarth = 34;
  const rOrb = 48;

  ctx.clearRect(0, 0, w, h);

  // Atmosfer & Bola Bumi 2D
  const grad = ctx.createRadialGradient(cx - 10, cy - 10, 4, cx, cy, rEarth);
  grad.addColorStop(0, '#38bdf8');
  grad.addColorStop(0.55, '#0369a1');
  grad.addColorStop(1, '#082f49');
  ctx.beginPath();
  ctx.arc(cx, cy, rEarth, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  // Cincin Lintasan Orbit 360°
  ctx.beginPath();
  ctx.arc(cx, cy, rOrb, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Busur Progres Orbit Starship
  const startA = -Math.PI * 0.5;
  const curA = startA + THREE.MathUtils.degToRad(sim.ship.orbitAngleDeg);
  if (sim.ship.orbitAngleDeg > 0.5) {
    ctx.beginPath();
    ctx.arc(cx, cy, rOrb, startA, curA);
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 2.4;
    ctx.stroke();
  }

  // Penanda Starbase (0° di puncak)
  ctx.beginPath();
  ctx.arc(cx, cy - rEarth, 3.2, 0, Math.PI * 2);
  ctx.fillStyle = '#10b981';
  ctx.fill();

  // Posisi Starship pada cincin orbit
  const sx = cx + Math.cos(curA) * rOrb;
  const sy = cy + Math.sin(curA) * rOrb;
  ctx.beginPath();
  ctx.arc(sx, sy, 3.8, 0, Math.PI * 2);
  ctx.fillStyle = sim.ship.returnPhase === 'REENTRY_PLASMA' ? '#f43f5e' : '#f8fafc';
  ctx.fill();

  // Label sudut & arah Timur
  ctx.fillStyle = '#94a3b8';
  ctx.font = 'bold 9px JetBrains Mono, monospace';
  ctx.fillText('STARBASE 0°', cx - 30, 11);
  ctx.fillStyle = '#38bdf8';
  ctx.fillText(`${Math.round(sim.ship.orbitAngleDeg)}°`, 8, h - 8);
  ctx.fillStyle = '#f59e0b';
  ctx.fillText(sim.booster.landed ? 'ASDS ✓' : 'ASDS', w - 42, h - 8);
}

function updateTimelinePill(id, active) {
  const el = document.getElementById(id);
  if (!el) return;
  const dot = el.querySelector('span');
  if (active) {
    el.className = 'flex items-center gap-1 text-[10px] font-bold text-cyan-200 whitespace-nowrap';
    if (dot) dot.className = 'w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_#22d3ee]';
  } else {
    el.className = 'flex items-center gap-1 text-[10px] font-semibold text-slate-500 whitespace-nowrap';
    if (dot) dot.className = 'w-2 h-2 rounded-full bg-slate-700';
  }
}

function renderTimelineDrawer() {
  if (!ui.timelineList) return;
  let activeIdx = -1;
  for (let i = 0; i < TIMELINE_EVENTS.length; i++) {
    if (sim.missionTime >= TIMELINE_EVENTS[i].t) activeIdx = i;
  }

  ui.timelineList.innerHTML = TIMELINE_EVENTS.map((ev, i) => {
    const done = i < activeIdx || (ev.pre && sim.sequenceStarted);
    const current = i === activeIdx;
    const jumpAttr = ev.jump ? `data-jump-ev="${ev.jump}"` : '';
    const rowCls = current
      ? 'bg-cyan-500/20 border-cyan-400/60 text-white'
      : done
        ? 'bg-slate-900/50 border-slate-800/80 text-emerald-300/90'
        : 'bg-slate-950/60 border-slate-800/60 text-slate-400';
    const icon = current ? '▶' : (done ? '✓' : '○');
    return `<div ${jumpAttr} class="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border ${rowCls} ${ev.jump ? 'cursor-pointer hover:border-cyan-400' : ''}">
      <div class="flex items-center gap-2">
        <span class="w-3 text-center font-bold">${icon}</span>
        <span class="font-bold w-20 text-cyan-300 shrink-0">${ev.code}</span>
        <span class="text-[10px]">${ev.label}</span>
      </div>
      ${ev.jump ? '<span class="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-cyan-200 shrink-0">Lompat</span>' : ''}
    </div>`;
  }).join('');

  ui.timelineList.querySelectorAll('[data-jump-ev]').forEach(el => {
    el.addEventListener('click', () => {
      jumpToPhase(el.dataset.jumpEv);
      ui.timelineDrawer.classList.add('hidden');
    });
  });
}

function updateHUD() {
  const s = sim.ship;
  const b = sim.booster;

  ui.clock.textContent = formatMissionClock(sim.missionTime);
  ui.badgeShip.textContent = s.phase;
  ui.badgeBooster.textContent = b.phase;

  const focusBooster = sim.boosterCatchMode || camState.mode === 'booster' || camState.mode === 'asds';
  const v = focusBooster ? b : s;
  ui.telHeader.textContent = `Telemetri: ${focusBooster ? 'BOOSTER' : 'STARSHIP'}`;
  ui.telAlt.textContent = formatAlt(Math.max(0, v.pos.y - (focusBooster ? 0 : WORLD_COORDS.OLM_Y)));
  ui.telSpeed.textContent = `${Math.round(v.vel.length())} m/s`;
  ui.telTwr.textContent = v.twr.toFixed(2);
  ui.telG.textContent = `${v.gForce.toFixed(1)}G`;
  ui.telQ.textContent = `${(v.q / 1000).toFixed(1)} kPa`;
  ui.telVy.textContent = `${Math.round(v.vel.y)} m/s`;

  const upV = new THREE.Vector3(0, 1, 0).applyQuaternion(v.quat);
  const pitchDeg = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(upV.y, -1, 1)));
  ui.telPitch.textContent = `${pitchDeg.toFixed(1)}°`;
  ui.telMechazilla.textContent = mechazilla.statusText;
  ui.maxqPill.classList.toggle('hidden', !s.isMaxQ);

  ui.telOrbitProg.textContent = `${s.orbitAngleDeg.toFixed(1)}° (${Math.round((s.orbitAngleDeg / 360) * 100)}%)`;
  ui.telApoPeri.textContent = `${Math.round(s.apogeeKm)} / ${Math.round(s.perigeeKm)} km`;

  // Gimbal TVC X/Y Readout & Knob
  ui.valGx.textContent = `${THREE.MathUtils.radToDeg(v.gimbalX).toFixed(1)}°`;
  ui.valGy.textContent = `${THREE.MathUtils.radToDeg(v.gimbalY).toFixed(1)}°`;
  ui.tvcVehicle.textContent = focusBooster ? 'BOOSTER' : 'STARSHIP';
  ui.gimbalKnob.style.left = `${50 + (v.gimbalY / PHYSICS.MAX_GIMBAL_RAD) * 40}%`;
  ui.gimbalKnob.style.top = `${50 - (v.gimbalX / PHYSICS.MAX_GIMBAL_RAD) * 40}%`;

  // Bahan Bakar (Main + Header Tanks)
  const bMainPct = (b.mainProp / SPECS.bMainPropMax) * 100;
  const bHeadPct = (b.headerProp / SPECS.bHeaderPropMax) * 100;
  const sMainPct = (s.mainProp / SPECS.sMainPropMax) * 100;
  const sHeadPct = (s.headerProp / SPECS.sHeaderPropMax) * 100;
  ui.barBMain.style.width = `${bMainPct}%`;
  ui.barBHeader.style.width = `${bHeadPct}%`;
  ui.fuelBPct.textContent = `${Math.round(bMainPct * 0.92 + bHeadPct * 0.08)}%`;
  ui.barSMain.style.width = `${sMainPct}%`;
  ui.barSHeader.style.width = `${sHeadPct}%`;
  ui.fuelSPct.textContent = `${Math.round(sMainPct * 0.82 + sHeadPct * 0.18)}%`;

  // Klaster Mesin & Peta Orbit
  ui.engSummary.textContent = `S:${s.activeEngines}/6 | B:${b.activeEngines}/33`;
  drawEngineCluster(ui.clusterBooster, 33, b.activeEngines, false);
  drawEngineCluster(ui.clusterShip, 6, s.activeEngines, true);
  drawOrbitalMiniMap();

  // Telemetri Dual Live Monitor
  ui.pipShipStatus.textContent = s.phase;
  ui.pipShipAlt.textContent = formatAlt(Math.max(0, s.pos.y - WORLD_COORDS.OLM_Y));
  ui.pipShipVel.textContent = `${Math.round(s.vel.length())}`;
  ui.pipShipEng.textContent = `${s.activeEngines}/6`;
  ui.pipShipTvc.textContent = `${Math.hypot(THREE.MathUtils.radToDeg(s.gimbalX), THREE.MathUtils.radToDeg(s.gimbalY)).toFixed(0)}°`;
  ui.pipCardShip.classList.toggle('pip-critical', s.returnPhase === 'FLIP_CATCH' || s.returnPhase === 'REENTRY_PLASMA');
  ui.pipCardShip.classList.toggle('pip-success', s.caught);

  ui.pipBoosterStatus.textContent = b.phase;
  ui.pipBoosterAlt.textContent = formatAlt(Math.max(0, b.pos.y));
  ui.pipBoosterVel.textContent = `${Math.round(b.vel.length())}`;
  ui.pipBoosterEng.textContent = `${b.activeEngines}/33`;
  ui.pipBoosterTvc.textContent = `${Math.hypot(THREE.MathUtils.radToDeg(b.gimbalX), THREE.MathUtils.radToDeg(b.gimbalY)).toFixed(0)}°`;
  ui.pipCardBooster.classList.toggle('pip-critical', sim.staged && !b.landed && b.activeEngines > 0);
  ui.pipCardBooster.classList.toggle('pip-success', b.landed);

  // Sorotan Strip Timeline Bawah
  updateTimelinePill('tl-deluge', sim.missionTime >= TIMELINE.T_FLAME_DIVERTER && sim.sequenceStarted);
  updateTimelinePill('tl-liftoff', sim.launched);
  updateTimelinePill('tl-maxq', sim.missionTime >= TIMELINE.T_MAXQ_START);
  updateTimelinePill('tl-sep', sim.staged);
  updateTimelinePill('tl-boostback', sim.boostbackStarted);
  updateTimelinePill('tl-asds', b.landed);
  updateTimelinePill('tl-orbit', s.orbitAngleDeg > 5);
  updateTimelinePill('tl-entry', s.returnPhase === 'REENTRY_PLASMA' || s.orbitCompleted);
  updateTimelinePill('tl-catch', s.caught);

  // Perbarui Drawer Timeline secara live jika sedang terbuka
  if (ui.timelineDrawer && !ui.timelineDrawer.classList.contains('hidden')) {
    const tick = Math.floor(sim.simClock * 2);
    if (tick !== lastTimelineRenderTick) {
      lastTimelineRenderTick = tick;
      renderTimelineDrawer();
    }
  }
}

// ============================================================================
// 5. KENDALI KAMERA, RESET & LOMPAT FASE MISI
// ============================================================================
function setCameraMode(mode) {
  camState.mode = mode;
  camState.needsSnap = true;
  document.querySelectorAll('.cam-btn').forEach(btn => {
    const active = btn.dataset.cam === mode;
    btn.className = active
      ? 'cam-btn px-2 py-1.5 rounded-lg text-[11px] font-bold bg-cyan-500/30 text-cyan-100 border border-cyan-400/50 transition'
      : 'cam-btn px-2 py-1.5 rounded-lg text-[11px] font-bold bg-slate-800/85 hover:bg-slate-700 text-slate-300 border border-slate-700 transition';
  });
}

function resetSimulation(startImmediately = false) {
  fixedAccumulator = 0;
  sim.boosterCatchMode = false;
  world.shipRoot.visible = true;
  sim.paused = false;
  sim.sequenceStarted = startImmediately;
  sim.launched = false;
  sim.staged = false;
  sim.shipIgnitedAfterSep = false;
  sim.mecoTriggered = false;
  sim.flameDiverterTriggered = false;
  sim.boostbackStarted = false;
  sim.boostbackEnded = false;
  sim.ignitionBoomDone = false;
  sim.launchSonicBoomDone = false;
  sim.boosterSonicBoomDone = false;
  sim.shipLandingBoomDone = false;
  sim.oibNotified = false;
  sim.deployNotified = false;
  sim.deorbitNotified = false;
  sim.entryNotified = false;
  sim.orbitalTimeRate = 1;
  sim.missionTime = TIMELINE.T_COUNTDOWN;

  const b = sim.booster;
  b.pos.set(0, WORLD_COORDS.OLM_Y, 0);
  b.vel.set(0, 0, 0);
  b.quat.identity();
  b.angVel.set(0, 0, 0);
  b.mainProp = SPECS.bMainPropMax;
  b.headerProp = SPECS.bHeaderPropMax;
  b.gimbalX = 0; b.gimbalY = 0; b.throttle = 0; b.activeEngines = 0;
  b.twr = 0; b.gForce = 1.0; b.q = 0; b.legDeploy = 0; b.gridFinTilt = 0;
  b.landed = false; b.phase = 'SIAP LUNCUR'; b.path = [];
  b.failed = false;

  const s = sim.ship;
  s.pos.set(0, WORLD_COORDS.OLM_Y + SPECS.boosterHeight + SPECS.interstageHeight, 0);
  s.vel.set(0, 0, 0);
  s.quat.identity();
  s.angVel.set(0, 0, 0);
  s.mainProp = SPECS.sMainPropMax;
  s.headerProp = SPECS.sHeaderPropMax;
  s.gimbalX = 0; s.gimbalY = 0; s.throttle = 0; s.activeEngines = 0;
  s.twr = 0; s.gForce = 1.0; s.q = 0; s.isMaxQ = false; s.flapAngle = 0;
  s.orbitAngleDeg = 0; s.orbitCompleted = false; s.apogeeKm = 0; s.perigeeKm = 0;
  s.plasmaIntensity = 0; s.rcsActive = false; s.payloadDoorOpen = 0; s.starlinksDeployed = 0;
  s.returnPhase = 'ASCENT';
  s.caught = false; s.phase = 'SIAP LUNCUR'; s.path = [];

  if (world.orbitalShipGroup) {
    world.orbitalShipGroup.position.copy(world.orbitU).multiplyScalar(WORLD_COORDS.R_ORBIT_LEO);
    world.orbitalShipGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), world.orbitV);
  }
  if (world.starlinkDoorMesh) world.starlinkDoorMesh.rotation.z = 0;
  clearStarlinkSats();

  mechazilla.carriageY = 108.0;
  mechazilla.targetCarriageY = 108.0;
  mechazilla.armAngle = 0;
  mechazilla.targetArmAngle = 0;
  mechazilla.statusText = 'SIAGA';
  world.qdArmPivot.rotation.y = 0;

  world.boosterEngineLight.intensity = 0;
  world.shipEngineLight.intensity = 0;
  world.orbitalPlasmaMesh.visible = false;
  world.orbitalPlasmaLight.intensity = 0;
  applyBoosterEngineVisuals(0, 0, 0);
  applyShipEngineVisuals(0, 0, 0, 0);
  applyShipEngineVisuals(0, 0, 0, 0, world.orbitalShipSLEngines, world.orbitalShipVacEngines);

  world.padSmokePool.clear();
  world.ascentTrailPool.clear();
  world.oceanSprayPool.clear();
  world.fireSparkPool.clear();
  world.orbitalPlasmaPool.clear();

  ui.btnPause.textContent = '⏸ Jeda';
  setCameraMode('starship');
}

function jumpToPhase(preset) {
  initAudio();
  resetSimulation(true);
  const b = sim.booster;
  const s = sim.ship;

  if (preset === 'booster_catch') {
    sim.boosterCatchMode = true;
    sim.launched = sim.staged = true;
    sim.missionTime = TIMELINE.T_BOOSTER_LAND_START;
    b.pos.set(12, 700, -5); b.vel.set(-2, -60, 1);
    b.mainProp = 0; b.headerProp = 90000;
    b.quat.setFromEuler(new THREE.Euler(0.015, 0, -0.035));
    s.returnPhase = 'PARKED'; s.phase = 'LATIHAN BOOSTER CATCH';
    world.shipRoot.visible = false;
    mechazilla.carriageY = mechazilla.targetCarriageY = WORLD_COORDS.CATCH_RAIL_Y;
    mechazilla.armAngle = mechazilla.targetArmAngle = 0.65;
    setCameraMode('booster');
    showToast('LATIHAN BOOSTER CATCH', 'Guidance TVC, drag dan gravitasi; pin harus mencapai bantalan dengan kecepatan rendah.');
  } else if (preset === 'launch') {
    showToast('FASE 1: COUNTDOWN & PELUNCURAN 🚀', 'T-00:00:18 menuju Flame Diverter (T-17s), Booster Startup (T-3s) & Liftoff!');
  } else if (preset === 'hotstage') {
    sim.launched = true;
    sim.flameDiverterTriggered = true;
    sim.ignitionBoomDone = true;
    sim.launchSonicBoomDone = true;
    sim.missionTime = 138.0; // 2 detik sebelum MECO (02:20) & Separation (02:22)
    b.pos.set(42000, 68000, 0);
    b.vel.set(1450, 820, 0);
    b.quat.setFromEuler(new THREE.Euler(0, 0, -1.02));
    b.mainProp = SPECS.bMainPropMax * 0.08;
    s.pos.copy(b.pos).add(new THREE.Vector3(60, 40, 0));
    s.vel.copy(b.vel);
    s.quat.copy(b.quat);
    setCameraMode('starship');
    showToast(
      'FASE 2: MECO (02:20) → SEPARATION (02:22) → BOOSTBACK (02:27) 🚀',
      'Booster terpisah lebih dulu sebelum 6 Raptor Starship menyala, lalu Booster melakukan Boostback Burn!'
    );
  } else if (preset === 'booster_land') {
    sim.launched = true; sim.staged = true; sim.mecoTriggered = true; sim.shipIgnitedAfterSep = true;
    sim.flameDiverterTriggered = true; sim.boostbackStarted = true; sim.boostbackEnded = true;
    sim.ignitionBoomDone = true; sim.launchSonicBoomDone = true;
    sim.missionTime = 386.0;
    b.pos.set(WORLD_COORDS.ASDS_X - 180, 2350, 45);
    b.vel.set(16, -125, -4);
    b.mainProp = 0;
    s.returnPhase = 'ORBIT_COAST_OIB';
    s.orbitAngleDeg = 10.0;
    setCameraMode('booster');
    showToast(
      'FASE 3: BOOSTER LANDING BURN (00:06:36 → 00:07:01) 🚢',
      'Super Heavy Booster meluncur dengan Grid Fins, Double Sonic Boom, & mendarat di Pad Laut ASDS!'
    );
  } else if (preset === 'orbit') {
    sim.launched = true; sim.staged = true; sim.mecoTriggered = true; sim.shipIgnitedAfterSep = true;
    sim.flameDiverterTriggered = true; sim.boostbackStarted = true; sim.boostbackEnded = true;
    sim.ignitionBoomDone = true; sim.launchSonicBoomDone = true;
    sim.missionTime = TIMELINE.T_OIB_START - 40.0;
    b.landed = true; b.phase = 'LANDING BURN SHUTDOWN ✓';
    s.returnPhase = 'ORBIT_COAST_OIB';
    s.orbitAngleDeg = 12.0; s.apogeeKm = 185; s.perigeeKm = 152;
    setCameraMode('orbit');
    showToast(
      'FASE 4: ORBIT BUMI FOTOREALISTIS & STARLINK DEPLOY 🌍🛰️',
      'Saksikan Orbital Insertion Burn (00:25:17) dan pelepasan 10 satelit Starlink (00:34:07)!'
    );
  } else if (preset === 'reentry') {
    sim.launched = true; sim.staged = true; sim.mecoTriggered = true; sim.shipIgnitedAfterSep = true;
    sim.flameDiverterTriggered = true; sim.boostbackStarted = true; sim.boostbackEnded = true;
    sim.oibNotified = true; sim.deployNotified = true;
    sim.ignitionBoomDone = true; sim.launchSonicBoomDone = true;
    sim.missionTime = TIMELINE.T_DEORBIT_START - 10.0;
    b.landed = true; b.phase = 'LANDING BURN SHUTDOWN ✓';
    s.returnPhase = 'ORBIT_COAST_MAIN';
    s.orbitAngleDeg = 307.0; s.apogeeKm = 185; s.perigeeKm = 185;
    setCameraMode('orbit');
    showToast(
      'FASE 5: DEORBIT (08:52:37) & ENTRY PLASMA (09:28:56) ☄️🔥',
      'Starship melakukan Deorbit Burn retrograde dan menembus atmosfer menyala plasma menuju Starbase!'
    );
  } else if (preset === 'catch') {
    sim.launched = true; sim.staged = true; sim.mecoTriggered = true; sim.shipIgnitedAfterSep = true;
    sim.flameDiverterTriggered = true; sim.boostbackStarted = true; sim.boostbackEnded = true;
    sim.oibNotified = true; sim.deployNotified = true; sim.deorbitNotified = true; sim.entryNotified = true;
    sim.ignitionBoomDone = true; sim.launchSonicBoomDone = true;
    sim.missionTime = TIMELINE.T_SUBSONIC;
    b.landed = true; b.phase = 'LANDING BURN SHUTDOWN ✓';
    s.orbitAngleDeg = 360; s.orbitCompleted = true;
    s.returnPhase = 'BELLY_FLOP';
    s.pos.set(160, 1280, 14);
    s.vel.set(-14, -72, -1.0);
    s.quat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-0.98, 0.16, 0).normalize());
    s.flapAngle = 0.9;
    setCameraMode('mechazilla');
    showToast(
      'FASE 6: MECHAZILLA CATCH (09:50:11 → 09:50:30) 🦾',
      'Landing Burn 3 → Flip → 2 → 1 Raptor tepat ke jepitan Chopsticks Mechazilla!'
    );
  }
}

// ============================================================================
// 6. BINDING UI, LAYOUT HEADER DINAMIS & LOOP ANIMASI UTAMA
// ============================================================================
function cacheUI() {
  const byId = id => document.getElementById(id);
  Object.assign(ui, {
    topHeader: byId('top-header'),
    leftPanel: byId('left-panel'),
    rightPanel: byId('right-panel'),
    clock: byId('mission-clock'),
    badgeShip: byId('badge-ship'),
    badgeBooster: byId('badge-booster'),
    toast: byId('event-toast'),
    toastTitle: byId('event-toast-title'),
    toastMsg: byId('event-toast-msg'),
    timelineDrawer: byId('timeline-drawer'),
    timelineList: byId('timeline-list'),
    btnLaunch: byId('btn-launch'),
    btnPause: byId('btn-pause'),
    btnReset: byId('btn-reset'),
    btnSas: byId('btn-sas'),
    btnStage: byId('btn-stage'),
    btnAutoTvc: byId('btn-auto-tvc'),
    btnPipToggle: byId('btn-pip-toggle'),
    btnPipSize: byId('btn-pip-size'),
    btnTimelineDrawer: byId('btn-timeline-drawer'),
    btnCloseTimeline: byId('btn-close-timeline'),
    btnAudio: byId('btn-audio'),
    gimbalPad: byId('gimbal-pad'),
    gimbalKnob: byId('gimbal-knob'),
    tvcVehicle: byId('tvc-vehicle'),
    valGx: byId('val-gx'),
    valGy: byId('val-gy'),
    engSummary: byId('eng-summary'),
    clusterBooster: byId('cluster-booster'),
    clusterShip: byId('cluster-ship'),
    telHeader: byId('tel-header'),
    maxqPill: byId('maxq-pill'),
    telAlt: byId('tel-alt'),
    telSpeed: byId('tel-speed'),
    telTwr: byId('tel-twr'),
    telG: byId('tel-g'),
    telQ: byId('tel-q'),
    telVy: byId('tel-vy'),
    telPitch: byId('tel-pitch'),
    telMechazilla: byId('tel-mechazilla'),
    telOrbitProg: byId('tel-orbit-prog'),
    telApoPeri: byId('tel-apo-peri'),
    fuelBPct: byId('fuel-b-pct'),
    barBMain: byId('bar-b-main'),
    barBHeader: byId('bar-b-header'),
    fuelSPct: byId('fuel-s-pct'),
    barSMain: byId('bar-s-main'),
    barSHeader: byId('bar-s-header'),
    minimapCanvas: byId('minimap-canvas'),
    pipDock: byId('pip-dock'),
    pipCardShip: byId('pip-card-ship'),
    pipViewShip: byId('pip-view-ship'),
    pipShipStatus: byId('pip-ship-status'),
    pipShipAlt: byId('pip-ship-alt'),
    pipShipVel: byId('pip-ship-vel'),
    pipShipEng: byId('pip-ship-eng'),
    pipShipTvc: byId('pip-ship-tvc'),
    pipCardBooster: byId('pip-card-booster'),
    pipViewBooster: byId('pip-view-booster'),
    pipBoosterStatus: byId('pip-booster-status'),
    pipBoosterAlt: byId('pip-booster-alt'),
    pipBoosterVel: byId('pip-booster-vel'),
    pipBoosterEng: byId('pip-booster-eng'),
    pipBoosterTvc: byId('pip-booster-tvc')
  });
}

/**
 * Menjaga posisi atas panel samping, toast & drawer selalu di bawah tinggi header aktual
 * agar tombol "▶ LUNCURKAN STARSHIP" tidak pernah tertimpa di ukuran layar apa pun.
 */
function syncHeaderLayout() {
  if (!ui.topHeader) return;
  const topPx = ui.topHeader.getBoundingClientRect().height + 8;
  [ui.leftPanel, ui.rightPanel, ui.toast, ui.timelineDrawer].forEach(el => {
    if (el) el.style.top = `${topPx}px`;
  });
  const root = document.documentElement;
  root.style.setProperty('--hud-top', `${topPx}px`);
  const monitorHeight = Math.min(sim.pipEnlarged ? 174 : 124, Math.max(50, (window.innerHeight - topPx - 140) / 3));
  ui.pipDock.style.setProperty('--monitor-height', `${monitorHeight}px`);
  const dock = ui.pipDock.getBoundingClientRect();
  const rightTop = sim.pipVisible ? dock.bottom + 8 : topPx;
  ui.rightPanel.style.top = `${rightTop}px`;
  ui.rightPanel.style.maxHeight = `${Math.max(0, window.innerHeight - rightTop - 44)}px`;
  const hudVisible = !document.body.classList.contains('hud-hidden');
  const left = hudVisible ? ui.leftPanel.getBoundingClientRect().right + 10 : 10;
  const right = Math.max(sim.pipVisible ? dock.width + 20 : 0, hudVisible && window.innerWidth > 900 ? 268 : 10);
  mainViewport = { left, top: topPx, width: Math.max(80, window.innerWidth - left - right), height: Math.max(80, window.innerHeight - topPx - 42) };
  root.style.setProperty('--view-left', `${mainViewport.left}px`);
  root.style.setProperty('--view-width', `${mainViewport.width}px`);
  root.style.setProperty('--view-height', `${mainViewport.height}px`);
  world.camera.aspect = mainViewport.width / mainViewport.height;
  world.camera.updateProjectionMatrix();
  camState.needsSnap = true;
}

let mainViewport = { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };

function setupUIEvents() {
  if (window.innerWidth < 900) {
    document.body.classList.add('hud-hidden');
    document.getElementById('btn-hud-toggle').textContent = 'HUD: OFF';
    document.getElementById('btn-hud-toggle').setAttribute('aria-pressed', 'false');
  }
  document.getElementById('btn-hud-toggle').addEventListener('click', e => {
    const hidden = document.body.classList.toggle('hud-hidden');
    e.currentTarget.textContent = hidden ? 'HUD: OFF' : 'HUD: ON';
    e.currentTarget.setAttribute('aria-pressed', String(!hidden));
    syncHeaderLayout();
  });
  document.getElementById('btn-world').addEventListener('click', toggleGoogleWorld);
  document.getElementById('map-settings-close').addEventListener('click', () => document.getElementById('map-settings').close());
  document.getElementById('map-settings-form').addEventListener('submit', e => {
    e.preventDefault();
    const key = document.getElementById('map-api-key').value.trim();
    if (!key) return;
    try { localStorage.setItem('starbase.googleMapsKey', key); }
    catch { document.getElementById('map-settings-status').textContent = 'Penyimpanan browser tidak tersedia.'; return; }
    document.getElementById('map-settings').close();
    toggleGoogleWorld();
  });
  if (window.ResizeObserver && ui.topHeader) {
    new ResizeObserver(syncHeaderLayout).observe(ui.topHeader);
  }
  syncHeaderLayout();

  ui.btnLaunch.addEventListener('click', () => {
    initAudio();
    if (!sim.sequenceStarted) {
      sim.sequenceStarted = true;
      showToast('HITUNG MUNDUR DIMULAI (T-00:00:18) 🚀', 'T-17s Flame Diverter aktif, T-3s 33 Raptor menyala, T-00:00:00 Liftoff!');
    } else {
      resetSimulation(true);
      showToast('PELUNCURAN ULANG 🚀', 'Urutan peluncuran Starship dimulai kembali dari T-00:00:18.');
    }
  });

  ui.btnPause.addEventListener('click', () => {
    sim.paused = !sim.paused;
    ui.btnPause.textContent = sim.paused ? '▶ Lanjut' : '⏸ Jeda';
  });

  ui.btnReset.addEventListener('click', () => {
    resetSimulation(false);
    showToast('SIMULASI DIRESET', 'Starship & Super Heavy kembali siaga di Orbital Launch Mount Starbase.');
  });

  ui.btnSas.addEventListener('click', () => {
    sim.sasEnabled = !sim.sasEnabled;
    ui.btnSas.textContent = sim.sasEnabled ? 'SAS: ON (T)' : 'SAS: OFF (T)';
    ui.btnSas.className = sim.sasEnabled
      ? 'py-1 rounded-lg text-[10px] font-bold bg-emerald-500/20 text-emerald-200 border border-emerald-400/40 transition'
      : 'py-1 rounded-lg text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700 transition';
  });

  ui.btnStage.addEventListener('click', () => {
    if (sim.launched && !sim.staged) {
      sim.missionTime = Math.max(sim.missionTime, TIMELINE.T_SEP);
      triggerStageSeparation();
    }
  });

  ui.btnAutoTvc.addEventListener('click', () => {
    sim.autoMode = !sim.autoMode;
    ui.btnAutoTvc.textContent = sim.autoMode ? 'AUTO ORBIT' : 'MANUAL TVC';
    ui.btnAutoTvc.className = sim.autoMode
      ? 'px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-500/25 text-cyan-200 border border-cyan-400/45 transition'
      : 'px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/25 text-amber-200 border border-amber-400/45 transition';
  });

  ui.btnTimelineDrawer.addEventListener('click', () => {
    ui.timelineDrawer.classList.toggle('hidden');
    if (!ui.timelineDrawer.classList.contains('hidden')) renderTimelineDrawer();
  });

  ui.btnCloseTimeline.addEventListener('click', () => {
    ui.timelineDrawer.classList.add('hidden');
  });

  ui.btnAudio.addEventListener('click', () => {
    setAudioEnabled(!sim.audioEnabled);
    ui.btnAudio.textContent = sim.audioEnabled ? '🔊 ON' : '🔇 OFF';
  });

  ui.btnPipToggle.addEventListener('click', () => {
    sim.pipVisible = !sim.pipVisible;
    ui.pipDock.classList.toggle('hidden', !sim.pipVisible);
    ui.btnPipToggle.textContent = sim.pipVisible ? '📺 Monitor: ON' : '📺 Monitor: OFF';
    ui.btnPipToggle.setAttribute('aria-expanded', String(sim.pipVisible));
    syncHeaderLayout();
  });

  ui.btnPipSize.addEventListener('click', () => {
    sim.pipEnlarged = !sim.pipEnlarged;
    ui.pipDock.classList.toggle('pip-enlarged', sim.pipEnlarged);
    ui.btnPipSize.textContent = sim.pipEnlarged ? '🗗 Kecilkan' : '⛶ Perbesar';
    syncHeaderLayout();
  });

  // Klik langsung layar monitor PiP untuk fokus kamera utama ke wahana tersebut
  ui.pipCardShip.addEventListener('click', () => {
    setCameraMode(
      isShipInOrbitalScene()
        ? 'orbit'
        : (sim.ship.returnPhase === 'FLIP_CATCH' || sim.ship.caught ? 'mechazilla' : 'starship')
    );
  });

  ui.pipCardBooster.addEventListener('click', () => {
    setCameraMode(sim.boosterCatchMode ? 'booster' : sim.booster.landed ? 'asds' : 'booster');
  });

  document.querySelectorAll('.cam-btn').forEach(btn => {
    btn.addEventListener('click', () => setCameraMode(btn.dataset.cam));
  });

  document.querySelectorAll('.jump-btn').forEach(btn => {
    btn.addEventListener('click', () => jumpToPhase(btn.dataset.jump));
  });

  document.querySelectorAll('.warp-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      sim.timeWarp = parseFloat(btn.dataset.warp);
      document.querySelectorAll('.warp-btn').forEach(b => {
        const active = b === btn;
        b.className = active
          ? 'warp-btn px-1.5 py-0.5 rounded-md text-[10px] font-mono-num font-bold bg-cyan-500/30 text-cyan-200 border border-cyan-400/40'
          : 'warp-btn px-1.5 py-0.5 rounded-md text-[10px] font-mono-num font-bold bg-slate-800/80 text-slate-400 border border-slate-700 hover:text-white';
      });
    });
  });

  // Pad Gimbal TVC 2D Interaktif (Seret untuk menggerakkan nozzle X & Y)
  let dragging = false;
  const updateGimbalFromPointer = e => {
    const rect = ui.gimbalPad.getBoundingClientRect();
    const nx = THREE.MathUtils.clamp(((e.clientX - rect.left) / rect.width) * 2 - 1, -1, 1);
    const ny = THREE.MathUtils.clamp(((e.clientY - rect.top) / rect.height) * 2 - 1, -1, 1);
    sim.manualGimbalY = nx;
    sim.manualGimbalX = -ny;
    if (sim.autoMode) ui.btnAutoTvc.click();
  };

  ui.gimbalPad.addEventListener('pointerdown', e => {
    dragging = true;
    ui.gimbalPad.setPointerCapture(e.pointerId);
    updateGimbalFromPointer(e);
  });
  ui.gimbalPad.addEventListener('pointermove', e => {
    if (dragging) updateGimbalFromPointer(e);
  });
  const endPadDrag = () => {
    dragging = false;
    sim.manualGimbalX = 0;
    sim.manualGimbalY = 0;
  };
  ui.gimbalPad.addEventListener('pointerup', endPadDrag);
  ui.gimbalPad.addEventListener('pointercancel', endPadDrag);

  // Pintasan Keyboard: W/A/S/D (Gimbal TVC), T (SAS), Space (Separasi), P (Jeda)
  window.addEventListener('keydown', e => {
    if (e.target instanceof HTMLElement && (e.target.matches('input, textarea, select') || e.target.isContentEditable)) return;
    const k = e.key.toLowerCase();
    if (k === 'w' || k === 'arrowup') { sim.keys.w = true; if (sim.autoMode) ui.btnAutoTvc.click(); }
    if (k === 's' || k === 'arrowdown') { sim.keys.s = true; if (sim.autoMode) ui.btnAutoTvc.click(); }
    if (k === 'a' || k === 'arrowleft') { sim.keys.a = true; if (sim.autoMode) ui.btnAutoTvc.click(); }
    if (k === 'd' || k === 'arrowright') { sim.keys.d = true; if (sim.autoMode) ui.btnAutoTvc.click(); }
    if (k === 't') ui.btnSas.click();
    if (k === 'p') ui.btnPause.click();
    if (e.code === 'Space') {
      e.preventDefault();
      ui.btnStage.click();
    }
  });

  window.addEventListener('keyup', e => {
    if (e.target instanceof HTMLElement && (e.target.matches('input, textarea, select') || e.target.isContentEditable)) return;
    const k = e.key.toLowerCase();
    if (k === 'w' || k === 'arrowup') sim.keys.w = false;
    if (k === 's' || k === 'arrowdown') sim.keys.s = false;
    if (k === 'a' || k === 'arrowleft') sim.keys.a = false;
    if (k === 'd' || k === 'arrowright') sim.keys.d = false;
    if (!sim.keys.w && !sim.keys.s) sim.manualGimbalX = 0;
    if (!sim.keys.a && !sim.keys.d) sim.manualGimbalY = 0;
  });

  window.addEventListener('resize', () => {
    world.renderer.setSize(window.innerWidth, window.innerHeight);
    world.camera.aspect = window.innerWidth / window.innerHeight;
    world.camera.updateProjectionMatrix();
    syncHeaderLayout();
  });
}

// ============================================================================
// 7. BOOTSTRAP APLIKASI & MAIN LOOP 60 FPS
// ============================================================================
let lastTimestamp = performance.now();
let fixedAccumulator = 0;

function animate(now) {
  requestAnimationFrame(animate);
  const rawDt = Math.min((now - lastTimestamp) / 1000, 0.05);
  lastTimestamp = now;

  if (!sim.paused) {
    fixedAccumulator += rawDt * sim.timeWarp;
    while (fixedAccumulator >= 1 / 90) {
      stepSimulation(1 / (90 * sim.timeWarp));
      fixedAccumulator -= 1 / 90;
      if (sim.paused) { fixedAccumulator = 0; break; }
    }
  } else { fixedAccumulator = 0; updateAudio(0, 1, false); }
  updateMainCamera(rawDt);
  renderFrame();
  updateHUD();
}

function bootstrap() {
  try {
    cacheUI();
    buildWorld(document.getElementById('webgl-canvas'));
    setupUIEvents();
    const cutaway = document.getElementById('btn-cutaway');
    cutaway.addEventListener('click', () => {
      const enabled = cutaway.getAttribute('aria-pressed') !== 'true';
      for (const ship of [world.shipRoot, world.orbitalShipGroup]) ship.userData.setCutaway(enabled);
      cutaway.setAttribute('aria-pressed', String(enabled));
      cutaway.textContent = `Cutaway Starship: ${enabled ? 'ON' : 'OFF'}`;
    });
    resetSimulation(false);
    lastTimestamp = performance.now();
    requestAnimationFrame(animate);
  } catch (err) {
    console.error('Gagal menginisialisasi Simulator Starship 3D:', err);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
