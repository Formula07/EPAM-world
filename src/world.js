import * as THREE from 'three';
import { Octree } from 'three/addons/math/Octree.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { brandTexture, drawEpamLogo, labelTexture, textTexture } from './branding.js';
import { mulberry32 } from './utils.js';

const WORLD_HALF = 115;

// Office blocks around a central plaza. HQ sits at the north end of the plaza.
const BUILDINGS = [
  { name: 'EPAM HQ', x: 0, z: -55, w: 34, d: 24, h: 64, seed: 1, hq: true },
  { name: 'EPAM Delivery Center', x: -52, z: -30, w: 26, d: 30, h: 36, seed: 2 },
  { name: 'EPAM Labs', x: 52, z: -30, w: 28, d: 26, h: 44, seed: 3 },
  { name: 'EPAM Security HQ', x: -55, z: 38, w: 30, d: 22, h: 20, seed: 4, police: true },
  { name: 'EPAM Continuum', x: 55, z: 40, w: 24, d: 30, h: 26, seed: 5 },
  { name: 'EPAM Wellness Center', x: 0, z: 70, w: 40, d: 18, h: 14, seed: 6, clinic: true },
  { name: 'EPAM Anywhere', x: -85, z: -80, w: 20, d: 20, h: 50, seed: 7 },
  { name: 'EPAM Tower East', x: 85, z: -80, w: 22, d: 18, h: 56, seed: 8 },
  { name: 'EPAM Learning Hub', x: -88, z: 2, w: 18, d: 26, h: 30, seed: 9 },
  { name: 'EPAM Data Center', x: 88, z: 0, w: 18, d: 24, h: 34, seed: 10 },
  { name: 'EPAM Startups Hub', x: -80, z: 85, w: 24, d: 16, h: 18, seed: 11 },
  { name: 'EPAM Design Studio', x: 82, z: 85, w: 20, d: 18, h: 22, seed: 12 },
  { name: 'EPAM North Campus', x: 0, z: -98, w: 50, d: 14, h: 24, seed: 13 },
];

const ROADS = [
  { x: 0, z: 22, w: 2 * WORLD_HALF, d: 10 },
  { x: -32, z: -10, w: 8, d: 2 * WORLD_HALF - 20 },
  { x: 32, z: -10, w: 8, d: 2 * WORLD_HALF - 20 },
];

const PLAZA = { x: 0, z: -13, w: 52, d: 54 };

export const SPAWN = { x: 0, z: 12, heading: Math.PI };
const CLINIC_SPAWN = { x: 0, z: 57, heading: Math.PI };
const STATION_SPAWN = { x: -55, z: 53, heading: 0 };

// Footprints (x0, z0, x1, z1) that NPCs should not try to walk into; buildings are added below.
const OBSTACLES = [
  [-20.5, -0.5, -11.5, 8.5],   // terrace
  [-12, 2, -3.5, 6],           // ramp
  [9, 3, 14, 7.8],             // crates
  [-4.5, -38, 4.5, -36],       // monument sign
];

// One tile = 4x4 windows ≈ 12m wide x 12.8m tall (3.2m per floor).
function windowTexture(seed) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const rnd = mulberry32(seed);
  g.fillStyle = '#2a3037';
  g.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      g.fillStyle = rnd() < 0.2 ? '#ffe7a3' : `hsl(${200 + rnd() * 20}, 35%, ${32 + rnd() * 20}%)`;
      g.fillRect(x * 32 + 2, y * 32 + 4, 28, 22);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

class Builder {
  constructor() {
    this.solid = new THREE.Group();   // goes into the collision octree
    this.decor = new THREE.Group();   // visual only
    this.solid.name = 'collision';
    this.mats = new Map();
  }

  mat(color, opts = {}) {
    const key = color + JSON.stringify(opts);
    if (!this.mats.has(key)) this.mats.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...opts }));
    return this.mats.get(key);
  }

  add(geometry, material, { x = 0, y = 0, z = 0, ry = 0, rz = 0, solid = true, shadow = true } = {}) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.rotation.set(0, ry, rz);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    (solid ? this.solid : this.decor).add(mesh);
    return mesh;
  }

  box(w, h, d, color, opts = {}) {
    // y in opts is the base of the box, not its center
    return this.add(new THREE.BoxGeometry(w, h, d), typeof color === 'string' ? this.mat(color) : color,
      { ...opts, y: (opts.y ?? 0) + h / 2 });
  }

  cylinder(r, h, color, opts = {}) {
    return this.add(new THREE.CylinderGeometry(r, r, h, 20), this.mat(color), { ...opts, y: (opts.y ?? 0) + h / 2 });
  }

  // Flat sign facing outward along (nx, nz), centered at (x, y, z).
  sign(map, w, h, x, y, z, nx, nz) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map, transparent: true, toneMapped: false }));
    mesh.position.set(x, y, z);
    mesh.rotation.y = Math.atan2(nx, nz);
    this.decor.add(mesh);
    return mesh;
  }
}

function buildBuilding(b, def) {
  const { x, z, w, d, h, seed } = def;
  const base = windowTexture(seed);
  const side = (len) => {
    const map = base.clone();
    map.repeat.set(len / 12, h / 12.8);
    map.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: 0.08, roughness: 0.35, metalness: 0.25 });
  };
  const roof = b.mat('#3b4047');
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z
  b.add(new THREE.BoxGeometry(w, h, d), [side(d), side(d), roof, roof, side(w), side(w)], { x, z, y: h / 2 });

  // Lobby plinth, glass doors on every side, roof parapet
  b.box(w + 1.2, 4.5, d + 1.2, b.mat('#1e2a33', { roughness: 0.2, metalness: 0.6 }), { x, z });
  const door = b.mat('#7fd3e0', { roughness: 0.1, metalness: 0.4, emissive: '#0d3a42' });
  b.box(6, 3.2, 0.1, door, { x, z: z + d / 2 + 0.65, solid: false, shadow: false });
  b.box(6, 3.2, 0.1, door, { x, z: z - d / 2 - 0.65, solid: false, shadow: false });
  b.box(w + 0.6, 1.2, d + 0.6, roof, { x, z, y: h, solid: false });

  // <epam> sign near the top of every face
  const logo = brandTexture('', { w: 1024, h: 256 });
  for (const [nx, nz, len] of [[0, 1, w], [0, -1, w], [1, 0, d], [-1, 0, d]]) {
    const sw = Math.min(len * 0.75, def.hq ? 26 : 18);
    const sh = sw / 4;
    b.sign(logo, sw, sh, x + nx * (w / 2 + 0.06), h - sh / 2 - 1.2, z + nz * (d / 2 + 0.06), nx, nz);
  }
  // building name above the front lobby doors
  const plaque = Math.min(w * 0.55, 12);
  b.sign(labelTexture(def.name), plaque, plaque / 8, x, 3.95, z + d / 2 + 0.62, 0, 1);

  if (def.hq) {
    // entrance canopy
    b.box(14, 0.4, 5, b.mat('#d9dde2'), { x, z: z + d / 2 + 3, y: 4.6, solid: false });
  }
  if (def.clinic) {
    const cross = textTexture((g, cw, ch) => {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, cw, ch);
      g.fillStyle = '#e03131'; g.fillRect(cw * 0.38, ch * 0.12, cw * 0.24, ch * 0.76); g.fillRect(cw * 0.12, ch * 0.38, cw * 0.76, ch * 0.24);
    }, 128, 128);
    b.sign(cross, 3, 3, x + w / 2 - 4, 7, z + d / 2 + 0.07, 0, 1);
  }
}

function buildGround(b) {
  b.add(new THREE.PlaneGeometry(2 * WORLD_HALF + 10, 2 * WORLD_HALF + 10).rotateX(-Math.PI / 2), b.mat('#5c7d48'), { shadow: false });

  const flat = (r, color, y) => b.add(new THREE.PlaneGeometry(r.w, r.d).rotateX(-Math.PI / 2), b.mat(color),
    { x: r.x, z: r.z, y, solid: false, shadow: false });
  flat(PLAZA, '#a7a69f', 0.02);
  for (const r of ROADS) flat(r, '#2e3135', 0.03);

  // lane dashes on the main avenue
  const dash = b.mat('#e9e4c8');
  for (let x = -WORLD_HALF + 4; x < WORLD_HALF; x += 8) {
    if (Math.abs(Math.abs(x) - 32) < 6) continue;
    b.add(new THREE.PlaneGeometry(3, 0.25).rotateX(-Math.PI / 2), dash, { x, z: 22, y: 0.04, solid: false, shadow: false });
  }

  // perimeter wall keeps players inside the map
  const wall = b.mat('#8d9096');
  const len = 2 * WORLD_HALF;
  b.box(len, 3, 1, wall, { z: -WORLD_HALF });
  b.box(len, 3, 1, wall, { z: WORLD_HALF });
  b.box(1, 3, len, wall, { x: -WORLD_HALF });
  b.box(1, 3, len, wall, { x: WORLD_HALF });
}

function tree(b, x, z) {
  b.cylinder(0.9, 0.6, '#6f6a62', { x, z });
  b.cylinder(0.15, 2.6, '#5a3d27', { x, z, y: 0.6 });
  b.add(new THREE.IcosahedronGeometry(1.7, 1), b.mat('#3f7a3a', { flatShading: true }), { x, z, y: 4, solid: false });
  OBSTACLES.push([x - 1.1, z - 1.1, x + 1.1, z + 1.1]);
}

function lamp(b, x, z) {
  b.cylinder(0.08, 5, '#2b2e33', { x, z });
  b.box(0.9, 0.18, 0.35, b.mat('#f5f1dc', { emissive: '#fff3c4', emissiveIntensity: 0.6 }), { x, z, y: 5, solid: false });
}

function bench(b, x, z, ry) {
  const wood = b.mat('#8a5a33');
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  const seat = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.1, 0.5), wood); seat.position.y = 0.45;
  const back = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.45, 0.08), wood); back.position.set(0, 0.75, -0.22);
  const legs = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.4, 0.4), b.mat('#2b2e33')); legs.position.y = 0.2;
  for (const m of [seat, back, legs]) { m.castShadow = m.receiveShadow = true; g.add(m); }
  b.solid.add(g);
  OBSTACLES.push([x - 1.2, z - 1.2, x + 1.2, z + 1.2]);
}

function buildPlaza(b) {
  // fountain
  const fx = 0, fz = -12;
  b.cylinder(4.5, 0.7, '#c9c6bd', { x: fx, z: fz });
  b.add(new THREE.CylinderGeometry(4.1, 4.1, 0.05, 32), b.mat('#3d8fb0', { roughness: 0.1, metalness: 0.3 }), { x: fx, z: fz, y: 0.72, solid: false, shadow: false });
  b.cylinder(0.6, 2.8, '#c9c6bd', { x: fx, z: fz });
  OBSTACLES.push([fx - 5.2, fz - 5.2, fx + 5.2, fz + 5.2]);

  // HQ monument sign
  b.box(8, 1.8, 1, '#15181d', { x: 0, z: -37 });
  const plate = textTexture((g, w, h) => {
    drawEpamLogo(g, w / 2, h * 0.375, 120);
    g.fillStyle = '#a9b1bd'; g.font = '36px Inter, Arial, sans-serif'; g.textAlign = 'center';
    g.fillText('EPAM SYSTEMS · CAMPUS', w / 2, h * 0.82);
  }, 1024, 256);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(7.6, 1.9), new THREE.MeshBasicMaterial({ map: plate, toneMapped: false }));
  sign.position.set(0, 0.9, -36.49);
  b.decor.add(sign);

  for (let z = -36; z <= 10; z += 9.2) { tree(b, -22, z); tree(b, 22, z); }
  for (let z = -32; z <= 8; z += 10) { lamp(b, -14, z); lamp(b, 14, z); }
  for (const [x, z, ry] of [[-7, -12, Math.PI / 2], [7, -12, -Math.PI / 2], [0, -19, 0], [0, -5, Math.PI]]) bench(b, x, z, ry);

  // terrace + ramp to try slopes and jumping
  b.box(8, 1.6, 8, '#8f8a80', { x: -16, z: 4 });
  const angle = Math.atan2(1.6, 8);
  b.add(new THREE.BoxGeometry(Math.hypot(8, 1.6), 0.3, 3), b.mat('#8f8a80'), { x: -8, y: 0.8 - 0.15 / Math.cos(angle), z: 4, rz: -angle });

  // crates to jump on
  const crate = b.mat('#a07a46');
  b.box(1, 1, 1, crate, { x: 10, z: 4 });
  b.box(1, 1, 1, crate, { x: 11.1, z: 4 });
  b.box(1, 1, 1, crate, { x: 10.55, z: 4, y: 1 });
  b.box(1.4, 1.4, 1.4, crate, { x: 12.6, z: 6.5 });
}

// Where drivable vehicles start out parked. heading: 0 faces +Z, π/2 faces +X.
function parkingSpots() {
  const spots = [];
  const kinds = ['cab', 'sedan', 'cab', 'bike', 'sedan', 'cab', 'sedan'];
  let i = 0;
  for (let x = -100; x <= 100; x += 12) {
    if (Math.abs(Math.abs(x) - 32) < 8 || Math.abs(x) < 6) continue;
    if (i % 3 !== 2) spots.push({ type: kinds[i % kinds.length], x, z: 18.4, heading: Math.PI / 2 });
    if (i % 2 === 0) spots.push({ type: kinds[(i + 3) % kinds.length], x: x + 5, z: 25.6, heading: -Math.PI / 2 });
    i++;
  }
  for (const z of [-70, -40, 50, 80]) {
    spots.push({ type: 'sedan', x: -29.4, z, heading: 0 });
    spots.push({ type: 'cab', x: 34.6, z: z + 6, heading: Math.PI });
  }
  spots.push(
    { type: 'tank', x: -66, z: 56.5, heading: Math.PI / 2 },
    { type: 'police', x: -46, z: 56, heading: Math.PI / 2 },
    { type: 'police', x: -40, z: 59, heading: -Math.PI / 2 },
    { type: 'bike', x: 7.5, z: -35.5, heading: 0 },
    { type: 'bike', x: 9.2, z: -35.5, heading: 0 },
    { type: 'bike', x: -8, z: 14, heading: Math.PI / 2 },
  );
  return spots;
}

function buildSky(scene) {
  const sky = new Sky();
  sky.scale.setScalar(1000);
  const u = sky.material.uniforms;
  u.turbidity.value = 6;
  u.rayleigh.value = 1.6;
  u.mieCoefficient.value = 0.005;
  u.mieDirectionalG.value = 0.8;
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(55), THREE.MathUtils.degToRad(130));
  u.sunPosition.value.copy(sunDir);
  scene.add(sky);
  return sunDir;
}

export function buildWorld(scene) {
  const b = new Builder();
  buildGround(b);
  for (const def of BUILDINGS) buildBuilding(b, def);
  buildPlaza(b);
  scene.add(b.solid, b.decor);

  const sunDir = buildSky(scene);
  scene.fog = new THREE.Fog('#b9cad6', 140, 520);
  scene.add(new THREE.HemisphereLight('#dfeeff', '#4a5a3a', 1.4));
  const sun = new THREE.DirectionalLight('#fff4e0', 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -50, right: 50, top: 50, bottom: -50, near: 1, far: 300 });
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);

  b.solid.updateMatrixWorld(true);
  const octree = new Octree();
  octree.fromGraphNode(b.solid);

  const followSun = (focus) => {
    sun.position.copy(focus).addScaledVector(sunDir, 120);
    sun.target.position.copy(focus);
    sun.target.updateMatrixWorld();
  };
  followSun(new THREE.Vector3());

  // Navigation helpers for NPCs and police
  const blocked = [
    ...OBSTACLES,
    ...BUILDINGS.map(({ x, z, w, d }) => [x - w / 2 - 2, z - d / 2 - 2, x + w / 2 + 2, z + d / 2 + 2]),
  ];
  const isWalkable = (x, z) => Math.abs(x) < WORLD_HALF - 3 && Math.abs(z) < WORLD_HALF - 3
    && !blocked.some(([x0, z0, x1, z1]) => x > x0 && x < x1 && z > z0 && z < z1);
  const walkPoints = [];
  for (let x = -108; x <= 108; x += 4) {
    for (let z = -108; z <= 108; z += 4) if (isWalkable(x, z)) walkPoints.push({ x, z });
  }
  const roadPoints = [];
  for (let x = -104; x <= 104; x += 8) {
    roadPoints.push({ x, z: 20, heading: Math.PI / 2 }, { x, z: 24, heading: -Math.PI / 2 });
  }
  for (let z = -100; z <= 100; z += 8) {
    if (Math.abs(z - 22) < 8) continue;
    for (const x of [-32, 32]) roadPoints.push({ x: x - 2, z, heading: 0 }, { x: x + 2, z, heading: Math.PI });
  }
  // random point whose distance to `from` is within [minR, maxR]
  const randomPoint = (points, from, minR = 0, maxR = Infinity, rnd = Math.random) => {
    for (let i = 0; i < 40; i++) {
      const p = points[Math.floor(rnd() * points.length)];
      const dd = from ? Math.hypot(p.x - from.x, p.z - from.z) : 0;
      if (!from || (dd >= minR && dd <= maxR)) return p;
    }
    return points[Math.floor(rnd() * points.length)];
  };

  return {
    octree,
    followSun,
    spawn: SPAWN,
    clinic: CLINIC_SPAWN,
    station: STATION_SPAWN,
    parking: parkingSpots(),
    isWalkable,
    randomWalkPoint: (from, minR, maxR, rnd) => randomPoint(walkPoints, from, minR, maxR, rnd),
    randomRoadPoint: (from, minR, maxR, rnd) => randomPoint(roadPoints, from, minR, maxR, rnd),
    laptopSpots: [
      { x: 18, z: -28, type: 'thinkpad' }, { x: -18, z: -28, type: 'macbook' },
      { x: -40, z: 0, type: 'thinkpad' }, { x: 40, z: 5, type: 'macbook' },
      { x: 0, z: 45, type: 'gaming' }, { x: -75, z: 60, type: 'thinkpad' },
      { x: 75, z: 62, type: 'macbook' }, { x: 0, z: -80, type: 'gaming' },
    ],
    coffeeSpots: [{ x: 8, z: 0 }, { x: -60, z: 5 }, { x: 60, z: 0 }, { x: -10, z: 45 }, { x: 40, z: -60 }],
    map: {
      buildings: BUILDINGS.map(({ x, z, w, d, hq, police, clinic }) => ({ x, z, w, d, hq, police, clinic })),
      roads: ROADS,
      plaza: PLAZA,
    },
  };
}
