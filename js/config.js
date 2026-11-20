/* ============================================================================
   STARSHIP & SUPER HEAVY — 3D FLIGHT SIMULATOR
   File 3/6: js/config.js
   Konstanta fisika roket dunia nyata, spesifikasi teknis Starship & Super Heavy,
   koordinat Mechazilla & ASDS, Timeline resmi SpaceX, dan state simulasi bersama.
   ============================================================================ */

import * as THREE from 'three';

// Browser Map Tiles key: restricted by API/referrer in Google Cloud, not a server secret.
export const TERRAIN = {
  get apiKey() {
    try { return localStorage.getItem('starbase.googleMapsKey') || ''; }
    catch { return ''; }
  },
  latitude: 25.997, longitude: -97.156, timeoutMs: 22000
};
export const RENDER_SCALE = 0.1; // Physics/HUD stay in metres; rendering uses 1 unit = 10 m.
export const Logger = { error: message => console.error(message) };

// --- 1. KONSTANTA FISIKA BUMI & ATMOSFER ---
export const PHYSICS = {
  G0: 9.80665,                          // Gravitasi permukaan Bumi (m/s^2)
  EARTH_RADIUS: 6371000.0,              // Radius rata-rata Bumi (m)
  RHO0: 1.225,                          // Kerapatan udara permukaan laut (kg/m^3)
  SCALE_HEIGHT: 8500.0,                 // Skala ketinggian atmosfer eksponensial (m)
  MAX_GIMBAL_DEG: 15.0,                 // Batas gerak fleksibel TVC X & Y (±15°)
  MAX_GIMBAL_RAD: THREE.MathUtils.degToRad(15.0)
};

// --- 2. GEOMETRI & KOORDINAT LANDASAN (STARBASE OLM, MECHAZILLA, ASDS) ---
export const WORLD_COORDS = {
  OLM_Y: 16.0,                          // Tinggi dek Orbital Launch Mount (m)
  TOWER_X: -22.0,                       // Posisi X Menara Mechazilla (m)
  CATCH_RAIL_Y: 92.0,                   // Ketinggian rel penangkapan Chopsticks (m)
  SHIP_PIN_LOCAL_Y: 44.0,
  BOOSTER_PIN_LOCAL_Y: 63.0,
  get BOOSTER_CAUGHT_BASE_Y() { return this.CATCH_RAIL_Y - this.BOOSTER_PIN_LOCAL_Y + 0.5; },
  get SHIP_CAUGHT_BASE_Y() { return this.CATCH_RAIL_Y - this.SHIP_PIN_LOCAL_Y + 0.5; },
  ASDS_X: 65000.0,                      // Jarak Pad Laut Apung (ASDS) ke Timur (65 km)
  ASDS_Z: 0.0,
  ASDS_DECK_OFFSET_Y: 4.2,              // Tinggi permukaan dek ASDS di atas muka air (m)
  R_EARTH_ORBIT: 640.0,                 // Radius bola Bumi 3D pada scene Orbit
  R_ORBIT_LEO: 702.0,                   // Radius lintasan orbit LEO 360°
  ORBIT_SUN_DIR: new THREE.Vector3(0.32, 0.34, 0.88).normalize()
};

// --- 3. SPESIFIKASI TEKNIS STARSHIP & SUPER HEAVY ---
export const SPECS = {
  // Super Heavy Booster (33 Mesin Raptor: 20 luar tetap + 13 dalam gimbal X/Y)
  boosterHeight: 66.8,                 // Body + 2.2 m hot-stage ring = 69 m
  interstageHeight: 2.2,
  bDryMass: 245000,                     // Massa kering Booster (kg)
  bMainPropMax: 3120000,                // Tangki utama LOX/CH4 (kg)
  bHeaderPropMax: 280000,               // Tangki cadangan pendaratan Booster (kg)
  bMaxThrust: 74400000,                 // Total gaya dorong 33 Raptor (~74.4 MN)
  bIspSL: 327,                          // Specific Impulse permukaan laut (s)
  bIspVac: 350,                         // Specific Impulse vakum (s)

  // Starship Upper Stage (6 Mesin Raptor: 3 Sea-Level gimbal X/Y + 3 Vacuum)
  shipHeight: 55.0,
  sDryMass: 100000,                     // Massa kering Starship (kg)
  sMainPropMax: 1020000,                // Tangki utama LOX/CH4 (kg)
  sHeaderPropMax: 45000,                // Landing reserve (illustrative, not flight telemetry)
  sMaxThrust: 14700000,                 // Total gaya dorong 6 Raptor (~14.7 MN)
  sSingleSLThrust: 2300000,             // Gaya dorong 1 Raptor Sea-Level (~2.3 MN)
  sIspSL: 327,
  sIspVac: 378
};

// --- 4. WAKTU TIMELINE RESMI SPACEX (DETIK) ---
export const TIMELINE = {
  T_COUNTDOWN: -18.0,                   // Mulai tepat sebelum Flame Diverter (T-17s)
  T_FLAME_DIVERTER: -17.0,              // T-00:00:17 Flame Diverter Activation
  T_IGNITION: -3.0,                     // T-00:00:03 Booster Engine Startup Command
  T_PITCH_START: 12.0,                  // Awal Eastward Gravity Turn (Timur 90°)
  T_MAXQ_START: 48.0,
  T_MAXQ_PEAK: 58.0,                    // 00:00:58 Max-Q
  T_MAXQ_END: 68.0,
  T_MECO: 140.0,                        // 00:02:20 Super Heavy MECO
  T_SEP: 142.0,                         // 00:02:22 Booster Separation DULU!
  T_SHIP_IGNITION: 143.2,               // 00:02:23.2 Starship Raptor Ignition SETELAH terpisah!
  T_BOOSTBACK_START: 147.0,             // 00:02:27 Super Heavy Boostback Burn Start
  T_BOOSTBACK_END: 187.0,               // 00:03:07 Super Heavy Boostback Burn Shutdown
  T_BOOSTER_LAND_START: 396.0,          // 00:06:36 Super Heavy Landing Burn Start
  T_BOOSTER_LAND_END: 421.0,            // 00:07:01 Super Heavy Landing Burn Shutdown
  T_SECO: 491.0,                        // 00:08:11 Starship Engine Cutoff (SECO)
  T_OIB_START: 1517.0,                  // 00:25:17 Orbital Insertion Burn Start
  T_OIB_END: 1536.0,                    // 00:25:36 Orbital Insertion Burn Shutdown
  T_DEPLOY_START: 2047.0,               // 00:34:07 Starlink Payload Deploy Start
  T_DEPLOY_END: 3879.0,                 // 01:04:39 Starlink Payload Deploy Complete
  T_DEORBIT_START: 31957.0,             // 08:52:37 Deorbit Burn Start
  T_DEORBIT_END: 31968.0,               // 08:52:48 Deorbit Burn Shutdown
  T_ENTRY_START: 34136.0,               // 09:28:56 Starship Entry (Plasma)
  T_TRANSONIC: 35249.0,                 // 09:47:29 Starship is Transonic (Sonic Boom)
  T_SUBSONIC: 35287.0,                  // 09:48:07 Starship is Subsonic (Belly Flop)
  T_LAND_BURN: 35411.0,                 // 09:50:11 Landing Burn Start (3 Engines)
  T_LAND_FLIP: 35413.0,                 // 09:50:13 Landing Flip
  T_LAND_3_TO_2: 35421.0,               // 09:50:21 Landing Burn 3 to 2 Engines
  T_LAND_2_TO_1: 35428.0,               // 09:50:28 Landing Burn 2 to 1 Engine
  T_LAND_CATCH: 35430.0                 // 09:50:30 An Exciting Landing! (Mechazilla Catch)
};

// Daftar tabel lengkap Countdown & Flight Timeline untuk Drawer UI
export const TIMELINE_EVENTS = [
  { t: -3000, code: 'T-00:50:00', label: 'FLIGHT DIRECTOR POLL — GO FOR PROPELLANT LOAD', pre: true },
  { t: -2193, code: 'T-00:36:33', label: 'BOOSTER LOX (LIQUID OXYGEN) LOAD UNDERWAY', pre: true },
  { t: -2100, code: 'T-00:35:00', label: 'BOOSTER FUEL (LIQUID METHANE) LOAD UNDERWAY', pre: true },
  { t: -2053, code: 'T-00:34:13', label: 'SHIP LOX LOAD UNDERWAY', pre: true },
  { t: -2051, code: 'T-00:34:11', label: 'SHIP FUEL LOAD UNDERWAY', pre: true },
  { t: -1300, code: 'T-00:21:40', label: 'RAPTOR BEGINS ENGINE CHILL ON BOOSTER & SHIP', pre: true },
  { t: -170,  code: 'T-00:02:50', label: 'BOOSTER PROPELLANT LOAD COMPLETE', pre: true },
  { t: -130,  code: 'T-00:02:10', label: 'SHIP PROPELLANT LOAD COMPLETE', pre: true },
  { t: -30,   code: 'T-00:00:30', label: 'SPACEX FLIGHT DIRECTOR VERIFIES GO FOR LAUNCH', pre: true },
  { t: -17,   code: 'T-00:00:17', label: 'FLAME DIVERTER ACTIVATION', jump: 'launch' },
  { t: -3,    code: 'T-00:00:03', label: 'BOOSTER ENGINE STARTUP COMMAND' },
  { t: 0,     code: '00:00:00',   label: 'LIFTOFF — EXCITEMENT GUARANTEED!' },
  { t: 58,    code: '00:00:58',   label: 'MAX Q (PEAK AERODYNAMIC STRESS)' },
  { t: 140,   code: '00:02:20',   label: 'SUPER HEAVY MECO (MOST ENGINES CUT OFF)' },
  { t: 142,   code: '00:02:22',   label: 'BOOSTER SEPARATION → STARSHIP RAPTOR IGNITION', jump: 'hotstage' },
  { t: 147,   code: '00:02:27',   label: 'SUPER HEAVY BOOSTBACK BURN START' },
  { t: 187,   code: '00:03:07',   label: 'SUPER HEAVY BOOSTBACK BURN SHUTDOWN' },
  { t: 396,   code: '00:06:36',   label: 'SUPER HEAVY LANDING BURN START (ASDS)', jump: 'booster_land' },
  { t: 421,   code: '00:07:01',   label: 'SUPER HEAVY LANDING BURN SHUTDOWN' },
  { t: 491,   code: '00:08:11',   label: 'STARSHIP ENGINE CUTOFF (SECO)', jump: 'orbit' },
  { t: 1517,  code: '00:25:17',   label: 'STARSHIP ORBITAL INSERTION BURN START' },
  { t: 1536,  code: '00:25:36',   label: 'STARSHIP ORBITAL INSERTION BURN SHUTDOWN' },
  { t: 2047,  code: '00:34:07',   label: 'PAYLOAD DEPLOY START (STARLINK)' },
  { t: 3879,  code: '01:04:39',   label: 'PAYLOAD DEPLOY COMPLETE — ORBITAL COAST' },
  { t: 31957, code: '08:52:37',   label: 'DEORBIT BURN START', jump: 'reentry' },
  { t: 31968, code: '08:52:48',   label: 'DEORBIT BURN SHUTDOWN' },
  { t: 34136, code: '09:28:56',   label: 'STARSHIP ENTRY (REENTRY PLASMA)' },
  { t: 35249, code: '09:47:29',   label: 'STARSHIP IS TRANSONIC (DOUBLE SONIC BOOM)', jump: 'catch' },
  { t: 35287, code: '09:48:07',   label: 'STARSHIP IS SUBSONIC (BELLY FLOP)' },
  { t: 35411, code: '09:50:11',   label: 'LANDING BURN START (3 ENGINES)' },
  { t: 35413, code: '09:50:13',   label: 'LANDING FLIP MANEUVER' },
  { t: 35421, code: '09:50:21',   label: 'LANDING BURN 3 TO 2 ENGINES' },
  { t: 35428, code: '09:50:28',   label: 'LANDING BURN 2 TO 1 ENGINE' },
  { t: 35430, code: '09:50:30',   label: 'AN EXCITING LANDING! (MECHAZILLA CATCH)' }
];

// --- 5. STATE SIMULASI BERSAMA (REAKTIF UNTUK FISIKA, WORLD & HUD) ---
export const sim = {
  simClock: 0,
  missionTime: TIMELINE.T_COUNTDOWN,
  timeWarp: 1,
  orbitalTimeRate: 1,
  paused: false,
  sequenceStarted: false,
  boosterCatchMode: false,
  launched: false,
  staged: false,
  shipIgnitedAfterSep: false,
  mecoTriggered: false,
  flameDiverterTriggered: false,
  boostbackStarted: false,
  boostbackEnded: false,
  ignitionBoomDone: false,
  launchSonicBoomDone: false,
  boosterSonicBoomDone: false,
  shipLandingBoomDone: false,
  oibNotified: false,
  deployNotified: false,
  deorbitNotified: false,
  entryNotified: false,

  // Mode Kendali & UI
  autoMode: true,
  sasEnabled: true,
  pipVisible: true,
  pipEnlarged: false,
  audioEnabled: true,
  manualGimbalX: 0,
  manualGimbalY: 0,
  keys: { w: false, a: false, s: false, d: false },

  // State Fisika Super Heavy Booster
  booster: {
    pos: new THREE.Vector3(0, WORLD_COORDS.OLM_Y, 0),
    vel: new THREE.Vector3(),
    quat: new THREE.Quaternion(),
    angVel: new THREE.Vector3(),
    mainProp: SPECS.bMainPropMax,
    headerProp: SPECS.bHeaderPropMax,
    gimbalX: 0,
    gimbalY: 0,
    throttle: 0,
    activeEngines: 0,
    twr: 0,
    gForce: 1.0,
    q: 0,
    legDeploy: 0,
    gridFinTilt: 0,
    landed: false,
    phase: 'SIAP LUNCUR',
    path: []
  },

  // State Fisika Starship Upper Stage
  ship: {
    pos: new THREE.Vector3(0, WORLD_COORDS.OLM_Y + SPECS.boosterHeight + SPECS.interstageHeight, 0),
    vel: new THREE.Vector3(),
    quat: new THREE.Quaternion(),
    angVel: new THREE.Vector3(),
    mainProp: SPECS.sMainPropMax,
    headerProp: SPECS.sHeaderPropMax,
    gimbalX: 0,
    gimbalY: 0,
    throttle: 0,
    activeEngines: 0,
    twr: 0,
    gForce: 1.0,
    q: 0,
    isMaxQ: false,
    flapAngle: 0,
    orbitAngleDeg: 0,
    orbitCompleted: false,
    apogeeKm: 0,
    perigeeKm: 0,
    plasmaIntensity: 0,
    rcsActive: false,
    payloadDoorOpen: 0,
    starlinksDeployed: 0,
    returnPhase: 'ASCENT',
    caught: false,
    phase: 'SIAP LUNCUR',
    path: []
  }
};

// State Menara Mechazilla & Chopsticks
export const mechazilla = {
  carriageY: 108.0,
  targetCarriageY: 108.0,
  armAngle: 0.42,
  targetArmAngle: 0.42,
  statusText: 'SIAGA'
};

// State Kamera Utama
export const camState = {
  mode: 'starship',
  needsSnap: true,
  lastTarget: new THREE.Vector3(),
  shake: 0
};

// Helper: Cek apakah Starship sedang berada pada Scene Orbit Bumi 3D
export function isShipInOrbitalScene() {
  const p = sim.ship.returnPhase;
  return (
    p === 'ORBIT_COAST_OIB' ||
    p === 'OIB_BURN' ||
    p === 'ORBIT_COAST_DEPLOY' ||
    p === 'PAYLOAD_DEPLOY' ||
    p === 'ORBIT_COAST_MAIN' ||
    p === 'DEORBIT_BURN' ||
    p === 'COAST_ENTRY' ||
    p === 'REENTRY_PLASMA'
  );
}

// Helper: Tinggi ombak laut 3D secara analitis (dipakai shader laut & pelampung ASDS)
export function getOceanWaveHeight(x, z, t) {
  return (
    Math.sin(x * 0.018 + t * 1.15) * 0.55 +
    Math.cos(z * 0.022 + t * 0.92) * 0.45 +
    Math.sin((x + z) * 0.045 - t * 1.7) * 0.22
  );
}
