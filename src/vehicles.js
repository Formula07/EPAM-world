import * as THREE from 'three';
import { EPAM_CYAN, brandTexture } from './branding.js';
import { clamp, dist2d, pick } from './utils.js';

// Arcade vehicle handling. Speeds in m/s, turn in rad/s at full lock. Models face +Z.
export const VEHICLE_TYPES = {
  cab: { id: 'cab', name: 'EPAM Cab', length: 4.5, width: 1.95, maxSpeed: 30, accel: 13, reverse: 9, turn: 2.1, health: 220, mass: 1, camDistance: 7.5 },
  sedan: { id: 'sedan', name: 'EPAM Fleet Sedan', length: 4.4, width: 1.9, maxSpeed: 32, accel: 14, reverse: 9, turn: 2.2, health: 220, mass: 1, camDistance: 7.5 },
  bike: { id: 'bike', name: 'EPAM Bike', length: 2.1, width: 0.8, maxSpeed: 38, accel: 18, reverse: 5, turn: 2.9, health: 120, mass: 0.4, camDistance: 5.5, seated: true },
  tank: { id: 'tank', name: 'EPAM Security Tank', length: 6.6, width: 3.3, maxSpeed: 13, accel: 6, reverse: 6, turn: 1.25, health: 2000, mass: 8, camDistance: 12, cannon: true, pivot: true, heavy: true },
  police: { id: 'police', name: 'EPAM Police Cruiser', length: 4.7, width: 2.0, maxSpeed: 35, accel: 16, reverse: 10, turn: 2.3, health: 280, mass: 1.2, camDistance: 7.5, siren: true },
};

const SEDAN_COLORS = ['#e9ecef', '#2b2f36', '#1f2a44', '#8d99a6', '#5d6b7a'];

const mats = new Map();
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.5, ...opts }));
  return mats.get(key);
}
const geos = new Map();
function boxGeo(w, h, d) {
  const key = `${w}|${h}|${d}`;
  if (!geos.has(key)) geos.set(key, new THREE.BoxGeometry(w, h, d));
  return geos.get(key);
}
const decalMats = new Map();
function decalMat(tex, lit) {
  const key = tex.uuid + lit;
  if (!decalMats.has(key)) {
    decalMats.set(key, lit ? new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false })
      : new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.4 }));
  }
  return decalMats.get(key);
}
const planeGeo = new THREE.PlaneGeometry(1, 1);
const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 16).rotateZ(Math.PI / 2);
const bikeWheelGeo = new THREE.CylinderGeometry(0.33, 0.33, 0.12, 16).rotateZ(Math.PI / 2);
const hubGeo = new THREE.BoxGeometry(0.28, 0.12, 0.12);
const barrelGeo = new THREE.CylinderGeometry(0.12, 0.14, 3.4, 12).rotateX(Math.PI / 2);
const charred = new THREE.MeshStandardMaterial({ color: '#1c1b1a', roughness: 1 });

function part(parent, w, h, d, material, x, y, z, shadow = true) {
  const m = new THREE.Mesh(boxGeo(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function decal(parent, tex, w, h, x, y, z, ry, lit = false) {
  const m = new THREE.Mesh(planeGeo, decalMat(tex, lit));
  m.scale.set(w, h, 1);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  parent.add(m);
  return m;
}

function addWheel(model, geo, r, x, y, z, front) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  const spin = new THREE.Group();
  const tyre = new THREE.Mesh(geo, mat('#111317', { roughness: 0.9 }));
  tyre.castShadow = true;
  const hub = new THREE.Mesh(hubGeo, mat('#9aa1a9', { metalness: 0.7, roughness: 0.3 }));
  hub.scale.x = geo === bikeWheelGeo ? 0.5 : 1;
  spin.add(tyre, hub);
  pivot.add(spin);
  model.body.add(pivot);
  model.wheels.push({ pivot, spin, front, r });
}

function newModel() {
  const group = new THREE.Group();
  const body = new THREE.Group();   // tilts for bike leaning
  group.add(body);
  return { group, body, wheels: [], lights: null, turret: null, muzzle: null };
}

function buildCar(type, { paint, stripe, door, roofSign, lightbar }) {
  const model = newModel();
  const g = model.body;
  const L = type.length, W = type.width;
  const P = mat(paint, { metalness: 0.45, roughness: 0.35 });
  const dark = mat('#15171a', { roughness: 0.6 });
  part(g, W, 0.55, L, P, 0, 0.62, 0);
  part(g, W * 0.98, 0.12, L * 0.3, P, 0, 0.95, L * 0.34);           // hood
  part(g, W * 1.01, 0.18, 0.2, dark, 0, 0.45, L / 2 - 0.05);
  part(g, W * 1.01, 0.18, 0.2, dark, 0, 0.45, -L / 2 + 0.05);
  part(g, W * 0.6, 0.18, 0.03, dark, 0, 0.7, L / 2 + 0.01, false);   // grille
  part(g, W * 0.86, 0.5, L * 0.48, mat('#1a222b', { metalness: 0.6, roughness: 0.1 }), 0, 1.13, -L * 0.05);
  part(g, W * 0.88, 0.07, L * 0.46, P, 0, 1.41, -L * 0.05);
  if (stripe) part(g, W * 1.005, 0.12, L * 0.98, mat(stripe), 0, 0.74, 0, false);
  for (const sx of [-1, 1]) {
    part(g, 0.35, 0.12, 0.05, mat('#ffffff', { emissive: '#fff6d8', emissiveIntensity: 1.2 }), sx * W * 0.33, 0.72, L / 2 + 0.01, false);
    part(g, 0.35, 0.12, 0.05, mat('#a01010', { emissive: '#ff2020', emissiveIntensity: 0.8 }), sx * W * 0.33, 0.72, -L / 2 - 0.01, false);
    decal(g, door, L * 0.42, L * 0.105, sx * (W / 2 + 0.01), 0.64, -0.05, sx * Math.PI / 2);
    for (const sz of [1, -1]) addWheel(model, wheelGeo, 0.36, sx * (W / 2 - 0.12), 0.36, sz * L * 0.32, sz > 0);
  }
  if (roofSign) {
    const sign = new THREE.Group();
    sign.position.set(0, 1.58, -L * 0.05);
    part(sign, 0.9, 0.26, 0.28, mat('#15181d'), 0, 0, 0);
    decal(sign, roofSign, 0.88, 0.22, 0, 0, 0.141, 0, true);
    decal(sign, roofSign, 0.88, 0.22, 0, 0, -0.141, Math.PI, true);
    g.add(sign);
  }
  if (lightbar) {
    const red = new THREE.MeshStandardMaterial({ color: '#ff2a2a', emissive: '#ff2a2a', emissiveIntensity: 2 });
    const blue = new THREE.MeshStandardMaterial({ color: '#2a6bff', emissive: '#2a6bff', emissiveIntensity: 2 });
    part(g, 0.55, 0.14, 0.26, red, 0.3, 1.52, -L * 0.05, false);
    part(g, 0.55, 0.14, 0.26, blue, -0.3, 1.52, -L * 0.05, false);
    model.lights = [red, blue];
  }
  return model;
}

function buildBike(type, { paint }) {
  const model = newModel();
  const g = model.body;
  const P = mat(paint, { metalness: 0.5, roughness: 0.3 });
  const dark = mat('#15171a', { roughness: 0.6 });
  const chrome = mat('#b9c0c8', { metalness: 0.8, roughness: 0.25 });
  part(g, 0.2, 0.3, 1.25, dark, 0, 0.55, -0.02);
  part(g, 0.34, 0.24, 0.55, P, 0, 0.86, 0.22);
  part(g, 0.3, 0.09, 0.6, dark, 0, 0.84, -0.3);
  part(g, 0.26, 0.2, 0.4, P, 0, 0.7, -0.75);
  const fork = part(g, 0.07, 0.65, 0.07, chrome, 0, 0.66, 0.7);
  fork.rotation.x = -0.35;
  part(g, 0.72, 0.04, 0.04, chrome, 0, 1.06, 0.6);
  part(g, 0.16, 0.12, 0.06, mat('#ffffff', { emissive: '#fff6d8', emissiveIntensity: 1.2 }), 0, 0.95, 0.78, false);
  const tex = brandTexture('', { bg: paint === EPAM_CYAN ? '#15181d' : null });
  for (const sx of [-1, 1]) decal(g, tex, 0.48, 0.12, sx * 0.171, 0.88, 0.22, sx * Math.PI / 2);
  addWheel(model, bikeWheelGeo, 0.33, 0, 0.33, 0.78, true);
  addWheel(model, bikeWheelGeo, 0.33, 0, 0.33, -0.72, false);
  return model;
}

function buildTank(type) {
  const model = newModel();
  const g = model.body;
  const L = type.length, W = type.width;
  const armour = mat('#2f3a33', { roughness: 0.8, metalness: 0.3 });
  const track = mat('#151617', { roughness: 0.95 });
  part(g, W * 0.76, 0.8, L * 0.9, armour, 0, 0.95, 0);
  const glacis = part(g, W * 0.76, 0.12, 1.2, armour, 0, 1.1, L * 0.47);
  glacis.rotation.x = 0.5;
  for (const sx of [-1, 1]) {
    part(g, 0.72, 0.9, L, track, sx * (W / 2 - 0.36), 0.48, 0);
    decal(g, brandTexture('SECURITY', { bg: '#15181d' }), L * 0.55, L * 0.07, sx * (W * 0.38 + 0.01), 1.0, 0, sx * Math.PI / 2);
    for (let i = 0; i < 5; i++) addWheel(model, wheelGeo, 0.36, sx * (W / 2 + 0.01), 0.42, -L * 0.38 + i * L * 0.19, false);
  }
  const turret = new THREE.Group();
  turret.position.set(0, 1.35, -0.3);
  part(turret, 2.0, 0.7, 2.6, armour, 0, 0.35, 0);
  part(turret, 0.7, 0.18, 0.7, armour, 0.4, 0.79, -0.4);
  for (const sx of [-1, 1]) decal(turret, brandTexture(''), 1.6, 0.4, sx * 1.005, 0.35, 0, sx * Math.PI / 2);
  part(turret, 2.02, 0.08, 2.62, mat(EPAM_CYAN, { emissive: EPAM_CYAN, emissiveIntensity: 0.3 }), 0, 0.12, 0, false);
  const barrel = new THREE.Mesh(barrelGeo, armour);
  barrel.position.set(0, 0.4, 1.3 + 1.7);
  barrel.castShadow = true;
  turret.add(barrel);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.4, 1.3 + 3.5);
  turret.add(muzzle);
  g.add(turret);
  model.turret = turret;
  model.muzzle = muzzle;
  return model;
}

const BUILDERS = {
  cab: t => buildCar(t, { paint: EPAM_CYAN, stripe: '#15181d', door: brandTexture('CAB', { bg: '#15181d' }), roofSign: brandTexture('CAB', { bg: '#15181d' }) }),
  sedan: t => buildCar(t, { paint: pick(Math.random, SEDAN_COLORS), door: brandTexture('FLEET', { bg: '#15181d' }) }),
  police: t => buildCar(t, { paint: '#121417', stripe: EPAM_CYAN, door: brandTexture('POLICE', { bg: '#121417' }), lightbar: true }),
  bike: t => buildBike(t, { paint: Math.random() < 0.5 ? EPAM_CYAN : '#1d2026' }),
  tank: t => buildTank(t),
};

const IDLE_CONTROLS = { throttle: 0, steer: 0, brake: true };
const _sphere = new THREE.Sphere(new THREE.Vector3(), 1);

export class Vehicle {
  constructor(typeId, x, z, heading) {
    const type = this.type = VEHICLE_TYPES[typeId];
    this.model = BUILDERS[typeId](type);
    this.root = this.model.group;
    this.root.position.set(x, 0, z);
    this.heading = heading;
    this.fx = Math.sin(heading);
    this.fz = Math.cos(heading);
    this.speed = 0;
    this.steer = 0;
    this.lean = 0;
    this.health = type.health;
    this.controls = { throttle: 0, steer: 0, brake: false };
    this.driver = null;           // null | 'player' | 'ai'
    this.wrecked = false;
    this.radius = Math.hypot(type.length, type.width) / 2;
    this.sphereR = type.width / 2;
    const n = Math.max(2, Math.ceil((type.length - type.width) / (type.width * 0.8)) + 1);
    const span = type.length - 2 * this.sphereR;
    this.offsets = Array.from({ length: n }, (_, i) => -span / 2 + (i * span) / (n - 1));
    this.time = Math.random() * 10;
    this.turretYaw = 0;
    this.reload = 0;
    this.smokeTimer = 0;
    this.sync();
  }

  get pos() { return this.root.position; }

  update(dt, octree) {
    this.time += dt;
    const t = this.type;
    const c = this.wrecked || !this.driver ? IDLE_CONTROLS : this.controls;
    if (c.throttle > 0) this.speed += (this.speed < 0 ? t.accel * 2.5 : t.accel) * c.throttle * dt;
    else if (c.throttle < 0) this.speed += (this.speed > 0 ? t.accel * 2.5 : t.accel * 0.7) * c.throttle * dt;
    else this.speed *= Math.exp(-(t.heavy ? 2.5 : 0.7) * dt);
    if (c.brake) this.speed *= Math.exp(-3.5 * dt);
    this.speed = clamp(this.speed, -t.reverse, t.maxSpeed);
    if (Math.abs(this.speed) < 0.05 && !c.throttle) this.speed = 0;

    this.steer += (c.steer - this.steer) * (1 - Math.exp(-8 * dt));
    const grip = t.pivot
      ? (Math.abs(this.speed) < 1 ? 1 : Math.sign(this.speed))
      : clamp(this.speed / 5, -1, 1) * (1 - 0.35 * clamp(Math.abs(this.speed) / t.maxSpeed, 0, 1));
    this.heading += this.steer * t.turn * grip * dt * (c.brake && this.driver ? 1.4 : 1);
    this.fx = Math.sin(this.heading);
    this.fz = Math.cos(this.heading);
    this.pos.x += this.fx * this.speed * dt;
    this.pos.z += this.fz * this.speed * dt;
    this.collideWorld(octree);

    for (const w of this.model.wheels) {
      w.spin.rotation.x += (this.speed / w.r) * dt;
      if (w.front) w.pivot.rotation.y = this.steer * 0.45;
    }
    if (t.seated) {
      const lean = -this.steer * clamp(Math.abs(this.speed) / 15, 0, 1) * 0.35;
      this.lean += (lean - this.lean) * (1 - Math.exp(-6 * dt));
    }
    if (this.model.lights) {
      const on = this.sirenOn && !this.wrecked ? Math.floor(this.time * 6) % 2 : -1;
      this.model.lights[0].emissiveIntensity = on === 1 ? 3 : 0.15;
      this.model.lights[1].emissiveIntensity = on === 0 ? 3 : 0.15;
    }
    if (this.model.turret) {
      const diff = Math.atan2(Math.sin(this.turretYaw - this.model.turret.rotation.y), Math.cos(this.turretYaw - this.model.turret.rotation.y));
      this.model.turret.rotation.y += clamp(diff, -1.6 * dt, 1.6 * dt);
    }
    this.reload -= dt;
    this.sync();
  }

  collideWorld(octree) {
    _sphere.radius = this.sphereR;
    let impact = 0;
    for (const o of this.offsets) {
      _sphere.center.set(this.pos.x + this.fx * o, this.sphereR + 0.2, this.pos.z + this.fz * o);
      const hit = octree.sphereIntersect(_sphere);
      if (!hit) continue;
      const len = Math.hypot(hit.normal.x, hit.normal.z);
      if (len < 0.3) continue;   // slopes and tops of things: ignore, vehicles only collide with walls
      const px = hit.normal.x / len, pz = hit.normal.z / len;
      this.pos.x += px * hit.depth;
      this.pos.z += pz * hit.depth;
      const along = this.fx * px + this.fz * pz;
      const vn = along * this.speed;
      if (vn < 0) {
        impact = Math.max(impact, -vn);
        const headOn = Math.abs(along);
        this.speed *= headOn > 0.7 ? -0.25 : 1 - headOn * 0.8;
      }
    }
    if (impact > 6) {
      this.damage(impact * (this.type.heavy ? 0.3 : 3));
      this.onCrash?.(this, impact);
    }
  }

  sync() {
    this.root.position.y = 0;
    this.root.rotation.set(0, this.heading, 0);
    this.model.body.rotation.z = this.lean;
  }

  damage(amount) {
    if (this.wrecked || this.invincible) return;
    this.health -= amount;
    if (this.health <= 0) this.wreck();
  }

  wreck() {
    this.health = 0;
    this.wrecked = true;
    this.sirenOn = false;
    this.speed *= 0.3;
    this.root.traverse(o => { if (o.isMesh) o.material = charred; });
    this.onWreck?.(this);
  }

  // Coordinates of (x, z) in the vehicle frame: along = forward, lateral = toward the vehicle's left (+X at heading 0).
  toLocal(x, z) {
    const dx = x - this.pos.x, dz = z - this.pos.z;
    return { along: dx * this.fx + dz * this.fz, lateral: dx * this.fz - dz * this.fx };
  }

  toWorld(along, lateral) {
    return { x: this.pos.x + this.fx * along + this.fz * lateral, z: this.pos.z + this.fz * along - this.fx * lateral };
  }

  // Distance from (x, z) to the edge of the vehicle footprint (0 if inside).
  distanceTo(x, z) {
    const { along, lateral } = this.toLocal(x, z);
    return Math.hypot(Math.max(Math.abs(along) - this.type.length / 2, 0), Math.max(Math.abs(lateral) - this.type.width / 2, 0));
  }

  // If a circle of radius pad at (x, z) overlaps the footprint, the {dx, dz} that pushes it out.
  pushOut(x, z, pad) {
    const { along, lateral } = this.toLocal(x, z);
    const pa = this.type.length / 2 + pad - Math.abs(along);
    const pl = this.type.width / 2 + pad - Math.abs(lateral);
    if (pa <= 0 || pl <= 0) return null;
    const out = pl < pa
      ? this.toWorld(along, lateral + Math.sign(lateral || 1) * pl)
      : this.toWorld(along + Math.sign(along || 1) * pa, lateral);
    return { dx: out.x - x, dz: out.z - z };
  }

  exitSpots() {
    const { length: L, width: W } = this.type;
    return [
      this.toWorld(0.3, W / 2 + 0.7), this.toWorld(0.3, -W / 2 - 0.7),
      this.toWorld(-L / 2 - 0.9, 0), this.toWorld(L / 2 + 0.9, 0),
    ];
  }
}

export class VehicleManager {
  constructor(game) {
    this.game = game;
    this.list = [];
  }

  spawn(typeId, x, z, heading) {
    const v = new Vehicle(typeId, x, z, heading);
    v.onWreck = () => this.game.onVehicleWrecked(v);
    v.onCrash = (veh, impact) => this.game.onVehicleCrash(veh, impact);
    this.game.scene.add(v.root);
    this.list.push(v);
    return v;
  }

  remove(v) {
    this.game.scene.remove(v.root);
    const i = this.list.indexOf(v);
    if (i >= 0) this.list.splice(i, 1);
  }

  update(dt) {
    const { octree } = this.game.world;
    for (const v of this.list) {
      v.update(dt, octree);
      if (v.health < v.type.health * 0.3 || v.wrecked) {
        v.smokeTimer -= dt;
        if (v.smokeTimer <= 0) {
          v.smokeTimer = v.wrecked ? 0.25 : 0.4;
          const front = v.toWorld(v.type.length * 0.3, 0);
          this.game.effects.smoke(new THREE.Vector3(front.x, 1.3, front.z), 0.4, 1.8);
        }
      }
    }
    this.collidePairs();
  }

  collidePairs() {
    const list = this.list;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (dist2d(a.pos, b.pos) > a.radius + b.radius) continue;
        if (!a.speed && !b.speed) continue;
        let impact = 0;
        for (const oa of a.offsets) {
          for (const ob of b.offsets) {
            const ax = a.pos.x + a.fx * oa, az = a.pos.z + a.fz * oa;
            const bx = b.pos.x + b.fx * ob, bz = b.pos.z + b.fz * ob;
            const dx = bx - ax, dz = bz - az;
            const d = Math.hypot(dx, dz);
            const min = a.sphereR + b.sphereR;
            if (d >= min || d < 1e-4) continue;
            const nx = dx / d, nz = dz / d, overlap = min - d;
            const ma = a.type.mass, mb = b.type.mass;
            const wa = mb / (ma + mb), wb = ma / (ma + mb);
            a.pos.x -= nx * overlap * wa; a.pos.z -= nz * overlap * wa;
            b.pos.x += nx * overlap * wb; b.pos.z += nz * overlap * wb;
            const closing = a.speed * (a.fx * nx + a.fz * nz) - b.speed * (b.fx * nx + b.fz * nz);
            if (closing > 0) {
              impact = Math.max(impact, closing);
              a.speed *= 1 - 0.5 * wa;
              b.speed *= 1 - 0.5 * wb;
            }
          }
        }
        if (impact > 5) {
          a.damage(impact * 2.5 * b.type.mass / a.type.mass);
          b.damage(impact * 2.5 * a.type.mass / b.type.mass);
          this.game.onVehicleCrash(a, impact);
        }
        a.sync(); b.sync();
      }
    }
  }

  nearestEnterable(x, z, maxDist = 2.6) {
    let best = null, bestD = maxDist;
    for (const v of this.list) {
      if (v.wrecked || v.driver) continue;
      const d = v.distanceTo(x, z);
      if (d < bestD) { best = v; bestD = d; }
    }
    return best;
  }
}
