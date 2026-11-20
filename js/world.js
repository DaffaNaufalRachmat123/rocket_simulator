/* ============================================================================
   STARSHIP & SUPER HEAVY — 3D FLIGHT SIMULATOR
   File 5/6: js/world.js
   Pembangun dunia 3D, Shader GLSL & Model Teknis:
   - Custom GLSL 3-Layer Methane Raptor Plume (Mach Diamonds + Blue/Red Flame)
   - Custom GLSL Reentry Plasma Sheath & 3D Animated Ocean Surface
   - Photorealistic Google-Earth Style 3D Planet (Continents, Bathymetry,
     Bump Mountains, Ocean Sun Glint, Swirling Cyclones, Cloud Shadows,
     Night City Lights, Sunset Terminator & Rayleigh Atmospheric Limb)
   - Detailed Super Heavy (33 Raptors, 13 Gimbaled X/Y, 4 Grid Fins, 4 Legs)
   - Detailed Starship (6 Raptors, 3 SL Gimbaled X/Y, 4 Flaps, Catch Pins, Starlink)
   - Functional Mechazilla Catch Tower (Carriage + Chopsticks + QD Arm) & ASDS
   ============================================================================ */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { SPECS, WORLD_COORDS, sim, TERRAIN, RENDER_SCALE, Logger } from './config.js';

// Objek referensi dunia 3D yang dibagikan ke modul fisika & render (js/main.js)
export const world = {
  renderer: null,
  renderCamera: new THREE.PerspectiveCamera(),
  tiles: null,
  sky: null,
  composer: null,
  renderPass: null,
  renderSize: new THREE.Vector2(),
  boosterCatchPins: [],
  googleMap: null,
  googleModels: [],
  googleActive: false,
  googleLoading: false,
  scene: null,
  camera: null,
  controls: null,
  starshipMonitorCam: null,
  boosterMonitorCam: null,

  sharedShaderUniforms: {
    uTime: { value: 0.0 }
  },

  // Lingkungan Launch & Starbase
  skyStars: null,
  oceanMesh: null,
  curvedEarthMesh: null,
  atmoHaloMesh: null,
  vaporConeMesh: null,

  // Mechazilla & Pad Laut ASDS
  mechazillaGroup: null,
  catchCarriageGroup: null,
  chopstickLeftPivot: null,
  chopstickRightPivot: null,
  qdArmPivot: null,
  catchPads: [],
  shipCatchPins: [],
  asdsGroup: null,

  // Wahana Super Heavy Booster
  boosterRoot: null,
  boosterInnerEngines: [],  // 13 Mesin Raptor dalam (Gimbal X/Y fleksibel)
  boosterOuterEngines: [],  // 20 Mesin Raptor cincin luar
  boosterGridFins: [],
  boosterLandingLegs: [],
  boosterEngineLight: null,

  // Wahana Starship
  shipRoot: null,
  shipSLEngines: [],        // 3 Mesin Raptor Sea-Level (Gimbal X/Y fleksibel)
  shipVacEngines: [],       // 3 Mesin Raptor Vacuum
  shipFlaps: {},
  shipEngineLight: null,

  // Sistem Partikel
  padSmokePool: null,
  ascentTrailPool: null,
  oceanSprayPool: null,
  fireSparkPool: null,

  // Scene Khusus Orbit Bumi 360° Fotorealistis
  orbitalScene: null,
  orbitalEarthMesh: null,
  orbitalCloudsMesh: null,
  orbitalAtmoMesh: null,
  earthTextures: null,
  orbitalRingProgressLine: null,
  orbitalShipGroup: null,
  orbitalShipSLEngines: [],
  orbitalShipVacEngines: [],
  orbitalPlasmaMesh: null,
  orbitalPlasmaUniforms: null,
  orbitalPlasmaLight: null,
  orbitalRCSJets: [],
  orbitalPlasmaPool: null,
  starlinkDoorMesh: null,
  starlinkPayloadGroup: null,
  starlinkSats: [],

  // Basis vektor lintasan orbit miring 28.5° (mulai & berakhir di Starbase, Texas)
  orbitU: new THREE.Vector3(),
  orbitV: new THREE.Vector3(),
  orbitNormal: new THREE.Vector3()
};

// ============================================================================
// 1. SISTEM PARTIKEL RINGAN (ASAP PELUNCURAN, JEJAK ATMOSFER, KABUT LAUT, PLASMA)
// ============================================================================
function createSoftParticleTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
  g.addColorStop(0.35, 'rgba(255, 255, 255, 0.72)');
  g.addColorStop(0.7, 'rgba(255, 255, 255, 0.22)');
  g.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

class ParticlePool {
  constructor(targetScene, maxCount, baseSize, additive, texture) {
    this.maxCount = maxCount;
    this.cursor = 0;
    this.pos = new Float32Array(maxCount * 3);
    this.vel = new Float32Array(maxCount * 3);
    this.col = new Float32Array(maxCount * 3);
    this.life = new Float32Array(maxCount);
    this.maxLife = new Float32Array(maxCount);

    for (let i = 0; i < maxCount; i++) {
      this.pos[i * 3 + 1] = -99999;
      this.life[i] = 0;
      this.maxLife[i] = 1;
    }

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));

    this.mat = new THREE.PointsMaterial({
      size: baseSize * RENDER_SCALE,
      map: texture,
      vertexColors: true,
      transparent: true,
      opacity: additive ? 0.85 : 0.62,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthWrite: false,
      sizeAttenuation: true
    });

    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    targetScene.add(this.points);
  }

  spawn(x, y, z, vx, vy, vz, r, g, b, lifeSec) {
    const i = this.cursor;
    const i3 = i * 3;
    this.pos[i3] = x;
    this.pos[i3 + 1] = y;
    this.pos[i3 + 2] = z;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;
    this.col[i3] = r;
    this.col[i3 + 1] = g;
    this.col[i3 + 2] = b;
    this.life[i] = lifeSec;
    this.maxLife[i] = lifeSec;
    this.cursor = (this.cursor + 1) % this.maxCount;
  }

  update(dt, drag = 0.96, buoyancyY = 2.0) {
    if (dt <= 0) return;
    const damp = Math.pow(drag, dt * 60);
    for (let i = 0; i < this.maxCount; i++) {
      if (this.life[i] > 0) {
        this.life[i] -= dt;
        const i3 = i * 3;
        this.vel[i3] *= damp;
        this.vel[i3 + 1] = this.vel[i3 + 1] * damp + buoyancyY * dt;
        this.vel[i3 + 2] *= damp;

        this.pos[i3] += this.vel[i3] * dt;
        this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
        this.pos[i3 + 2] += this.vel[i3 + 2] * dt;

        // Meredupkan warna secara halus menjelang akhir umur partikel
        const fade = Math.max(0, this.life[i] / this.maxLife[i]);
        if (fade < 0.35) {
          this.col[i3] *= 0.96;
          this.col[i3 + 1] *= 0.96;
          this.col[i3 + 2] *= 0.96;
        }
      } else {
        this.pos[i * 3 + 1] = -99999;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }

  clear() {
    for (let i = 0; i < this.maxCount; i++) {
      this.life[i] = 0;
      this.pos[i * 3 + 1] = -99999;
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}

// ============================================================================
// 2. CUSTOM GLSL SHADERS (API METANA 3 LAPIS, LAUTAN 3D, PLASMA REENTRY)
// ============================================================================

/**
 * Shader GLSL api propulsi metana Raptor dengan Mach Shock Diamonds,
 * lapisan plasma biru-ungu, serta api oranye-merah yang berdenyut.
 */
function createPlumeShaderMaterial(colorInnerHex, colorOuterHex, enableDiamonds, vacOpacityBoost = 0.0) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: world.sharedShaderUniforms.uTime,
      uColorA: { value: new THREE.Color(colorInnerHex) },
      uColorB: { value: new THREE.Color(colorOuterHex) },
      uDiamonds: { value: enableDiamonds ? 1.0 : 0.0 },
      uVacFactor: { value: 0.0 },
      uVacBoost: { value: vacOpacityBoost }
    },
    vertexShader: `
      uniform float uTime;
      uniform float uVacFactor;
      varying vec2 vUv;
      varying vec3 vNormalView;
      varying vec3 vViewDir;

      void main() {
        vUv = uv;
        vec3 p = position;
        float distDown = 1.0 - uv.y;

        // Efek ekspansi kerucut api saat memasuki ruang vakum tinggi + turbulensi tipis
        float flare = 1.0 + uVacFactor * distDown * 1.45;
        float flutter = 1.0 + sin(distDown * 18.0 - uTime * 36.0) * 0.045 * distDown;
        p.x *= flare * flutter;
        p.z *= flare * flutter;

        vec4 mvPos = modelViewMatrix * vec4(p, 1.0);
        vNormalView = normalize(normalMatrix * normal);
        vViewDir = normalize(-mvPos.xyz);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      uniform float uDiamonds;
      uniform float uVacFactor;
      uniform float uVacBoost;
      varying vec2 vUv;
      varying vec3 vNormalView;
      varying vec3 vViewDir;

      void main() {
        float y = 1.0 - vUv.y;
        float fresnel = pow(abs(dot(normalize(vNormalView), normalize(vViewDir))), 0.72);

        // Pola Mach Shock Diamonds khas mesin Raptor (Methalox)
        float shockWave = sin(y * 36.0 - uTime * 42.0);
        float diamond = uDiamonds * pow(max(0.0, 0.5 + 0.5 * shockWave), 5.0)
                      * exp(-y * 1.75) * (1.0 - uVacFactor * 0.72);

        // Riak turbulensi pembakaran cepat
        float turb = 0.86 + 0.14 * sin(vUv.x * 25.13 + y * 22.0 - uTime * 32.0);

        vec3 baseCol = mix(uColorA, uColorB, smoothstep(0.04, 0.86, y));
        // Pergeseran warna menuju plasma biru-violet di ketinggian vakum
        vec3 vacTint = vec3(0.42, 0.56, 1.0);
        baseCol = mix(baseCol, vacTint, uVacFactor * 0.42);
        baseCol += vec3(0.92, 0.98, 1.0) * diamond * 1.35;

        float fadeIn = smoothstep(0.0, 0.07, y);
        float fadeOut = 1.0 - smoothstep(0.52, 1.0, y);
        float alpha = fadeIn * fadeOut * fresnel * turb * (0.85 + uVacFactor * uVacBoost);

        gl_FragColor = vec4(baseCol * 1.48, clamp(alpha, 0.0, 0.95));
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide
  });
}

function createOceanShaderMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: world.sharedShaderUniforms.uTime,
      uSunDir: { value: new THREE.Vector3(0.55, 0.72, 0.42).normalize() }
    },
    vertexShader: `
      uniform float uTime;
      varying vec3 vWorldPos;
      varying float vWaveH;

      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        float h = sin(wp.x * 0.018 + uTime * 1.15) * 0.55
                + cos(wp.z * 0.022 + uTime * 0.92) * 0.45
                + sin((wp.x + wp.z) * 0.045 - uTime * 1.7) * 0.22;
        wp.y += h;
        vWorldPos = wp.xyz;
        vWaveH = h;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uSunDir;
      varying vec3 vWorldPos;
      varying float vWaveH;

      void main() {
        vec3 V = normalize(cameraPosition - vWorldPos);
        float nx = cos(vWorldPos.x * 0.018 + uTime * 1.15) * 0.09
                 + cos((vWorldPos.x + vWorldPos.z) * 0.045 - uTime * 1.7) * 0.06;
        float nz = -sin(vWorldPos.z * 0.022 + uTime * 0.92) * 0.09
                 + cos((vWorldPos.x + vWorldPos.z) * 0.045 - uTime * 1.7) * 0.06;
        vec3 N = normalize(vec3(-nx, 1.0, -nz));

        vec3 deepSea = vec3(0.015, 0.09, 0.21);
        vec3 shallowTurq = vec3(0.04, 0.28, 0.44);
        float crest = smoothstep(-0.6, 1.1, vWaveH);
        vec3 waterCol = mix(deepSea, shallowTurq, crest * 0.65);

        // Kilau pantulan matahari & Fresnel langit pada permukaan ombak
        vec3 H = normalize(uSunDir + V);
        float spec = pow(max(dot(N, H), 0.0), 64.0) * 0.95;
        float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.4);
        vec3 col = waterCol + vec3(0.24, 0.52, 0.78) * fresnel * 0.42 + vec3(1.0, 0.95, 0.85) * spec;

        // Kabut cakrawala halus di kejauhan
        float dist = length(cameraPosition - vWorldPos);
        float fogF = smoothstep(14000.0, 120000.0, dist);
        col = mix(col, vec3(0.14, 0.34, 0.55), fogF * 0.75);

        gl_FragColor = vec4(col, 1.0);
      }
    `
  });
}

function createReentryPlasmaMaterial() {
  world.orbitalPlasmaUniforms = {
    uTime: world.sharedShaderUniforms.uTime,
    uIntensity: { value: 0.0 }
  };
  return new THREE.ShaderMaterial({
    uniforms: world.orbitalPlasmaUniforms,
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uIntensity;
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vV;

      void main() {
        float rim = pow(1.0 - abs(dot(vN, vV)), 1.6);
        float streak = 0.65 + 0.35 * sin(vUv.y * 28.0 - uTime * 26.0 + sin(vUv.x * 16.0) * 2.0);
        vec3 whiteHot = vec3(1.0, 0.94, 0.84);
        vec3 orangeFire = vec3(1.0, 0.38, 0.08);
        vec3 magentaIon = vec3(0.88, 0.22, 0.96);

        vec3 col = mix(orangeFire, magentaIon, smoothstep(0.35, 0.95, vUv.y));
        col = mix(col, whiteHot, pow(1.0 - vUv.y, 2.2) * 0.75);
        float alpha = (0.35 + rim * 0.85) * streak * uIntensity;
        gl_FragColor = vec4(col * 1.55, clamp(alpha, 0.0, 0.92));
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide
  });
}

// ============================================================================
// 3. GENERATOR BUMI 3D FOTOREALISTIS BERGAYA GOOGLE EARTH
// ============================================================================
function latLonToVec3(latDeg, lonDeg, radius = 1.0) {
  const lat = THREE.MathUtils.degToRad(latDeg);
  const lon = THREE.MathUtils.degToRad(lonDeg);
  return new THREE.Vector3(
    radius * Math.cos(lat) * Math.cos(lon),
    radius * Math.sin(lat),
    -radius * Math.cos(lat) * Math.sin(lon)
  );
}

function fastHash2D(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function smoothNoise2D(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3.0 - 2.0 * fx);
  const uy = fy * fy * (3.0 - 2.0 * fy);
  const a = fastHash2D(ix, iy);
  const b = fastHash2D(ix + 1, iy);
  const c = fastHash2D(ix, iy + 1);
  const d = fastHash2D(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm2D(x, y, octaves = 4) {
  let val = 0;
  let amp = 0.5;
  let freq = 1.0;
  for (let i = 0; i < octaves; i++) {
    val += amp * smoothNoise2D(x * freq, y * freq);
    freq *= 2.05;
    amp *= 0.5;
  }
  return val;
}

/**
 * Menghasilkan 5 peta tekstur satelit resolusi tinggi secara prosedural:
 * Albedo (benua nyata & bioma), Bump (relief pegunungan), Specular (lautan),
 * Night (lampu kota besar dunia), dan Clouds (awan siklon & sabuk tropis).
 */
function generatePhotorealisticEarthTextures() {
  const W = 1024;
  const H = 512;

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = W;
  maskCanvas.height = H;
  const mCtx = maskCanvas.getContext('2d');
  mCtx.fillStyle = '#000000';
  mCtx.fillRect(0, 0, W, H);

  const drawPoly = (coords, fill = '#ffffff') => {
    mCtx.fillStyle = fill;
    mCtx.beginPath();
    coords.forEach(([lon, lat], idx) => {
      const px = ((lon + 180) / 360) * W;
      const py = ((90 - lat) / 180) * H;
      if (idx === 0) mCtx.moveTo(px, py);
      else mCtx.lineTo(px, py);
    });
    mCtx.closePath();
    mCtx.fill();
  };

  // Amerika Utara (lengkap dengan Teluk Meksiko, Texas/Starbase, Florida, Baja, Alaska)
  drawPoly([
    [-168, 66], [-162, 71], [-140, 70], [-124, 69], [-94, 69], [-80, 63], [-64, 60], [-53, 48], [-66, 44],
    [-75, 38], [-80, 32], [-80, 25], [-82, 26], [-83, 29], [-90, 29], [-97, 26], [-97, 20], [-91, 18],
    [-87, 21], [-88, 16], [-83, 10], [-78, 8], [-84, 10], [-92, 15], [-105, 20], [-110, 24], [-114, 31],
    [-117, 32], [-124, 40], [-124, 49], [-135, 57], [-152, 60], [-165, 61]
  ]);
  // Kuba, Kepulauan Karibia, Greenland & Islandia
  drawPoly([[-85, 22], [-79, 23], [-74, 20], [-78, 20]]);
  drawPoly([[-74, 19], [-68, 18], [-71, 20]]);
  drawPoly([[-52, 60], [-42, 60], [-20, 70], [-18, 81], [-44, 83], [-68, 77], [-56, 70]]);
  drawPoly([[-24, 64], [-14, 65], [-16, 66], [-23, 66]]);

  // Amerika Selatan
  drawPoly([
    [-78, 9], [-70, 12], [-60, 8], [-50, 2], [-35, -6], [-38, -14], [-42, -23], [-52, -33], [-65, -42],
    [-68, -54], [-74, -52], [-73, -40], [-71, -30], [-71, -18], [-81, -5], [-79, 2]
  ]);

  // Eropa, Inggris & Irlandia
  drawPoly([
    [-10, 37], [-9, 43], [-2, 43], [-5, 48], [2, 51], [8, 54], [10, 58], [5, 61], [12, 68], [28, 71],
    [42, 67], [60, 68], [60, 50], [45, 45], [36, 46], [28, 41], [22, 37], [16, 40], [12, 45], [6, 43], [0, 39], [-6, 36]
  ]);
  drawPoly([[-6, 50], [1, 51], [0, 54], [-3, 58], [-6, 57]]);
  drawPoly([[-10, 52], [-6, 52], [-6, 55], [-10, 54]]);

  // Afrika & Madagaskar
  drawPoly([
    [-17, 15], [-13, 28], [-6, 36], [10, 37], [15, 32], [25, 31], [32, 31], [38, 22], [43, 12], [51, 11],
    [41, -2], [40, -15], [33, -26], [28, -33], [18, -34], [14, -22], [12, -10], [9, 4], [2, 6], [-8, 5], [-16, 11]
  ]);
  drawPoly([[44, -25], [47, -25], [50, -13], [47, -15]]);

  // Jazirah Arab, India, Asia & Asia Tenggara
  drawPoly([
    [34, 30], [40, 28], [44, 13], [53, 16], [59, 23], [50, 29], [56, 26], [66, 25], [72, 22], [77, 8],
    [81, 16], [89, 22], [96, 17], [99, 12], [101, 5], [104, 1], [104, 10], [109, 12], [109, 21], [121, 25],
    [122, 31], [118, 39], [126, 38], [129, 35], [131, 42], [141, 51], [158, 52], [164, 60], [178, 66],
    [165, 70], [135, 72], [105, 76], [75, 73], [60, 68], [60, 50], [48, 45], [38, 42], [27, 37], [35, 36]
  ]);

  // Kepulauan Indonesia (Sumatra, Jawa, Kalimantan, Sulawesi, Papua), Filipina, Jepang & Taiwan
  drawPoly([[79, 9], [81, 9], [81, 6], [80, 6]]);
  drawPoly([[95, 5], [99, 2], [105, -6], [102, -5], [97, 1]]);
  drawPoly([[105, -6], [114, -8], [114, -7], [106, -6]]);
  drawPoly([[109, 1], [115, 6], [119, 4], [116, -3], [111, -3]]);
  drawPoly([[119, 1], [125, 1], [122, -4], [119, -5]]);
  drawPoly([[120, 18], [123, 14], [126, 7], [122, 7], [120, 14]]);
  drawPoly([[130, 31], [136, 34], [141, 38], [145, 44], [140, 42], [132, 34]]);
  drawPoly([[120, 25], [122, 25], [121, 22], [120, 23]]);
  drawPoly([[132, -2], [141, -3], [150, -10], [142, -9], [135, -5]]);

  // Australia, Selandia Baru & Antartika
  drawPoly([
    [114, -22], [122, -17], [131, -12], [136, -12], [142, -11], [146, -18], [153, -27], [150, -37],
    [141, -38], [135, -34], [124, -34], [115, -34], [113, -26]
  ]);
  drawPoly([[172, -35], [178, -38], [174, -41], [173, -38]]);
  drawPoly([[173, -41], [171, -44], [167, -46], [168, -44]]);
  drawPoly([[-180, -72], [-120, -74], [-62, -64], [-40, -75], [0, -70], [60, -68], [120, -67], [170, -72], [180, -72], [180, -90], [-180, -90]]);

  // Masker paparan benua (perairan dangkal toska di pesisir)
  const shelfCanvas = document.createElement('canvas');
  shelfCanvas.width = W;
  shelfCanvas.height = H;
  const sCtx = shelfCanvas.getContext('2d');
  sCtx.filter = 'blur(7px)';
  sCtx.drawImage(maskCanvas, 0, 0);

  const landData = mCtx.getImageData(0, 0, W, H).data;
  const shelfData = sCtx.getImageData(0, 0, W, H).data;

  const albedoCanvas = document.createElement('canvas'); albedoCanvas.width = W; albedoCanvas.height = H;
  const bumpCanvas = document.createElement('canvas');   bumpCanvas.width = W;   bumpCanvas.height = H;
  const specCanvas = document.createElement('canvas');   specCanvas.width = W;   specCanvas.height = H;
  const nightCanvas = document.createElement('canvas');  nightCanvas.width = W;  nightCanvas.height = H;
  const cloudCanvas = document.createElement('canvas');  cloudCanvas.width = W;  cloudCanvas.height = H;

  const aCtx = albedoCanvas.getContext('2d');
  const bCtx = bumpCanvas.getContext('2d');
  const spCtx = specCanvas.getContext('2d');
  const nCtx = nightCanvas.getContext('2d');
  const cCtx = cloudCanvas.getContext('2d');

  const aImg = aCtx.createImageData(W, H);
  const bImg = bCtx.createImageData(W, H);
  const spImg = spCtx.createImageData(W, H);
  const nImg = nCtx.createImageData(W, H);
  const cImg = cCtx.createImageData(W, H);

  // Pegunungan utama dunia (Rockies, Andes, Himalaya, Alpen, Papua)
  const mountains = [
    [-112, 44, 15, 1.0], [-106, 37, 11, 0.9],
    [-71, -18, 12, 1.0], [-70, -35, 9, 0.9],
    [86, 30, 16, 1.15], [75, 36, 12, 1.0],
    [10, 46, 7, 0.85], [38, 9, 9, 0.75],
    [138, -4, 6, 0.7]
  ];

  // Gurun utama dunia (Sahara, Arabia, Gobi, Outback, Sonora, Kalahari)
  const deserts = [
    [14, 23, 28, 11], [45, 23, 12, 9], [98, 42, 16, 7],
    [133, -24, 14, 8], [-111, 32, 9, 7], [19, -25, 7, 6]
  ];

  // Klaster kota metropolitan untuk lampu sisi malam Bumi
  const cities = [
    [-74, 40.7, 4.2], [-87.6, 41.8, 3.0], [-95.4, 29.7, 3.0], [-97.4, 26.0, 1.8], [-118.2, 34.0, 3.8],
    [-122.4, 37.7, 2.6], [-99.1, 19.4, 3.2], [-46.6, -23.5, 3.4], [-58.4, -34.6, 2.8],
    [0, 51.5, 3.8], [2.3, 48.8, 3.6], [8.5, 50.5, 4.2], [12.5, 42.5, 3.4], [-3.7, 40.4, 2.8],
    [37.6, 55.7, 3.4], [29.0, 41.0, 2.8], [31.2, 30.0, 3.4], [28.0, -26.2, 2.4],
    [72.8, 19.0, 3.8], [77.2, 28.6, 4.2], [80.2, 13.0, 3.0], [88.3, 22.5, 3.4],
    [100.5, 13.7, 2.8], [103.8, 1.3, 2.5], [106.8, -6.2, 3.2], [121.0, 14.6, 2.6],
    [116.4, 39.9, 4.2], [121.5, 31.2, 4.6], [114.1, 22.3, 4.0], [127.0, 37.5, 3.6],
    [139.7, 35.7, 4.6], [135.5, 34.7, 3.4], [151.2, -33.8, 2.6], [144.9, -37.8, 2.2]
  ];

  // Pusaran badai/siklon untuk sistem awan global
  const cyclones = [
    [-65, 24, 16], [-32, 48, 22], [145, 22, 18], [85, -45, 26], [-135, 38, 20], [55, -18, 16]
  ];

  for (let py = 0; py < H; py++) {
    const v = py / H;
    const lat = 90 - v * 180;
    const absLat = Math.abs(lat);
    for (let px = 0; px < W; px++) {
      const u = px / W;
      const lon = u * 360 - 180;
      const idx = (py * W + px) * 4;

      const nCoarse = fbm2D(u * 14.0, v * 7.0, 4);
      const nDetail = fbm2D(u * 48.0 + 7.3, v * 24.0 + 3.1, 3);
      const rawLand = landData[idx] / 255.0;
      const shelfVal = shelfData[idx] / 255.0;

      const coastFactor = rawLand + (nDetail - 0.5) * 0.28 + (nCoarse - 0.5) * 0.14;
      const isLand = coastFactor > 0.5;

      let r = 0, g = 0, b = 0, elev = 10, spec = 0;
      let nightR = 0, nightG = 0, nightB = 0;

      if (!isLand) {
        // Batimetri samudra dalam -> perairan dangkal biru-toska
        const shallow = THREE.MathUtils.clamp(shelfVal * 1.65 + (nDetail - 0.5) * 0.12, 0, 1);
        const abyss = nCoarse * 0.35;
        r = THREE.MathUtils.lerp(7 + abyss * 10, 22, shallow * shallow);
        g = THREE.MathUtils.lerp(24 + abyss * 24, 118, Math.pow(shallow, 1.35));
        b = THREE.MathUtils.lerp(56 + abyss * 38, 152, Math.pow(shallow, 1.2));
        spec = 235;
      } else {
        let mtn = 0;
        for (let m = 0; m < mountains.length; m++) {
          const [mlon, mlat, mr, ms] = mountains[m];
          const d = Math.hypot((lon - mlon) * 0.85, lat - mlat);
          if (d < mr) {
            const k = 1.0 - d / mr;
            mtn = Math.max(mtn, k * k * ms * (0.55 + nDetail * 0.75));
          }
        }
        const hVal = THREE.MathUtils.clamp(0.15 + nCoarse * 0.32 + mtn * 0.78, 0, 1);
        elev = Math.round(40 + hVal * 215);

        let arid = 0;
        for (let d = 0; d < deserts.length; d++) {
          const [dlon, dlat, rx, ry] = deserts[d];
          const dist = Math.hypot((lon - dlon) / rx, (lat - dlat) / ry);
          if (dist < 1.3) arid = Math.max(arid, Math.pow(1.0 - dist / 1.3, 1.3));
        }
        arid = THREE.MathUtils.clamp(arid + (nCoarse - 0.52) * 0.32, 0, 1);

        const iceMask = THREE.MathUtils.clamp(
          ((absLat - 67) / 11.0) + (nCoarse - 0.5) * 0.25 + (hVal > 0.74 ? (hVal - 0.74) * 4.5 : 0),
          0, 1
        );

        const trop = THREE.MathUtils.clamp(1.0 - absLat / 28.0, 0, 1);
        let lr = THREE.MathUtils.lerp(48, 22, trop) + (nDetail - 0.5) * 18;
        let lg = THREE.MathUtils.lerp(82, 66, trop) + (nDetail - 0.5) * 20;
        let lb = THREE.MathUtils.lerp(42, 30, trop) + (nDetail - 0.5) * 10;

        lr = THREE.MathUtils.lerp(lr, 192 + nDetail * 24, arid);
        lg = THREE.MathUtils.lerp(lg, 158 + nDetail * 20, arid);
        lb = THREE.MathUtils.lerp(lb, 110 + nDetail * 14, arid);

        const rock = THREE.MathUtils.clamp((hVal - 0.48) * 2.8, 0, 1);
        lr = THREE.MathUtils.lerp(lr, 112, rock * 0.75);
        lg = THREE.MathUtils.lerp(lg, 104, rock * 0.75);
        lb = THREE.MathUtils.lerp(lb, 96, rock * 0.75);

        r = THREE.MathUtils.lerp(lr, 236, iceMask);
        g = THREE.MathUtils.lerp(lg, 242, iceMask);
        b = THREE.MathUtils.lerp(lb, 248, iceMask);
        spec = Math.round(iceMask * 55);

        if (iceMask < 0.35) {
          let glow = 0;
          for (let c = 0; c < cities.length; c++) {
            const [clon, clat, cr] = cities[c];
            const cd = Math.hypot((lon - clon) * 0.85, lat - clat);
            if (cd < cr * 2.2) {
              glow += Math.exp(-(cd * cd) / (cr * cr * 0.55));
            }
          }
          if (glow > 0.08) {
            const sparkle = Math.pow(fastHash2D(px * 0.7, py * 0.7), 1.4) * 0.65 + 0.35;
            const intensity = Math.min(1.0, glow * sparkle * 1.25);
            nightR = Math.round(255 * intensity);
            nightG = Math.round(200 * intensity);
            nightB = Math.round(105 * intensity);
          }
        }
      }

      aImg.data[idx] = THREE.MathUtils.clamp(r, 0, 255);
      aImg.data[idx + 1] = THREE.MathUtils.clamp(g, 0, 255);
      aImg.data[idx + 2] = THREE.MathUtils.clamp(b, 0, 255);
      aImg.data[idx + 3] = 255;

      bImg.data[idx] = elev; bImg.data[idx + 1] = elev; bImg.data[idx + 2] = elev; bImg.data[idx + 3] = 255;
      spImg.data[idx] = spec; spImg.data[idx + 1] = spec; spImg.data[idx + 2] = spec; spImg.data[idx + 3] = 255;
      nImg.data[idx] = nightR; nImg.data[idx + 1] = nightG; nImg.data[idx + 2] = nightB; nImg.data[idx + 3] = 255;

      // Awan global (ITCZ + angin pasat + siklon berputar)
      let cu = u;
      let cv = v;
      for (let cy = 0; cy < cyclones.length; cy++) {
        const [clon, clat, crad] = cyclones[cy];
        const dx = lon - clon;
        const dy = lat - clat;
        const d = Math.hypot(dx, dy);
        if (d < crad && d > 0.5) {
          const swirl = (1.0 - d / crad) * 0.032;
          const ang = Math.atan2(dy, dx) + swirl * 18.0;
          cu += Math.cos(ang) * swirl * 0.35;
          cv += Math.sin(ang) * swirl * 0.35;
        }
      }
      const band = 0.65 + 0.35 * Math.cos((absLat - 45) * 0.08) + 0.28 * Math.exp(-Math.pow(lat / 10, 2));
      const cNoise = fbm2D(cu * 12.0 + Math.sin(cv * 9.0) * 0.4, cv * 8.0, 4);
      const cFine = smoothNoise2D(cu * 36.0, cv * 24.0);
      const cloudAlpha = THREE.MathUtils.clamp((cNoise * 0.78 + cFine * 0.22) * band - 0.54, 0, 1) * 2.55;
      const ca = Math.round(THREE.MathUtils.clamp(cloudAlpha, 0, 0.94) * 255);
      cImg.data[idx] = 248; cImg.data[idx + 1] = 251; cImg.data[idx + 2] = 255; cImg.data[idx + 3] = ca;
    }
  }

  aCtx.putImageData(aImg, 0, 0);
  bCtx.putImageData(bImg, 0, 0);
  spCtx.putImageData(spImg, 0, 0);
  nCtx.putImageData(nImg, 0, 0);
  cCtx.putImageData(cImg, 0, 0);

  const makeTex = (canvas, isSRGB = true) => {
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.anisotropy = 8;
    if (isSRGB) tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  };

  return {
    albedo: makeTex(albedoCanvas, true),
    bump: makeTex(bumpCanvas, false),
    spec: makeTex(specCanvas, false),
    night: makeTex(nightCanvas, true),
    clouds: makeTex(cloudCanvas, true)
  };
}

function createPhotorealisticEarthMaterial(tex) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uAlbedo: { value: tex.albedo },
      uBump: { value: tex.bump },
      uSpec: { value: tex.spec },
      uNight: { value: tex.night },
      uClouds: { value: tex.clouds },
      uSunDir: { value: WORLD_COORDS.ORBIT_SUN_DIR.clone() },
      uCloudOffset: { value: 0.0 }
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormalWorld;
      varying vec3 vWorldPos;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vNormalWorld = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform sampler2D uAlbedo;
      uniform sampler2D uBump;
      uniform sampler2D uSpec;
      uniform sampler2D uNight;
      uniform sampler2D uClouds;
      uniform vec3 uSunDir;
      uniform float uCloudOffset;
      varying vec2 vUv;
      varying vec3 vNormalWorld;
      varying vec3 vWorldPos;

      void main() {
        vec3 N = normalize(vNormalWorld);
        vec3 V = normalize(cameraPosition - vWorldPos);
        vec3 L = normalize(uSunDir);

        vec2 eps = vec2(0.0012, 0.0);
        float hL = texture2D(uBump, vUv - eps.xy).r;
        float hR = texture2D(uBump, vUv + eps.xy).r;
        float hD = texture2D(uBump, vUv - eps.yx).r;
        float hU = texture2D(uBump, vUv + eps.yx).r;
        vec3 upRef = abs(N.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
        vec3 T = normalize(cross(upRef, N));
        vec3 B = cross(N, T);
        vec3 bumpedN = normalize(N + T * (hL - hR) * 2.8 + B * (hD - hU) * 2.8);

        vec3 albedo = texture2D(uAlbedo, vUv).rgb;
        float specMask = texture2D(uSpec, vUv).r;
        vec3 nightLights = texture2D(uNight, vUv).rgb;

        // Bayangan awan jatuh lembut ke permukaan darat & samudra
        vec2 cloudShadowUv = vec2(fract(vUv.x + uCloudOffset - 0.0035), clamp(vUv.y - 0.002, 0.0, 1.0));
        float cloudShadow = texture2D(uClouds, cloudShadowUv).a * 0.45;

        float ndlSmooth = dot(N, L);
        float ndlBump = max(0.0, dot(bumpedN, L));
        float dayFactor = smoothstep(-0.14, 0.22, ndlSmooth);

        vec3 H = normalize(L + V);
        float glint = pow(max(dot(N, H), 0.0), 72.0) * specMask * (1.0 - cloudShadow * 1.4) * dayFactor;
        float broadSpec = pow(max(dot(N, H), 0.0), 14.0) * specMask * 0.18 * dayFactor;

        float terminator = exp(-pow((ndlSmooth - 0.02) / 0.14, 2.0));
        vec3 sunsetTint = vec3(1.0, 0.42, 0.16) * terminator * 0.34;

        vec3 dayCol = albedo * (0.09 + 1.08 * ndlBump) * (1.0 - cloudShadow)
                    + vec3(1.0, 0.96, 0.88) * (glint * 0.95 + broadSpec)
                    + sunsetTint * (0.4 + 0.6 * albedo);

        vec3 nightCol = albedo * 0.025 + nightLights * (1.55 - cloudShadow * 0.9);
        vec3 col = mix(nightCol, dayCol, dayFactor);

        float fresnel = pow(1.0 - max(0.0, dot(N, V)), 3.2);
        vec3 atmoHaze = mix(vec3(0.24, 0.58, 1.0), vec3(0.95, 0.52, 0.24), terminator * 0.65);
        col += atmoHaze * fresnel * (0.12 + 0.88 * dayFactor) * 0.72;

        gl_FragColor = vec4(col, 1.0);
      }
    `
  });
}

function createRealisticCloudMaterial(cloudTex) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uClouds: { value: cloudTex },
      uSunDir: { value: WORLD_COORDS.ORBIT_SUN_DIR.clone() }
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormalWorld;
      void main() {
        vUv = uv;
        vNormalWorld = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D uClouds;
      uniform vec3 uSunDir;
      varying vec2 vUv;
      varying vec3 vNormalWorld;
      void main() {
        vec4 c = texture2D(uClouds, vUv);
        float ndl = dot(normalize(vNormalWorld), normalize(uSunDir));
        float day = smoothstep(-0.16, 0.24, ndl);
        float term = exp(-pow((ndl - 0.01) / 0.13, 2.0));
        vec3 lit = mix(vec3(0.06, 0.09, 0.16), vec3(0.98, 0.99, 1.0), day);
        lit += vec3(1.0, 0.52, 0.24) * term * 0.42;
        gl_FragColor = vec4(lit, c.a * 0.88);
      }
    `,
    transparent: true,
    depthWrite: false
  });
}

function createAtmosphericLimbMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uSunDir: { value: WORLD_COORDS.ORBIT_SUN_DIR.clone() }
    },
    vertexShader: `
      varying vec3 vNormalWorld;
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vNormalWorld = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform vec3 uSunDir;
      varying vec3 vNormalWorld;
      varying vec3 vWorldPos;
      void main() {
        vec3 N = normalize(vNormalWorld);
        vec3 V = normalize(cameraPosition - vWorldPos);
        float rim = pow(clamp(0.68 - dot(N, V), 0.0, 1.0), 2.6);
        float sunSide = smoothstep(-0.28, 0.35, dot(N, normalize(uSunDir)));
        float term = exp(-pow((dot(N, normalize(uSunDir))) / 0.24, 2.0));
        vec3 col = mix(vec3(0.22, 0.62, 1.0), vec3(1.0, 0.48, 0.22), term * 0.45);
        gl_FragColor = vec4(col * 1.35, rim * (0.14 + 0.86 * sunSide) * 0.85);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    depthWrite: false
  });
}

// ============================================================================
// 4. MODEL 3D: RAPTOR NOZZLE, MECHAZILLA, ASDS, SUPER HEAVY & STARSHIP
// ============================================================================
function createRaptorEngineUnit(scale = 1.0, isVacuum = false) {
  const pivot = new THREE.Group();
  const nozzleMat = new THREE.MeshStandardMaterial({
    color: isVacuum ? 0x334155 : 0x475569,
    metalness: 0.88,
    roughness: 0.32
  });

  const topR = (isVacuum ? 0.45 : 0.32) * scale;
  const botR = (isVacuum ? 1.18 : 0.65) * scale;
  const h = (isVacuum ? 2.8 : 1.7) * scale;

  nozzleMat.side = THREE.DoubleSide;
  const nozzle = new THREE.Mesh(
    new THREE.LatheGeometry([[botR, 0], [0.91 * botR, 0.28], [topR, 0.8], [0.85 * topR, 1]].map(([r, y]) => new THREE.Vector2(r, h * (y - 1))), 24),
    nozzleMat
  );
  pivot.add(nozzle);

  // Api Propulsi 3 Lapis: Inti Putih-Sian (Mach Diamonds) + Plasma Biru + Api Oranye-Merah
  const plumeGroup = new THREE.Group();
  plumeGroup.position.y = -h;

  const coreMat = createPlumeShaderMaterial('#f0f9ff', '#38bdf8', true, 0.25);
  const core = new THREE.Mesh(new THREE.ConeGeometry(botR * 0.92, 16 * scale, 14, 1, true), coreMat);
  core.rotation.x = Math.PI;
  core.position.y = -8 * scale;

  const midMat = createPlumeShaderMaterial('#38bdf8', '#6366f1', false, 0.45);
  const mid = new THREE.Mesh(new THREE.ConeGeometry(botR * 1.45, 24 * scale, 14, 1, true), midMat);
  mid.rotation.x = Math.PI;
  mid.position.y = -12 * scale;

  const outerMat = createPlumeShaderMaterial('#fb923c', '#ef4444', false, 0.15);
  const outer = new THREE.Mesh(new THREE.ConeGeometry(botR * 2.05, 32 * scale, 14, 1, true), outerMat);
  outer.rotation.x = Math.PI;
  outer.position.y = -16 * scale;

  plumeGroup.add(core, mid, outer);
  plumeGroup.visible = false;
  pivot.add(plumeGroup);

  return {
    pivot,
    nozzle,
    plumeGroup,
    materials: [coreMat, midMat, outerMat],
    isVacuum
  };
}

function buildMechazillaAndPad() {
  const group = new THREE.Group();
  const concrete = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.92 });
  const steelDark = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.72, roughness: 0.42 });
  const steelLight = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.82, roughness: 0.34 });
  const accentAmber = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.55 });

  // Landasan Beton Starbase & Cincin Orbital Launch Mount (OLM)
  const padSlab = new THREE.Mesh(new THREE.BoxGeometry(175, 4, 155), concrete);
  padSlab.position.y = -2;
  group.add(padSlab);

  const olmRing = new THREE.Mesh(new THREE.TorusGeometry(6.8, 1.8, 16, 36), steelDark);
  olmRing.rotation.x = Math.PI / 2;
  olmRing.position.y = WORLD_COORDS.OLM_Y - 1.2;
  group.add(olmRing);

  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.75, WORLD_COORDS.OLM_Y, 12), concrete);
    leg.position.set(Math.cos(a) * 8.2, WORLD_COORDS.OLM_Y * 0.5 - 0.5, Math.sin(a) * 8.2);
    group.add(leg);
  }

  // Menara Rangka Baja Mechazilla (Tinggi 146 m)
  const towerX = WORLD_COORDS.TOWER_X;
  const towerCore = new THREE.Mesh(new THREE.BoxGeometry(3, 146, 3), steelDark);
  towerCore.position.set(towerX, 73, 0);
  group.add(towerCore);
  // Batch the columns, cross braces and floor beams into a single draw call.
  const corners = [[-5,-5], [5,-5], [5,5], [-5,5]];
  const members = [];
  function beam(i, y, j, top, width) {
    const a = new THREE.Vector3(towerX + corners[i][0], y, corners[i][1]);
    const b = new THREE.Vector3(towerX + corners[j][0], top, corners[j][1]);
    const direction = b.clone().sub(a);
    members.push(new THREE.Matrix4().compose(a.lerp(b, 0.5),
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0), direction.clone().normalize()),
      new THREE.Vector3(width, direction.length(), width)));
  }
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    beam(i, 0, i, 146, 1);
    for (let level = 0; level < 12; level++) {
      const y = level * 12;
      beam(i, y + 12, j, y + 12, 0.65);
      beam(i, y, j, y + 12, 0.46);
      beam(j, y, i, y + 12, 0.46);
    }
  }
  const lattice = new THREE.InstancedMesh(new THREE.BoxGeometry(), steelLight, members.length);
  members.forEach((matrix, index) => lattice.setMatrixAt(index, matrix));
  group.add(lattice);

  // Rel vertikal depan menara untuk pergerakan Carriage Chopsticks
  for (const rz of [-4.4, 4.4]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(1.2, 138, 1.2), steelLight);
    rail.position.set(towerX + 5.8, 72, rz);
    group.add(rail);
  }

  // Kereta Angkat (Carriage) + Sepasang Lengan Chopsticks Aktif
  const carriage = new THREE.Group();
  carriage.position.set(towerX + 5.8, 108.0, 0);
  carriage.add(new THREE.Mesh(new THREE.BoxGeometry(4.6, 8.8, 12.6), steelLight));

  const leftPivot = new THREE.Group();
  leftPivot.position.set(1.6, 0, -5.8);
  const leftArm = new THREE.Mesh(new THREE.BoxGeometry(24.5, 3.0, 1.8), steelLight);
  leftArm.position.set(12.2, -2.4, 0);
  const leftPad = new THREE.Mesh(new THREE.BoxGeometry(14.0, 0.9, 2.2), accentAmber);
  leftPad.position.set(14.5, -0.45, 0);
  leftPivot.add(leftArm, leftPad);

  const rightPivot = new THREE.Group();
  rightPivot.position.set(1.6, 0, 5.8);
  const rightArm = new THREE.Mesh(new THREE.BoxGeometry(24.5, 3.0, 1.8), steelLight);
  rightArm.position.set(12.2, -2.4, 0);
  const rightPad = new THREE.Mesh(new THREE.BoxGeometry(14.0, 0.9, 2.2), accentAmber);
  rightPad.position.set(14.5, -0.45, 0);
  rightPivot.add(rightArm, rightPad);

  carriage.add(leftPivot, rightPivot);
  group.add(carriage);

  // Quick Disconnect (QD) Arm untuk pengisian bahan bakar Starship
  const qdPivot = new THREE.Group();
  qdPivot.position.set(towerX + 5.5, WORLD_COORDS.OLM_Y + SPECS.boosterHeight + 5, -2);
  const qdBeam = new THREE.Mesh(new THREE.BoxGeometry(12.5, 1.6, 1.6), steelLight);
  qdBeam.position.set(6.25, 0, 0);
  qdPivot.add(qdBeam);
  group.add(qdPivot);

  // Penanda Kompas 3D (Timur 90° arah peluncuran orbit)
  const eastMarker = new THREE.Mesh(new THREE.BoxGeometry(14, 0.4, 2.4), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
  eastMarker.position.set(42, 0.25, 0);
  group.add(eastMarker);

  world.catchCarriageGroup = carriage;
  world.chopstickLeftPivot = leftPivot;
  world.chopstickRightPivot = rightPivot;
  world.catchPads = [leftPad, rightPad];
  world.qdArmPivot = qdPivot;

  return group;
}

function buildASDSDroneShip() {
  const group = new THREE.Group();
  group.position.set(WORLD_COORDS.ASDS_X, 0, WORLD_COORDS.ASDS_Z);

  const hullMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.78, metalness: 0.35 });
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.85, metalness: 0.2 });

  const hull = new THREE.Mesh(new THREE.BoxGeometry(92, 6.4, 58), hullMat);
  hull.position.y = 1.0;
  group.add(hull);

  const deck = new THREE.Mesh(new THREE.BoxGeometry(88, 0.4, 54), deckMat);
  deck.position.y = WORLD_COORDS.ASDS_DECK_OFFSET_Y;
  group.add(deck);

  // Target Lingkaran Pendaratan X khas SpaceX di atas dek ASDS
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(15.5, 17.5, 48),
    new THREE.MeshBasicMaterial({ color: 0xfacc15, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = WORLD_COORDS.ASDS_DECK_OFFSET_Y + 0.26;
  group.add(ring);

  const bar1 = new THREE.Mesh(new THREE.PlaneGeometry(24, 2.4), new THREE.MeshBasicMaterial({ color: 0xfacc15 }));
  bar1.rotation.x = -Math.PI / 2;
  bar1.rotation.z = Math.PI / 4;
  bar1.position.y = WORLD_COORDS.ASDS_DECK_OFFSET_Y + 0.28;
  const bar2 = bar1.clone();
  bar2.rotation.z = -Math.PI / 4;
  group.add(bar1, bar2);

  // 4 Tiang Lampu Suar ASDS di sudut dek
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
  for (const [bx, bz] of [[-40, -23], [40, -23], [-40, 23], [40, 23]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 6, 8), hullMat);
    pole.position.set(bx, WORLD_COORDS.ASDS_DECK_OFFSET_Y + 3, bz);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 10), beaconMat);
    lamp.position.set(bx, WORLD_COORDS.ASDS_DECK_OFFSET_Y + 6.2, bz);
    group.add(pole, lamp);
  }

  return group;
}

function buildSuperHeavyBooster() {
  const root = new THREE.Group();
  const steelMat = new THREE.MeshStandardMaterial({ color: 0xdbe4ee, metalness: 0.88, roughness: 0.26 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.65, roughness: 0.5 });

  // Silinder Utama Baja Tahan Karat (Tinggi 71 m, Diameter 9 m)
  const body = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, SPECS.boosterHeight, 36), steelMat);
  body.position.y = SPECS.boosterHeight * 0.5;
  root.add(body);
  const raceway = new THREE.Mesh(new THREE.BoxGeometry(0.45, 55, 1.0), darkMat);
  raceway.position.set(4.47, 32, 0);
  root.add(raceway);
  world.boosterCatchPins = [-1, 1].map(side => {
    const pin = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1, 2.2), steelMat);
    pin.position.set(0, WORLD_COORDS.BOOSTER_PIN_LOCAL_Y, side * 5.1);
    root.add(pin);
    return pin;
  });

  // Cincin Interstage Berventilasi di atas Booster
  const interstage = new THREE.Mesh(
    new THREE.CylinderGeometry(4.54, 4.54, SPECS.interstageHeight, 24, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.78, roughness: 0.35, wireframe: false })
  );
  interstage.position.y = SPECS.boosterHeight + SPECS.interstageHeight * 0.5;
  // Leave open sightlines through the hot-stage ring instead of a solid sleeve.
  interstage.scale.y = 0.18;
  interstage.position.y = SPECS.boosterHeight + SPECS.interstageHeight * 0.91;
  const webs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.48, SPECS.interstageHeight, 0.32), darkMat, 20);
  for (let i = 0; i < webs.count; i++) {
    const a = i * Math.PI * 2 / webs.count;
    webs.setMatrixAt(i, new THREE.Matrix4().makeRotationY(a).setPosition(
      4.38 * Math.sin(a), SPECS.boosterHeight + SPECS.interstageHeight / 2, 4.38 * Math.cos(a)));
  }
  root.add(interstage, webs);

  // 4 Grid Fins Aerodinamis Baja Titanium (aktif mengarahkan turunnya Booster)
  world.boosterGridFins = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const pivot = new THREE.Group();
    pivot.position.set(Math.cos(a) * 4.55, SPECS.boosterHeight - 4.2, Math.sin(a) * 4.55);
    pivot.rotation.y = -a;
    const fin = new THREE.InstancedMesh(new THREE.BoxGeometry(), darkMat, 12);
    for (let k = 0; k < 7; k++) fin.setMatrixAt(k, new THREE.Matrix4().makeScale(0.12, 0.52, 2.8).setPosition(k * 0.7, 0, 0));
    for (let k = 0; k < 5; k++) fin.setMatrixAt(7 + k, new THREE.Matrix4().makeScale(4.2, 0.52, 0.12).setPosition(2.1, 0, k * 0.7 - 1.4));
    pivot.add(fin);
    root.add(pivot);
    world.boosterGridFins.push(pivot);
  }

  // 4 Kaki Pendarat Lipat untuk mendarat di dek Pad Laut ASDS
  world.boosterLandingLegs = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const legPivot = new THREE.Group();
    legPivot.position.set(Math.cos(a) * 4.45, 7.5, Math.sin(a) * 4.45);
    legPivot.rotation.y = -a;
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.9, 8.2, 1.3), darkMat);
    strut.position.set(0.3, -3.9, 0);
    legPivot.add(strut);
    root.add(legPivot);
    world.boosterLandingLegs.push(legPivot);
  }

  // 33 Mesin Raptor Super Heavy:
  // 3 Pusat + 10 Cincin Tengah = 13 Mesin Gimbal X/Y Fleksibel
  world.boosterInnerEngines = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const eng = createRaptorEngineUnit(0.95, false);
    eng.pivot.position.set(Math.cos(a) * 1.1, 0, Math.sin(a) * 1.1);
    root.add(eng.pivot);
    world.boosterInnerEngines.push(eng);
  }
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const eng = createRaptorEngineUnit(0.92, false);
    eng.pivot.position.set(Math.cos(a) * 2.45, 0, Math.sin(a) * 2.45);
    root.add(eng.pivot);
    world.boosterInnerEngines.push(eng);
  }

  // 20 Mesin Cincin Luar Tetap
  world.boosterOuterEngines = [];
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    const eng = createRaptorEngineUnit(0.88, false);
    eng.pivot.position.set(Math.cos(a) * 3.85, 0, Math.sin(a) * 3.85);
    root.add(eng.pivot);
    world.boosterOuterEngines.push(eng);
  }

  // All 33 bells share geometry/material; gimballed pivots still own their plumes.
  const engines = [...world.boosterInnerEngines, ...world.boosterOuterEngines];
  const base = engines[0].nozzle;
  const bells = new THREE.InstancedMesh(base.geometry, base.material, 33);
  bells.frustumCulled = false;
  bells.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  engines.forEach(eng => { eng.nozzle.visible = false; });
  root.add(bells);
  world.boosterBells = bells;
  return root;
}

let heatTileTexture;
function getHeatTileTexture() {
  if (heatTileTexture) return heatTileTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 192; canvas.height = 222;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#505051'; ctx.fillRect(0, 0, 192, 222);
  for (let col = -1; col < 6; col++) for (let row = -1; row < 5; row++) {
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = k * Math.PI / 3;
      const x = col * 48 + 30 * Math.cos(a), y = row * 55.5 + (col % 2) * 27.75 + 30 * Math.sin(a);
      if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.closePath(); ctx.fillStyle = (col + row) % 3 ? '#242527' : '#303133'; ctx.fill();
  }
  heatTileTexture = new THREE.CanvasTexture(canvas);
  heatTileTexture.wrapS = heatTileTexture.wrapT = THREE.RepeatWrapping;
  heatTileTexture.repeat.set(6, 18);
  heatTileTexture.colorSpace = THREE.SRGBColorSpace;
  return heatTileTexture;
}

function buildStarshipModel(slArr, vacArr, includeFlapsAndVapor = true) {
  const root = new THREE.Group();
  const steelMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.9, roughness: 0.22 });
  const tileMat = new THREE.MeshStandardMaterial({ map: getHeatTileTexture(), bumpMap: getHeatTileTexture(), bumpScale: 0.018, metalness: 0.04, roughness: 0.92, side: THREE.DoubleSide });
  const pinMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, metalness: 0.65, roughness: 0.35 });

  // Silinder Baja & Kerucut Hidung Starship (Total 50 m)
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 39, 64), steelMat);
  cyl.position.y = 19.5;
  const profile = [[4.5,39],[4.45,41],[4.18,44],[3.65,47],[2.85,50],[1.72,53],[0.6,54.6],[0,55]];
  const noseProfile = extra => profile.map(([r,y]) => new THREE.Vector2(r ? r + extra : 0, y));
  const nose = new THREE.Mesh(new THREE.LatheGeometry(noseProfile(0), 48), steelMat);

  // Perisai Panas Ubin Keramik Hitam di sisi perut (windward side)
  const shield = new THREE.Mesh(
    new THREE.CylinderGeometry(4.56, 4.56, 39, 48, 1, true, -Math.PI, Math.PI),
    tileMat
  );
  shield.position.y = 19.5;
  const noseShield = new THREE.Mesh(
    new THREE.LatheGeometry(noseProfile(0.06), 24, -Math.PI, Math.PI),
    tileMat
  );

  // Sepasang Pin Tangkap (Catch Pins) di ketinggian lokal 39 m untuk dijepit Chopsticks Mechazilla
  const pinL = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.0, 2.2), pinMat);
  pinL.position.set(0, WORLD_COORDS.SHIP_PIN_LOCAL_Y, -5.1);
  const pinR = pinL.clone();
  pinR.position.z = 5.1;
  if (includeFlapsAndVapor) world.shipCatchPins = [pinL, pinR];

  root.add(cyl, nose, shield, noseShield, pinL, pinR);
  const tanks = new THREE.Group();
  for (const [y, radius, length, color] of [[12, 3.9, 13, 0x72bfda], [29, 3.8, 5, 0xdb9866], [42, 1.7, 1, 0x88cab3]]) {
    const tank = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 8, 36),
      new THREE.MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.31 }));
    tank.position.y = y;
    tanks.add(tank);
  }
  tanks.visible = false;
  root.add(tanks);
  root.userData.setCutaway = enabled => {
    cyl.visible = nose.visible = !enabled;
    tanks.visible = enabled;
  };

  // 4 Sirip Aerodinamis (2 Forward Flaps + 2 Aft Flaps) untuk manuver Belly Flop
  const mkFlap = (w, h, d, y, z) => {
    const pv = new THREE.Group();
    pv.position.set(0, y, z);
    const outline = new THREE.Shape();
    outline.moveTo(-0.5, -h * 0.5);
    outline.lineTo(d * 0.92, -h * 0.43);
    outline.lineTo(d, -h * 0.12);
    outline.lineTo(0.2, h * 0.5);
    outline.lineTo(-0.5, h * 0.5);
    outline.closePath();
    const geo = new THREE.ExtrudeGeometry(outline, { depth: w, bevelEnabled: false });
    geo.translate(0, 0, -w / 2).rotateY(-Math.sign(z) * Math.PI / 2);
    const mesh = new THREE.Mesh(geo, tileMat);
    pv.add(mesh);
    root.add(pv);
    return pv;
  };

  const fwdL = mkFlap(0.45, 6.0, 3.4, 47.7, -3.1);
  const fwdR = mkFlap(0.45, 6.0, 3.4, 47.7, 3.1);
  const aftL = mkFlap(0.55, 14.2, 6.2, 8.0, -4.4);
  const aftR = mkFlap(0.55, 14.2, 6.2, 8.0, 4.4);

  if (includeFlapsAndVapor) {
    world.shipFlaps = { fwdL, fwdR, aftL, aftR };

    // Kerucut kondensasi uap (Vapor Cone) saat menembus kecepatan suara / Max-Q
    const vcMat = new THREE.MeshBasicMaterial({
      color: 0xf8fafc,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const vaporCone = new THREE.Mesh(new THREE.ConeGeometry(16, 18, 32, 1, true), vcMat);
    vaporCone.position.y = 32;
    root.add(vaporCone);
    world.vaporConeMesh = vaporCone;
  }

  // 3 Mesin Raptor Sea-Level di tengah (Gimbal fleksibel X & Y ±15°)
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const eng = createRaptorEngineUnit(0.95, false);
    eng.pivot.position.set(Math.cos(a) * 1.25, 0, Math.sin(a) * 1.25);
    root.add(eng.pivot);
    slArr.push(eng);
  }

  // 3 Mesin Raptor Vacuum (Nozzle lebar untuk luar angkasa)
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 3;
    const eng = createRaptorEngineUnit(1.05, true);
    eng.pivot.position.set(Math.cos(a) * 2.95, 0, Math.sin(a) * 2.95);
    root.add(eng.pivot);
    vacArr.push(eng);
  }

  return root;
}

// ============================================================================
// 5. SCENE KHUSUS ORBIT BUMI 360° FOTOREALISTIS + STARLINK DEPLOY
// ============================================================================
function buildOrbitalScene(softParticleTex) {
  const oScene = new THREE.Scene();
  oScene.background = new THREE.Color(0x01030b);
  world.orbitalScene = oScene;

  // Hitung bidang orbit miring 28.5° tepat di atas Starbase, Boca Chica, Texas (26°N, 97.15°W)
  world.orbitU.copy(latLonToVec3(26.0, -97.15, 1.0)).normalize();
  const eastHint = latLonToVec3(-6.0, -7.0, 1.0);
  world.orbitV.copy(eastHint).addScaledVector(world.orbitU, -eastHint.dot(world.orbitU)).normalize();
  world.orbitNormal.crossVectors(world.orbitU, world.orbitV).normalize();

  const orbSun = new THREE.DirectionalLight(0xfffcf5, 2.8);
  orbSun.position.copy(WORLD_COORDS.ORBIT_SUN_DIR).multiplyScalar(3200);
  oScene.add(orbSun, new THREE.HemisphereLight(0x38bdf8, 0x0f172a, 0.45));

  // Bintang luar angkasa tajam
  const starGeo = new THREE.BufferGeometry();
  const sPos = new Float32Array(3200 * 3);
  for (let i = 0; i < 3200; i++) {
    const r = 4600 + Math.random() * 2400;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    sPos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    sPos[i * 3 + 1] = r * Math.cos(ph);
    sPos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  oScene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xe2e8f0, size: 3.4 })));

  // Bangun tekstur Bumi satelit & pasang bola Bumi + Awan + Atmosfer Rayleigh
  world.earthTextures = generatePhotorealisticEarthTextures();

  world.orbitalEarthMesh = new THREE.Mesh(
    new THREE.SphereGeometry(WORLD_COORDS.R_EARTH_ORBIT, 96, 64),
    createPhotorealisticEarthMaterial(world.earthTextures)
  );
  oScene.add(world.orbitalEarthMesh);

  world.orbitalCloudsMesh = new THREE.Mesh(
    new THREE.SphereGeometry(WORLD_COORDS.R_EARTH_ORBIT + 5.2, 80, 56),
    createRealisticCloudMaterial(world.earthTextures.clouds)
  );
  oScene.add(world.orbitalCloudsMesh);

  world.orbitalAtmoMesh = new THREE.Mesh(
    new THREE.SphereGeometry(WORLD_COORDS.R_EARTH_ORBIT + 24.0, 64, 48),
    createAtmosphericLimbMaterial()
  );
  oScene.add(world.orbitalAtmoMesh);

  // Cincin lintasan orbit LEO 360° & penanda waypoint utama
  const ringPts = [];
  for (let i = 0; i <= 180; i++) {
    const a = (i / 180) * Math.PI * 2;
    const p = world.orbitU.clone().multiplyScalar(Math.cos(a) * WORLD_COORDS.R_ORBIT_LEO)
      .addScaledVector(world.orbitV, Math.sin(a) * WORLD_COORDS.R_ORBIT_LEO);
    ringPts.push(p);
  }
  oScene.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(ringPts),
    new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.34 })
  ));

  world.orbitalRingProgressLine = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0x22d3ee })
  );
  oScene.add(world.orbitalRingProgressLine);

  const addMarker = (deg, col) => {
    const rad = THREE.MathUtils.degToRad(deg);
    const m = new THREE.Mesh(new THREE.SphereGeometry(5.2, 12, 12), new THREE.MeshBasicMaterial({ color: col }));
    m.position.copy(world.orbitU).multiplyScalar(Math.cos(rad) * WORLD_COORDS.R_ORBIT_LEO)
      .addScaledVector(world.orbitV, Math.sin(rad) * WORLD_COORDS.R_ORBIT_LEO);
    oScene.add(m);
  };
  addMarker(0, 0x10b981);   // Starbase Texas
  addMarker(14, 0x38bdf8);  // Orbital Insertion Burn
  addMarker(42, 0xa855f7);  // Starlink Deploy
  addMarker(308, 0xf59e0b); // Deorbit Burn
  addMarker(332, 0xf43f5e); // Starship Entry Plasma

  // Starship versi Orbit (selalu ditempatkan di luar permukaan Bumi, tidak pernah clipping)
  world.orbitalShipGroup = new THREE.Group();
  const shipModel = buildStarshipModel(world.orbitalShipSLEngines, world.orbitalShipVacEngines, false);
  world.orbitalShipGroup.userData.setCutaway = shipModel.userData.setCutaway;
  shipModel.scale.setScalar(0.55);
  shipModel.position.y = -13.5;
  world.orbitalShipGroup.add(shipModel);

  // Pintu Pez-Dispenser untuk pelepasan satelit Starlink
  world.starlinkDoorMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 5.2, 2.2),
    new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.9, roughness: 0.25 })
  );
  world.starlinkDoorMesh.position.set(-2.4, 8.2, 0);
  world.orbitalShipGroup.add(world.starlinkDoorMesh);

  world.starlinkPayloadGroup = new THREE.Group();
  oScene.add(world.starlinkPayloadGroup);
  world.starlinkSats = [];

  // Selubung Plasma Reentry pijar oranye-magenta
  world.orbitalPlasmaMesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(6.5, 22.0, 12, 24),
    createReentryPlasmaMaterial()
  );
  world.orbitalPlasmaMesh.visible = false;
  world.orbitalShipGroup.add(world.orbitalPlasmaMesh);

  world.orbitalPlasmaLight = new THREE.PointLight(0xff5522, 0, 160);
  world.orbitalShipGroup.add(world.orbitalPlasmaLight);

  // Jet Gas Dingin RCS untuk manuver sikap di ruang hampa
  world.orbitalRCSJets = [];
  const rcsMat = new THREE.MeshBasicMaterial({ color: 0xe0f2fe, transparent: true, opacity: 0.78 });
  for (const [rx, ry] of [[3.2, 11], [-3.2, 11], [3.2, -10], [-3.2, -10]]) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.9, 5.5, 8), rcsMat);
    cone.position.set(rx, ry, 0);
    cone.rotation.z = rx > 0 ? -Math.PI * 0.5 : Math.PI * 0.5;
    cone.visible = false;
    world.orbitalShipGroup.add(cone);
    world.orbitalRCSJets.push(cone);
  }

  world.orbitalShipGroup.position.copy(world.orbitU).multiplyScalar(WORLD_COORDS.R_ORBIT_LEO);
  world.orbitalShipGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), world.orbitV);
  oScene.add(world.orbitalShipGroup);

  world.orbitalPlasmaPool = new ParticlePool(oScene, 420, 7.5, true, softParticleTex);
}

// ============================================================================
// 6. INISIALISASI UTAMA DUNIA 3D & FUNGSI BANTU VISUAL
// ============================================================================
async function attachStarbaseTerrain() {
  const credit = document.getElementById('terrain-credit');
  if (!credit) return;
  credit.textContent = 'Starbase · Terrain lokal';
  const key = TERRAIN.apiKey;
  if (!key) return;
  try {
    const [{ TilesRenderer }, { GoogleCloudAuthPlugin, ReorientationPlugin, GLTFExtensionsPlugin }, { DRACOLoader }] = await Promise.all([
      import('3d-tiles-renderer'), import('3d-tiles-renderer/plugins'), import('three/addons/loaders/DRACOLoader.js')
    ]);
    const tiles = new TilesRenderer();
    tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: key, autoRefreshToken: true }));
    tiles.registerPlugin(new ReorientationPlugin({ lat: THREE.MathUtils.degToRad(TERRAIN.latitude), lon: THREE.MathUtils.degToRad(TERRAIN.longitude) }));
    const draco = new DRACOLoader().setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco, autoDispose: false }));
    let visible = false;
    const fallback = () => {
      if (world.tiles !== tiles) return;
      clearTimeout(timer);
      world.tiles = null;
      world.scene.remove(tiles.group);
      tiles.dispose();
      draco.dispose();
      world.oceanMesh.visible = true;
      world.localTerrain.visible = true;
      Logger.error('Google Map Tiles tidak tersedia; fallback lokal aktif.');
      credit.textContent = 'Starbase · Google Tiles tidak tersedia · Terrain lokal';
    };
    const timer = setTimeout(() => { if (!visible) fallback(); }, TERRAIN.timeoutMs);
    tiles.addEventListener('load-error', () => { if (world.tiles === tiles && !visible) fallback(); });
    tiles.addEventListener('tile-visibility-change', e => {
      if (world.tiles !== tiles) return;
      if (e.visible) { visible = true; clearTimeout(timer); world.localTerrain.visible = false; }
      if (visible) credit.textContent = ['Google Maps', ...tiles.getAttributions().filter(a => a.type === 'string').map(a => a.value)].join(' · ');
    });
    world.scene.add(tiles.group);
    tiles.setCamera(world.renderCamera);
    world.tiles = tiles;
  } catch { Logger.error('Modul Google Tiles gagal dimuat.'); credit.textContent = 'Starbase · Google Tiles tidak tersedia · Terrain lokal'; }
}

function buildLocalTerrain() {
  // A coastal fallback, not a claim of surveyed Starbase photogrammetry.
  const geo = new THREE.PlaneGeometry(18000, 18000, 120, 120);
  geo.rotateX(-Math.PI / 2);
  const points = geo.attributes.position, colors = [];
  const sand = new THREE.Color('#b5ae91'), grass = new THREE.Color('#78836b');
  for (let i = 0; i < points.count; i++) {
    const x = points.getX(i), z = points.getZ(i);
    const coast = 750 + Math.sin(z / 650) * 110 + z * 0.07;
    const land = x < coast;
    points.setY(i, land ? Math.max(0.05, 1.5 + Math.sin(x / 55) * Math.cos(z / 81)) : -8);
    if (Math.hypot(x, z) < 240) points.setY(i, -0.2);
    const c = sand.clone().lerp(grass, land ? 0.35 + 0.25 * Math.sin(x / 57 + z / 60) : 0);
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97 }));
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.add(mesh);
  const road = new THREE.Mesh(new THREE.BoxGeometry(1300, 0.3, 12), new THREE.MeshStandardMaterial({ color: '#646664', roughness: 0.95 }));
  road.position.set(-700, 2.5, 85); group.add(road);
  const tankMat = new THREE.MeshStandardMaterial({ color: '#e5e4da', metalness: 0.4, roughness: 0.4 });
  for (let i = 0; i < 5; i++) {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 24, 24), tankMat);
    tank.position.set(-155 - i * 17, 14, -75); tank.castShadow = true; group.add(tank);
  }
  return group;
}

let mapsScriptPromise;
const googleModelUrls = [];
const googleCameraState = new THREE.Vector3(Infinity, Infinity, Infinity);

function loadGoogleMaps(key) {
  if (window.google?.maps?.importLibrary) return Promise.resolve();
  if (!mapsScriptPromise) mapsScriptPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Google Maps timeout')), 20000);
    window.starbaseMapsReady = () => { clearTimeout(timer); resolve(); };
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=beta&loading=async&callback=starbaseMapsReady`;
    script.onerror = () => { clearTimeout(timer); reject(new Error('Google Maps gagal dimuat')); };
    document.head.append(script);
  });
  return mapsScriptPromise;
}

async function exportMapModel(source, movingParts = []) {
  // Export only core glTF PBR meshes; Google Models doesn't support our GLSL plumes.
  const clone = source.clone(true);
  clone.visible = true;
  clone.position.set(0, 0, 0); clone.quaternion.identity(); clone.scale.setScalar(1);
  const remove = [], expand = [];
  clone.traverse(obj => {
    if (obj !== clone && movingParts.some(part => part.name === obj.name)) remove.push(obj);
    else if (obj.isMesh && (obj.material.isShaderMaterial || obj.material.transparent)) remove.push(obj);
    else if (obj.isInstancedMesh) expand.push(obj);
    else if (obj.isLight || obj.isPoints || obj.isLine) remove.push(obj);
  });
  for (const obj of remove) obj.removeFromParent();
  for (const instanced of expand) {
    const group = new THREE.Group(); group.position.copy(instanced.position); group.quaternion.copy(instanced.quaternion); group.scale.copy(instanced.scale);
    for (let i = 0; i < instanced.count; i++) {
      const mesh = new THREE.Mesh(instanced.geometry, instanced.material);
      instanced.getMatrixAt(i, mesh.matrix); mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale); group.add(mesh);
    }
    instanced.parent?.add(group); instanced.removeFromParent();
  }
  const data = await new GLTFExporter().parseAsync(clone, { binary: true, onlyVisible: true });
  const url = URL.createObjectURL(new Blob([data], { type: 'model/gltf-binary' }));
  googleModelUrls.push(url);
  return url;
}

function geoPosition(position) {
  return { lat: TERRAIN.latitude - position.z / 111320, lng: TERRAIN.longitude + position.x / (111320 * Math.cos(THREE.MathUtils.degToRad(TERRAIN.latitude))), altitude: position.y };
}

export async function toggleGoogleWorld() {
  const button = document.getElementById('btn-world'), host = document.getElementById('google-world');
  if (world.googleLoading) return;
  if (world.googleActive) {
    world.googleActive = false; host.classList.add('hidden');
    button.textContent = 'World: Simulator'; button.setAttribute('aria-pressed', 'false');
    return;
  }
  const key = TERRAIN.apiKey;
  if (!key) { document.getElementById('map-settings').showModal(); return; }
  world.googleLoading = true; button.textContent = 'Google 3D: memuat…';
  try {
    window.gm_authFailure = () => {
      world.googleActive = false; host.classList.add('hidden');
      button.textContent = 'Google: periksa key'; button.setAttribute('aria-pressed', 'false');
      document.getElementById('map-settings-status').textContent = 'Google menolak autentikasi Maps JavaScript. Periksa izin API dan referrer localhost:8000. Setelah mengubah key, muat ulang halaman.';
      document.getElementById('map-settings').showModal();
    };
    await loadGoogleMaps(key);
    if (!world.googleMap) {
      const { Map3DElement, Model3DElement } = await window.google.maps.importLibrary('maps3d');
      if (!Model3DElement) throw new Error('Model3DElement tidak tersedia');
      const map = new Map3DElement({ center: { lat: TERRAIN.latitude, lng: TERRAIN.longitude, altitude: 60 }, range: 450, tilt: 70, heading: 235, fov: world.camera.fov, mode: 'SATELLITE' });
      map.addEventListener('gmp-error', () => {
        world.googleActive = false; host.classList.add('hidden');
        button.textContent = 'World: Simulator'; button.setAttribute('aria-pressed', 'false');
        document.getElementById('terrain-credit').textContent = 'Google Maps 3D gagal menginisialisasi · Simulator lokal aktif';
      });
      host.replaceChildren(map);
      world.googleMap = map;
      const parts = [world.catchCarriageGroup, world.chopstickLeftPivot, world.chopstickRightPivot, world.qdArmPivot, ...Object.values(world.shipFlaps)];
      parts.forEach((part, i) => { part.name = `google-moving-part-${i}`; });
      for (const source of [world.mechazillaGroup, world.boosterRoot, world.shipRoot, ...parts]) {
        const model = new Model3DElement({ src: await exportMapModel(source, parts), position: geoPosition(source.position), altitudeMode: 'RELATIVE_TO_GROUND', scale: 1 });
        map.append(model); world.googleModels.push({ model, source });
      }
    }
    host.classList.remove('hidden'); world.googleActive = true;
    button.textContent = 'World: Google 3D'; button.setAttribute('aria-pressed', 'true');
    googleCameraState.set(Infinity, Infinity, Infinity);
    document.getElementById('terrain-credit').textContent = 'Google Maps 3D · Starbase · model simulator / terrain live';
  } catch (error) {
    Logger.error(`Google Maps 3D: ${error.message}`);
    button.textContent = 'World: Simulator';
    document.getElementById('map-settings-status').textContent = 'Google Maps 3D gagal dimuat. Simulator lokal tetap tersedia.';
    document.getElementById('map-settings').showModal();
  } finally { world.googleLoading = false; }
}

export function updateGoogleWorld() {
  if (!world.googleActive || !world.googleMap) return;
  for (const { model, source } of world.googleModels) {
    model.position = geoPosition(source.getWorldPosition(new THREE.Vector3()).divideScalar(RENDER_SCALE));
    const euler = new THREE.Euler().setFromQuaternion(source.getWorldQuaternion(new THREE.Quaternion()), 'YXZ');
    model.orientation = { heading: THREE.MathUtils.radToDeg(euler.y), tilt: THREE.MathUtils.radToDeg(euler.x), roll: THREE.MathUtils.radToDeg(euler.z) };
    let visible = true;
    for (let node = source; node; node = node.parent) visible &&= node.visible;
    model.scale = visible ? 1 : 0;
  }
  world.googleMap.fov = world.camera.fov;
  // Follow simulator camera changes; when it is stationary the map can be explored freely.
  if (world.camera.position.distanceToSquared(googleCameraState) > 0.01) {
    const target = world.controls.target, delta = world.camera.position.clone().sub(target);
    world.googleMap.center = geoPosition(target);
    world.googleMap.range = Math.max(120, delta.length());
    world.googleMap.heading = THREE.MathUtils.radToDeg(Math.atan2(-delta.x, delta.z));
    world.googleMap.tilt = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(Math.atan2(Math.hypot(delta.x, delta.z), delta.y)), 0, 85);
    googleCameraState.copy(world.camera.position);
  }
}

window.addEventListener('pagehide', () => { for (const url of googleModelUrls) URL.revokeObjectURL(url); });

// Keep simulation and OrbitControls in SI; convert only at the renderer boundary.
export function renderFlightView(scene, camera, cinematic = false) {
  const renderCam = world.renderCamera;
  renderCam.copy(camera, false);
  renderCam.position.multiplyScalar(RENDER_SCALE);
  renderCam.near *= RENDER_SCALE;
  renderCam.far *= RENDER_SCALE;
  renderCam.updateProjectionMatrix();
  renderCam.updateMatrixWorld();
  if (scene === world.scene) {
    if (world.sky) world.sky.position.copy(camera.position);
    if (world.tiles && cinematic) {
      try {
        scene.updateMatrixWorld(true);
        world.tiles.setResolutionFromRenderer(renderCam, world.renderer);
        world.tiles.update();
      } catch { Logger.error('Pembaruan terrain gagal.'); }
    }
  }
  if (cinematic) {
    const view = camera.userData.viewport;
    const size = view ? new THREE.Vector2(view.width, view.height) : world.renderer.getSize(new THREE.Vector2());
    if (!size.equals(world.renderSize)) {
      world.renderSize.copy(size); world.composer.setSize(size.x, size.y);
    }
    world.renderPass.scene = scene;
    world.renderPass.camera = renderCam;
    world.composer.render();
  } else world.renderer.render(scene, renderCam);
}

export function buildWorld(canvasEl) {
  const renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.autoClear = false;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  world.renderer = renderer;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x38bdf8);
  world.scene = scene;
  scene.scale.setScalar(RENDER_SCALE);

  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.5, 650000);
  camera.position.set(92, 95, 138);
  world.camera = camera;

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxDistance = 3200;
  controls.minDistance = 8;
  world.controls = controls;

  // Dual Live Monitor PiP Cameras
  world.starshipMonitorCam = new THREE.PerspectiveCamera(46, 1.85, 0.5, 400000);
  world.boosterMonitorCam = new THREE.PerspectiveCamera(46, 1.85, 0.5, 250000);

  // Pencahayaan Matahari & Langit
  const sunLight = new THREE.DirectionalLight(0xfffbeb, 2.6);
  sunLight.position.set(420, 680, 360);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  Object.assign(sunLight.shadow.camera, { left: -28, right: 28, top: 28, bottom: -28, near: 0.5, far: 150 });
  sunLight.shadow.normalBias = 0.02;
  sunLight.target.position.set(0, 65, 0);
  scene.add(sunLight.target);
  scene.add(sunLight, new THREE.HemisphereLight(0x93c5fd, 0x1e293b, 0.92));

  world.boosterEngineLight = new THREE.PointLight(0xff8c3b, 0, 260);
  world.shipEngineLight = new THREE.PointLight(0x60a5fa, 0, 220);
  scene.add(world.boosterEngineLight, world.shipEngineLight);

  // Kubah Bintang (muncul otomatis saat mendaki ke stratosfer/luar angkasa)
  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(2400 * 3);
  for (let i = 0; i < 2400; i++) {
    const r = 240000 + Math.random() * 60000;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(Math.random());
    starPos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    starPos[i * 3 + 1] = r * Math.cos(ph);
    starPos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  world.skyStars = new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({ color: 0xf8fafc, size: 750 * RENDER_SCALE, transparent: true, opacity: 0.0 })
  );
  scene.add(world.skyStars);

  // Lautan 3D Berombak Shader GLSL (meluas melewati Pad ASDS 65 km ke Timur)
  const oceanGeo = new THREE.PlaneGeometry(240000, 140000, 128, 72);
  oceanGeo.rotateX(-Math.PI / 2);
  world.oceanMesh = new THREE.Mesh(oceanGeo, createOceanShaderMaterial());
  world.oceanMesh.position.set(60000, -1.2, 0);
  scene.add(world.oceanMesh);
  world.localTerrain = buildLocalTerrain();
  scene.add(world.localTerrain);
  world.sky = new Sky();
  world.sky.scale.setScalar(450000);
  world.sky.material.depthWrite = false;
  world.sky.material.uniforms.sunPosition.value.set(420, 680, 360);
  world.sky.material.uniforms.turbidity.value = 2.5;
  world.sky.material.uniforms.mieDirectionalG.value = 0.8;
  scene.add(world.sky);

  // Lengkungan Bumi di ketinggian tinggi
  world.curvedEarthMesh = new THREE.Mesh(
    new THREE.SphereGeometry(280000, 64, 48),
    new THREE.MeshStandardMaterial({ color: 0x0b3a6e, roughness: 0.82, metalness: 0.12 })
  );
  world.curvedEarthMesh.position.set(0, -280200, 0);
  scene.add(world.curvedEarthMesh);

  world.atmoHaloMesh = new THREE.Mesh(
    new THREE.SphereGeometry(291000, 48, 32),
    new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.18, side: THREE.BackSide })
  );
  world.atmoHaloMesh.position.copy(world.curvedEarthMesh.position);
  scene.add(world.atmoHaloMesh);

  // Struktur Starbase Mechazilla & Pad Laut ASDS
  world.mechazillaGroup = buildMechazillaAndPad();
  scene.add(world.mechazillaGroup);

  world.asdsGroup = buildASDSDroneShip();
  scene.add(world.asdsGroup);

  // Roket Super Heavy & Starship
  world.boosterRoot = buildSuperHeavyBooster();
  scene.add(world.boosterRoot);

  world.shipRoot = buildStarshipModel(world.shipSLEngines, world.shipVacEngines, true);
  scene.add(world.shipRoot);

  // Pool Partikel
  const softTex = createSoftParticleTexture();
  world.padSmokePool = new ParticlePool(scene, 900, 26.0, false, softTex);
  world.ascentTrailPool = new ParticlePool(scene, 700, 18.0, false, softTex);
  world.oceanSprayPool = new ParticlePool(scene, 500, 14.0, false, softTex);
  world.fireSparkPool = new ParticlePool(scene, 420, 10.0, true, softTex);

  // Bangun Scene Orbit Bumi 360° Fotorealistis
  buildOrbitalScene(softTex);
  world.orbitalScene.scale.setScalar(RENDER_SCALE);
  for (const group of [world.boosterRoot, world.shipRoot, world.mechazillaGroup, world.asdsGroup]) {
    group.traverse(obj => { if (obj.isMesh && !obj.material.transparent) obj.castShadow = obj.receiveShadow = true; });
  }
  world.composer = new EffectComposer(renderer);
  world.renderPass = new RenderPass(scene, world.renderCamera);
  world.composer.addPass(world.renderPass);
  world.composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.28, 0.45, 1.5));
  world.composer.addPass(new OutputPass());
  void attachStarbaseTerrain();
  const asset = name => `${import.meta.env?.BASE_URL ?? './public/'}assets/${name}`;
  const loader = new THREE.TextureLoader();
  for (const [file, uniform] of [['earth.jpg', 'uAlbedo'], ['relief.jpg', 'uBump'], ['water.png', 'uSpec']]) {
    loader.load(asset(file), tex => {
      if (uniform === 'uAlbedo') {
        tex.colorSpace = THREE.SRGBColorSpace;
        world.curvedEarthMesh.material.map = tex;
      }
      world.orbitalEarthMesh.material.uniforms[uniform].value = tex;
    }, undefined, () => console.warn(`Tekstur ${file} tidak tersedia; memakai tekstur prosedural.`));
  }
  new RGBELoader().load(asset('sky.hdr'), hdr => {
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = world.orbitalScene.environment = hdr;
  }, undefined, () => console.warn('HDRI tidak tersedia; memakai pencahayaan lokal.'));

  // Terapkan tekstur satelit Bumi fotorealistis ke lengkungan cakrawala pada scene peluncuran
  if (world.earthTextures) {
    world.curvedEarthMesh.material.map = world.earthTextures.albedo;
    world.curvedEarthMesh.material.color.setHex(0xffffff);
    world.curvedEarthMesh.material.needsUpdate = true;
  }
}

/**
 * Memperbarui sudut gimbal X/Y dan intensitas nyala 33 Mesin Raptor Super Heavy.
 */
export function applyBoosterEngineVisuals(activeCount, throttle, vacFactor) {
  const b = sim.booster;
  const innerActive = Math.min(activeCount, 13);
  const outerActive = Math.max(0, activeCount - 13);

  world.boosterInnerEngines.forEach((eng, i) => {
    const on = i < innerActive && throttle > 0.02;
    eng.pivot.rotation.x = b.gimbalX;
    eng.pivot.rotation.z = b.gimbalY;
    eng.plumeGroup.visible = on;
    if (on) {
      const lenScale = 0.55 + throttle * 0.95;
      const radScale = 0.85 + vacFactor * 0.55;
      eng.plumeGroup.scale.set(radScale, lenScale, radScale);
      eng.materials.forEach(m => { m.uniforms.uVacFactor.value = vacFactor; });
    }
  });

  world.boosterOuterEngines.forEach((eng, i) => {
    const on = i < outerActive && throttle > 0.02;
    eng.plumeGroup.visible = on;
    if (on) {
      const lenScale = 0.55 + throttle * 0.92;
      const radScale = 0.82 + vacFactor * 0.55;
      eng.plumeGroup.scale.set(radScale, lenScale, radScale);
      eng.materials.forEach(m => { m.uniforms.uVacFactor.value = vacFactor; });
    }
  });
  [...world.boosterInnerEngines, ...world.boosterOuterEngines].forEach((eng, i) => {
    eng.pivot.updateMatrix();
    world.boosterBells.setMatrixAt(i, eng.pivot.matrix);
  });
  world.boosterBells.instanceMatrix.needsUpdate = true;
}

/**
 * Memperbarui sudut gimbal X/Y dan intensitas nyala 6 Mesin Raptor Starship (3 SL + 3 Vacuum).
 */
export function applyShipEngineVisuals(
  activeSL,
  activeVac,
  throttle,
  vacFactor,
  slArr = world.shipSLEngines,
  vacArr = world.shipVacEngines
) {
  const s = sim.ship;
  slArr.forEach((eng, i) => {
    const on = i < activeSL && throttle > 0.02;
    eng.pivot.rotation.x = s.gimbalX;
    eng.pivot.rotation.z = s.gimbalY;
    eng.plumeGroup.visible = on;
    if (on) {
      const lenScale = 0.55 + throttle * 0.92;
      const radScale = 0.85 + vacFactor * 0.65;
      eng.plumeGroup.scale.set(radScale, lenScale, radScale);
      eng.materials.forEach(m => { m.uniforms.uVacFactor.value = vacFactor; });
    }
  });

  vacArr.forEach((eng, i) => {
    const on = i < activeVac && throttle > 0.02;
    eng.plumeGroup.visible = on;
    if (on) {
      const lenScale = 0.72 + throttle * 1.05;
      const radScale = 1.0 + vacFactor * 0.85;
      eng.plumeGroup.scale.set(radScale, lenScale, radScale);
      eng.materials.forEach(m => { m.uniforms.uVacFactor.value = vacFactor; });
    }
  });
}

/**
 * Mengatur gradasi warna langit biru -> stratosfer -> hitam luar angkasa berdasarkan ketinggian kamera.
 */
export function applySkyForAltitude(altMeters) {
  if (world.sky) {
    const density = Math.exp(-Math.max(0, altMeters) / 8500);
    world.sky.visible = altMeters < 55000;
    world.sky.material.uniforms.rayleigh.value = 1.5 * density;
    world.sky.material.uniforms.mieCoefficient.value = 0.004 * density;
  }
  const t = THREE.MathUtils.clamp(altMeters / 58000, 0, 1);
  const skyLow = new THREE.Color(0x38bdf8);
  const skyMid = new THREE.Color(0x0c2d5c);
  const skySpace = new THREE.Color(0x020617);
  world.scene.background = t < 0.45
    ? skyLow.clone().lerp(skyMid, t / 0.45)
    : skyMid.clone().lerp(skySpace, (t - 0.45) / 0.55);
  world.skyStars.material.opacity = THREE.MathUtils.clamp((altMeters - 16000) / 36000, 0, 1);
}

/**
 * Menghitung posisi & arah kamera Orbit Bumi anti-bug:
 * selalu berada di luar lintasan orbit menghadap ke dalam melewati Starship ke permukaan Bumi!
 */
export function computeOrbitalCameraFrame(shipPos, angleDeg) {
  const rad = THREE.MathUtils.degToRad(angleDeg);
  const radialOut = shipPos.lengthSq() > 1 ? shipPos.clone().normalize() : world.orbitU.clone();
  const tangent = world.orbitU.clone().multiplyScalar(-Math.sin(rad))
    .addScaledVector(world.orbitV, Math.cos(rad))
    .normalize();

  const camOffset = radialOut.clone().multiplyScalar(86)
    .addScaledVector(tangent, -108)
    .addScaledVector(world.orbitNormal, 42);
  const camPos = shipPos.clone().add(camOffset);
  const lookTarget = shipPos.clone().lerp(new THREE.Vector3(0, 0, 0), 0.14);
  return { camPos, lookTarget };
}

/**
 * Melepaskan 1 unit satelit Starlink dari pintu Pez-Dispenser Starship di orbit Bumi.
 */
export function spawnStarlinkSatellite() {
  if (!world.starlinkPayloadGroup || !world.orbitalShipGroup) return;

  const sat = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(3.8, 0.35, 1.8),
    new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.8, roughness: 0.3 })
  );
  const solar = new THREE.Mesh(
    new THREE.BoxGeometry(7.2, 0.08, 1.6),
    new THREE.MeshStandardMaterial({
      color: 0x1d4ed8,
      metalness: 0.6,
      roughness: 0.25,
      emissive: 0x0c4a6e,
      emissiveIntensity: 0.35
    })
  );
  solar.position.x = 2.8;
  sat.add(body, solar);

  const radialOut = world.orbitalShipGroup.position.clone().normalize();
  const ejectDir = world.orbitNormal.clone().multiplyScalar(0.55)
    .addScaledVector(radialOut, 0.55)
    .normalize();

  sat.position.copy(world.orbitalShipGroup.position).addScaledVector(ejectDir, 4.5);
  sat.quaternion.copy(world.orbitalShipGroup.quaternion);
  sat.userData = {
    vel: ejectDir.multiplyScalar(14 + Math.random() * 5).addScaledVector(world.orbitV, 2.0),
    age: 0
  };

  world.starlinkPayloadGroup.add(sat);
  world.starlinkSats.push(sat);
}

/**
 * Membersihkan seluruh satelit Starlink dari scene orbit saat reset simulasi.
 */
export function clearStarlinkSats() {
  if (!world.starlinkPayloadGroup) return;
  while (world.starlinkPayloadGroup.children.length > 0) {
    world.starlinkPayloadGroup.remove(world.starlinkPayloadGroup.children[0]);
  }
  world.starlinkSats = [];
}
