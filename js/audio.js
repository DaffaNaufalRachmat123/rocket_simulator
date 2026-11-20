/* ============================================================================
   STARSHIP & SUPER HEAVY — 3D FLIGHT SIMULATOR
   File 4/6: js/audio.js
   Mesin audio prosedural (Web Audio API):
   - Flame Diverter / Water Deluge Steam Roar (T-00:00:17)
   - Ignition Shockwave Boom (T-00:00:03 & Post-Separation Ignition)
   - Multi-band 33 Raptor Sub-Bass, Mid Roar & Supersonic Crackle
   - Authentic N-Wave Sonic Boom (Ascent Mach 1.0) & Double Sonic Boom (Landing)
   - Mechanical Clank (Stage Separation, ASDS Touchdown & Mechazilla Catch)
   ============================================================================ */

import { sim } from './config.js';

const audioState = {
  initialized: false,
  ctx: null,
  masterGain: null,
  compressor: null,
  noiseBuffer: null,
  crackleBuffer: null,

  // Continuous engine & deluge gain/filter nodes
  subOsc: null,
  subGain: null,
  rumbleGain: null,
  rumbleFilter: null,
  midRoarGain: null,
  midRoarFilter: null,
  crackleGain: null,
  crackleFilter: null,
  delugeGain: null
};

/**
 * Membuat kurva distorsi lembut untuk menghasilkan karakter "crackle" khas mesin roket besar.
 */
function makeCrackleCurve(amount = 45) {
  const samples = 2048;
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = ((3 + amount) * x * 20 * (Math.PI / 180)) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

/**
 * Inisialisasi AudioContext dan seluruh rantai sintetis mesin Raptor.
 * Wajib dipanggil setelah interaksi pengguna (klik tombol) sesuai kebijakan browser.
 */
export function initAudio() {
  if (audioState.initialized) {
    if (audioState.ctx && audioState.ctx.state === 'suspended') {
      audioState.ctx.resume().catch(() => {});
    }
    return;
  }

  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();

    // Dynamics Compressor agar dentuman Sonic Boom & 33 Raptor tetap bertenaga tanpa clipping
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-14, ctx.currentTime);
    compressor.knee.setValueAtTime(18, ctx.currentTime);
    compressor.ratio.setValueAtTime(8, ctx.currentTime);
    compressor.attack.setValueAtTime(0.004, ctx.currentTime);
    compressor.release.setValueAtTime(0.22, ctx.currentTime);

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(sim.audioEnabled ? 0.85 : 0.0, ctx.currentTime);

    compressor.connect(masterGain);
    masterGain.connect(ctx.destination);

    // 1. Buat buffer White/Brown Noise 3 detik untuk raungan mesin & uap
    const sampleRate = ctx.sampleRate;
    const len = sampleRate * 3;
    const noiseBuffer = ctx.createBuffer(1, len, sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      noiseData[i] = Math.random() * 2 - 1;
    }

    // 2. Buat buffer impuls tak beraturan untuk efek "Rocket Crackle" supersonik
    const crackleBuffer = ctx.createBuffer(1, len, sampleRate);
    const crackleData = crackleBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const r = Math.random();
      if (r > 0.965) {
        crackleData[i] = (Math.random() * 2 - 1) * 1.0;
      } else if (r > 0.88) {
        crackleData[i] = (Math.random() * 2 - 1) * 0.35;
      } else {
        crackleData[i] = (Math.random() * 2 - 1) * 0.04;
      }
    }

    // --- LAYER A: SUB-BASS OSCILLATOR (GETARAN 33 MESIN RAPTOR) ---
    const subOsc = ctx.createOscillator();
    subOsc.type = 'sawtooth';
    subOsc.frequency.setValueAtTime(38, ctx.currentTime);
    const subFilter = ctx.createBiquadFilter();
    subFilter.type = 'lowpass';
    subFilter.frequency.setValueAtTime(82, ctx.currentTime);
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0, ctx.currentTime);
    subOsc.connect(subFilter);
    subFilter.connect(subGain);
    subGain.connect(compressor);
    subOsc.start();

    // --- LAYER B: DEEP RUMBLE NOISE (< 120 Hz) ---
    const rumbleSrc = ctx.createBufferSource();
    rumbleSrc.buffer = noiseBuffer;
    rumbleSrc.loop = true;
    const rumbleFilter = ctx.createBiquadFilter();
    rumbleFilter.type = 'lowpass';
    rumbleFilter.frequency.setValueAtTime(115, ctx.currentTime);
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.setValueAtTime(0, ctx.currentTime);
    rumbleSrc.connect(rumbleFilter);
    rumbleFilter.connect(rumbleGain);
    rumbleGain.connect(compressor);
    rumbleSrc.start();

    // --- LAYER C: MID-RANGE ENGINE ROAR (200–520 Hz) ---
    const midSrc = ctx.createBufferSource();
    midSrc.buffer = noiseBuffer;
    midSrc.loop = true;
    const midRoarFilter = ctx.createBiquadFilter();
    midRoarFilter.type = 'bandpass';
    midRoarFilter.frequency.setValueAtTime(280, ctx.currentTime);
    midRoarFilter.Q.setValueAtTime(0.75, ctx.currentTime);
    const midRoarGain = ctx.createGain();
    midRoarGain.gain.setValueAtTime(0, ctx.currentTime);
    midSrc.connect(midRoarFilter);
    midRoarFilter.connect(midRoarGain);
    midRoarGain.connect(compressor);
    midSrc.start();

    // --- LAYER D: SUPERSONIC ROCKET CRACKLE (KHAS STARSHIP) ---
    const crackleSrc = ctx.createBufferSource();
    crackleSrc.buffer = crackleBuffer;
    crackleSrc.loop = true;
    const crackleFilter = ctx.createBiquadFilter();
    crackleFilter.type = 'bandpass';
    crackleFilter.frequency.setValueAtTime(1150, ctx.currentTime);
    crackleFilter.Q.setValueAtTime(0.65, ctx.currentTime);
    const crackleShaper = ctx.createWaveShaper();
    crackleShaper.curve = makeCrackleCurve(50);
    const crackleGain = ctx.createGain();
    crackleGain.gain.setValueAtTime(0, ctx.currentTime);
    crackleSrc.connect(crackleFilter);
    crackleFilter.connect(crackleShaper);
    crackleShaper.connect(crackleGain);
    crackleGain.connect(compressor);
    crackleSrc.start();

    // --- LAYER E: FLAME DIVERTER / WATER DELUGE STEAM HISS ---
    const delugeSrc = ctx.createBufferSource();
    delugeSrc.buffer = noiseBuffer;
    delugeSrc.loop = true;
    const delugeFilter = ctx.createBiquadFilter();
    delugeFilter.type = 'bandpass';
    delugeFilter.frequency.setValueAtTime(980, ctx.currentTime);
    delugeFilter.Q.setValueAtTime(0.55, ctx.currentTime);
    const delugeGain = ctx.createGain();
    delugeGain.gain.setValueAtTime(0, ctx.currentTime);
    delugeSrc.connect(delugeFilter);
    delugeFilter.connect(delugeGain);
    delugeGain.connect(compressor);
    delugeSrc.start();

    audioState.initialized = true;
    audioState.ctx = ctx;
    audioState.masterGain = masterGain;
    audioState.compressor = compressor;
    audioState.noiseBuffer = noiseBuffer;
    audioState.crackleBuffer = crackleBuffer;
    audioState.subOsc = subOsc;
    audioState.subGain = subGain;
    audioState.rumbleGain = rumbleGain;
    audioState.rumbleFilter = rumbleFilter;
    audioState.midRoarGain = midRoarGain;
    audioState.midRoarFilter = midRoarFilter;
    audioState.crackleGain = crackleGain;
    audioState.crackleFilter = crackleFilter;
    audioState.delugeGain = delugeGain;
  } catch (err) {
    console.warn('AudioContext gagal diinisialisasi:', err);
  }
}

/**
 * Mengaktifkan atau membisukan seluruh output suara.
 */
export function setAudioEnabled(enabled) {
  sim.audioEnabled = Boolean(enabled);
  if (sim.audioEnabled && !audioState.initialized) {
    initAudio();
  }
  if (audioState.initialized && audioState.masterGain) {
    const now = audioState.ctx.currentTime;
    audioState.masterGain.gain.setTargetAtTime(sim.audioEnabled ? 0.85 : 0.0, now, 0.05);
  }
}

/**
 * Memperbarui raungan mesin Raptor dan semburan Water Deluge secara dinamis per frame.
 * @param {number} thrustNorm - Tingkat daya dorong aktif (0.0 .. 1.0)
 * @param {number} atmFactor  - Kerapatan udara relatif kamera (1.0 di darat -> 0.0 di vakum)
 * @param {boolean} delugeActive - Status aktif Flame Diverter (T-17s sampai Liftoff)
 */
export function updateAudio(thrustNorm, atmFactor, delugeActive) {
  if (!audioState.initialized || !audioState.ctx) return;
  const now = audioState.ctx.currentTime;

  if (!sim.audioEnabled || sim.paused) {
    audioState.subGain.gain.setTargetAtTime(0, now, 0.06);
    audioState.rumbleGain.gain.setTargetAtTime(0, now, 0.06);
    audioState.midRoarGain.gain.setTargetAtTime(0, now, 0.06);
    audioState.crackleGain.gain.setTargetAtTime(0, now, 0.06);
    audioState.delugeGain.gain.setTargetAtTime(0, now, 0.06);
    return;
  }

  // Di ruang hampa udara suara sangat teredam (hanya sedikit getaran struktur wahana)
  const airPresence = 0.06 + 0.94 * Math.max(0, Math.min(1, atmFactor));
  const t = Math.max(0, Math.min(1, thrustNorm));

  audioState.subOsc.frequency.setTargetAtTime(34 + t * 14, now, 0.08);
  audioState.subGain.gain.setTargetAtTime(t * 0.28 * airPresence, now, 0.06);

  audioState.rumbleFilter.frequency.setTargetAtTime(95 + t * 85, now, 0.08);
  audioState.rumbleGain.gain.setTargetAtTime(t * 0.58 * airPresence, now, 0.06);

  audioState.midRoarFilter.frequency.setTargetAtTime(220 + t * 240, now, 0.08);
  audioState.midRoarGain.gain.setTargetAtTime(t * 0.42 * airPresence, now, 0.06);

  // Efek crackle supersonik paling terasa saat daya dorong tinggi di atmosfer bawah
  const crackleAmt = Math.pow(t, 1.35) * 0.46 * Math.max(0, Math.min(1, atmFactor));
  audioState.crackleFilter.frequency.setTargetAtTime(900 + t * 750, now, 0.08);
  audioState.crackleGain.gain.setTargetAtTime(crackleAmt, now, 0.06);

  audioState.delugeGain.gain.setTargetAtTime(delugeActive ? 0.24 : 0.0, now, 0.12);
}

/**
 * Dentuman gelombang kejut saat penyalaan mesin Raptor (T-00:00:03 & Starship Ignition).
 */
export function playIgnitionBoom() {
  if (!sim.audioEnabled) return;
  initAudio();
  if (!audioState.initialized) return;

  try {
    const ctx = audioState.ctx;
    const t0 = ctx.currentTime;

    // Sub-bass pressure thump
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(108, t0);
    osc.frequency.exponentialRampToValueAtTime(22, t0 + 0.72);

    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(0.001, t0);
    oscGain.gain.linearRampToValueAtTime(0.95, t0 + 0.02);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.85);

    osc.connect(oscGain);
    oscGain.connect(audioState.compressor);
    osc.start(t0);
    osc.stop(t0 + 0.9);

    // Combustion blast transient
    const blast = ctx.createBufferSource();
    blast.buffer = audioState.noiseBuffer;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(720, t0);
    lp.frequency.exponentialRampToValueAtTime(110, t0 + 0.75);

    const blastGain = ctx.createGain();
    blastGain.gain.setValueAtTime(0.001, t0);
    blastGain.gain.linearRampToValueAtTime(0.85, t0 + 0.015);
    blastGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.95);

    blast.connect(lp);
    lp.connect(blastGain);
    blastGain.connect(audioState.compressor);
    blast.start(t0);
    blast.stop(t0 + 1.0);
  } catch (err) {
    console.warn('playIgnitionBoom error:', err);
  }
}

/**
 * Efek suara SONIC BOOM autentik (N-Wave Pressure Shock + Crack + Atmospheric Thunder).
 * @param {'single' | 'double'} type - 'single' untuk Mach 1.0 peluncuran, 'double' untuk reentry/pendaratan SpaceX.
 */
export function playSonicBoom(type = 'single') {
  if (!sim.audioEnabled) return;
  initAudio();
  if (!audioState.initialized) return;

  try {
    const ctx = audioState.ctx;
    // Double Sonic Boom SpaceX memiliki jeda ~230ms (gelombang kejut hidung & ekor roket)
    const schedule = type === 'double' ? [0.0, 0.23] : [0.0];

    schedule.forEach((delay, idx) => {
      const t0 = ctx.currentTime + delay;
      const scale = idx === 0 ? 1.0 : 0.86;

      // 1. N-Wave Low-Frequency Overpressure Punch (130 Hz -> 20 Hz)
      const sub = ctx.createOscillator();
      sub.type = 'triangle';
      sub.frequency.setValueAtTime(132, t0);
      sub.frequency.exponentialRampToValueAtTime(21, t0 + 0.36);

      const subG = ctx.createGain();
      subG.gain.setValueAtTime(0.001, t0);
      subG.gain.linearRampToValueAtTime(1.0 * scale, t0 + 0.008);
      subG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.48);

      sub.connect(subG);
      subG.connect(audioState.compressor);
      sub.start(t0);
      sub.stop(t0 + 0.52);

      // 2. Sharp Supersonic Shockwave Crack (1.6 kHz transient)
      const crack = ctx.createBufferSource();
      crack.buffer = audioState.noiseBuffer;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(1600, t0);
      bp.Q.setValueAtTime(0.8, t0);

      const crackG = ctx.createGain();
      crackG.gain.setValueAtTime(0.001, t0);
      crackG.gain.linearRampToValueAtTime(0.9 * scale, t0 + 0.005);
      crackG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.14);

      crack.connect(bp);
      bp.connect(crackG);
      crackG.connect(audioState.compressor);
      crack.start(t0);
      crack.stop(t0 + 0.16);

      // 3. Rolling Atmospheric Thunder Tail (menggema 1.6 detik di kejauhan)
      const tail = ctx.createBufferSource();
      tail.buffer = audioState.noiseBuffer;
      const tailLP = ctx.createBiquadFilter();
      tailLP.type = 'lowpass';
      tailLP.frequency.setValueAtTime(320, t0 + 0.04);
      tailLP.frequency.exponentialRampToValueAtTime(70, t0 + 1.55);

      const tailG = ctx.createGain();
      tailG.gain.setValueAtTime(0.001, t0);
      tailG.gain.linearRampToValueAtTime(0.55 * scale, t0 + 0.045);
      tailG.gain.exponentialRampToValueAtTime(0.001, t0 + 1.65);

      tail.connect(tailLP);
      tailLP.connect(tailG);
      tailG.connect(audioState.compressor);
      tail.start(t0);
      tail.stop(t0 + 1.7);
    });
  } catch (err) {
    console.warn('playSonicBoom error:', err);
  }
}

/**
 * Bunyi benturan mekanis baja berat (Stage Separation, Touchdown ASDS, & Jepitan Chopsticks Mechazilla).
 */
export function playMechanicalClank(baseFreq = 110) {
  if (!sim.audioEnabled) return;
  initAudio();
  if (!audioState.initialized) return;

  try {
    const ctx = audioState.ctx;
    const t0 = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(baseFreq, t0);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.36, t0 + 0.24);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(680, t0);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, t0);
    gain.gain.linearRampToValueAtTime(0.52, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);

    osc.connect(lp);
    lp.connect(gain);
    gain.connect(audioState.compressor);
    osc.start(t0);
    osc.stop(t0 + 0.34);
  } catch (err) {
    console.warn('playMechanicalClank error:', err);
  }
}