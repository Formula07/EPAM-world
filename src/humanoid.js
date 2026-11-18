import * as THREE from 'three';
import { EPAM_CYAN, brandTexture } from './branding.js';
import { clamp, pick } from './utils.js';

// Blocky, fully procedural office worker in EPAM-branded formals. Same interface as the GLB Avatar:
// root, play(state), update(dt), punch(), flinch(), setDead(), hold(), carry(), rightHand.

const SKIN = ['#f1c9a5', '#e0ac69', '#c68642', '#8d5524', '#5c3a21', '#ffdbac', '#d1a073'];
const HAIR = ['#1b1b1b', '#3b2a1a', '#6b4423', '#a67b5b', '#d6b370', '#8c8c8c', '#2b1d14'];
const SUITS = ['#1f2a44', '#2b2f36', '#14161a', '#3a4252', '#24324a', '#33363d'];
const SHIRTS = ['#f4f6f8', '#f4f6f8', '#dce9f5', '#eef1f4'];

export function randomOutfit(kind, rnd = Math.random, overrides = {}) {
  const female = rnd() < 0.45;
  const base = { kind, female, skin: pick(rnd, SKIN), hair: pick(rnd, HAIR), longHair: female && rnd() < 0.8 };
  if (kind === 'police') {
    return { ...base, jacket: '#111418', trousers: '#111418', shirt: '#1b2a36', tie: '#111418', cap: true, back: 'POLICE', stripe: EPAM_CYAN, ...overrides };
  }
  const suit = pick(rnd, SUITS);
  return {
    ...base, jacket: suit, trousers: rnd() < 0.7 ? suit : '#2a2d33', shirt: pick(rnd, SHIRTS),
    tie: EPAM_CYAN, back: '', badge: true, ...overrides,
  };
}

const mats = new Map();
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...opts }));
  return mats.get(key);
}
const decalMats = new Map();
function decalMat(tex) {
  if (!decalMats.has(tex.uuid)) decalMats.set(tex.uuid, new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.6 }));
  return decalMats.get(tex.uuid);
}
const geos = new Map();
function boxGeo(w, h, d) {
  const key = `${w}|${h}|${d}`;
  if (!geos.has(key)) geos.set(key, new THREE.BoxGeometry(w, h, d));
  return geos.get(key);
}
const headGeo = new THREE.SphereGeometry(0.115, 16, 12);
const hairGeo = new THREE.SphereGeometry(0.123, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.52);
const capGeo = new THREE.CylinderGeometry(0.126, 0.13, 0.08, 16);
const planeGeo = new THREE.PlaneGeometry(1, 1);

function box(parent, w, h, d, material, x, y, z, shadow = true) {
  const m = new THREE.Mesh(boxGeo(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  parent.add(m);
  return m;
}

function decal(parent, tex, w, h, x, y, z, ry = 0) {
  const m = new THREE.Mesh(planeGeo, decalMat(tex));
  m.scale.set(w, h, 1);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  parent.add(m);
  return m;
}

const HIPS_Y = 0.95;
const POSE_KEYS = ['thighL', 'thighR', 'kneeL', 'kneeR', 'armL', 'armR', 'elbowL', 'elbowR', 'spread', 'lean', 'hipsY'];

export class Humanoid {
  constructor(outfit, def = null) {
    this.def = def;
    this.outfit = outfit;
    this.canSit = true;
    this.root = new THREE.Group();
    this.fall = new THREE.Group();
    this.root.add(this.fall);
    this.hips = new THREE.Group();
    this.hips.position.y = HIPS_Y;
    this.fall.add(this.hips);

    const J = mat(outfit.jacket), T = mat(outfit.trousers), S = mat(outfit.shirt), K = mat(outfit.skin), H = mat(outfit.hair);
    const shoe = mat('#0d0e10', { roughness: 0.4 });
    this.chestW = outfit.female ? 0.38 : 0.42;

    box(this.hips, 0.36, 0.18, 0.21, T, 0, -0.02, 0);
    this.torso = new THREE.Group();
    this.hips.add(this.torso);
    box(this.torso, this.chestW, 0.52, 0.23, J, 0, 0.27, 0);
    box(this.torso, 0.11, 0.26, 0.01, S, 0, 0.38, 0.116, false);
    box(this.torso, 0.045, 0.24, 0.012, mat(outfit.tie), 0, 0.35, 0.123, false);
    if (outfit.stripe) box(this.torso, this.chestW + 0.01, 0.05, 0.235, mat(outfit.stripe, { emissive: outfit.stripe, emissiveIntensity: 0.4 }), 0, 0.17, 0, false);
    if (outfit.badge) decal(this.torso, brandTexture('', { bg: '#ffffff', fg: '#15181d', w: 256, h: 96 }), 0.1, 0.04, 0.11, 0.44, 0.117);
    else decal(this.torso, brandTexture(''), 0.12, 0.035, 0.1, 0.45, 0.117);
    decal(this.torso, brandTexture(outfit.back), outfit.back ? 0.36 : 0.3, 0.1, 0, 0.38, -0.117, Math.PI);

    box(this.torso, 0.09, 0.08, 0.09, K, 0, 0.56, 0);
    this.head = new THREE.Group();
    this.head.position.y = 0.6;
    this.torso.add(this.head);
    const skull = new THREE.Mesh(headGeo, K);
    skull.scale.set(1, 1.12, 1);
    skull.position.y = 0.13;
    skull.castShadow = true;
    this.head.add(skull);
    const eye = mat('#16181b');
    box(this.head, 0.025, 0.025, 0.01, eye, 0.04, 0.15, 0.112, false);
    box(this.head, 0.025, 0.025, 0.01, eye, -0.04, 0.15, 0.112, false);
    if (outfit.cap) {
      const cap = new THREE.Mesh(capGeo, mat('#0e1013'));
      cap.position.y = 0.245;
      this.head.add(cap);
      box(this.head, 0.2, 0.015, 0.1, mat('#0e1013'), 0, 0.215, 0.1, false);
      box(this.head, 0.255, 0.025, 0.255, mat(EPAM_CYAN), 0, 0.225, 0, false);
    } else {
      const hair = new THREE.Mesh(hairGeo, H);
      hair.position.set(0, 0.145, -0.008);
      this.head.add(hair);
      if (outfit.longHair) box(this.head, 0.22, 0.24, 0.07, H, 0, 0.07, -0.08);
    }

    this.arms = [this.buildArm(1, J, S, K), this.buildArm(-1, J, S, K)];   // [left (+x), right (-x)]
    this.legs = [this.buildLeg(1, T, shoe), this.buildLeg(-1, T, shoe)];
    this.leftHand = this.arms[0].hand;
    this.rightHand = this.arms[1].hand;

    this.state = 'idle';
    this.speed = 0;
    this.phase = Math.random() * 10;
    this.pose = Object.fromEntries(POSE_KEYS.map(k => [k, 0]));
    this.pose.hipsY = HIPS_Y;
    this.target = { ...this.pose };
    this.attackT = null;
    this.flinchT = 0;
    this.dead = false;
    this.fallT = 0;
    this.held = null;
    this.carried = null;
  }

  buildArm(side, J, S, K) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * (this.chestW / 2 + 0.06), 0.48, 0);
    this.torso.add(shoulder);
    box(shoulder, 0.11, 0.31, 0.12, J, 0, -0.15, 0);
    const elbow = new THREE.Group();
    elbow.position.y = -0.3;
    shoulder.add(elbow);
    box(elbow, 0.1, 0.26, 0.105, J, 0, -0.13, 0);
    box(elbow, 0.095, 0.03, 0.1, S, 0, -0.265, 0, false);
    const hand = new THREE.Group();
    hand.position.y = -0.29;
    elbow.add(hand);
    box(hand, 0.08, 0.1, 0.06, K, 0, -0.03, 0);
    return { shoulder, elbow, hand, side };
  }

  buildLeg(side, T, shoe) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.095, -0.07, 0);
    this.hips.add(hip);
    box(hip, 0.15, 0.44, 0.16, T, 0, -0.21, 0);
    const knee = new THREE.Group();
    knee.position.y = -0.43;
    hip.add(knee);
    box(knee, 0.13, 0.42, 0.14, T, 0, -0.2, 0);
    box(knee, 0.12, 0.07, 0.26, shoe, 0, -0.415, 0.045);
    return { hip, knee };
  }

  play(state) { this.state = state; }
  setSpeed(v) { this.speed = v; }
  flinch() { this.flinchT = 0.3; }
  setDead(dead) { this.dead = dead; }

  punch(withWeapon = false) {
    this.attackT = 0;
    this.attackDur = withWeapon ? 0.45 : 0.3;
    this.attackWeapon = withWeapon;
  }

  // weapon in the right hand; mesh is a flat laptop with its long side along X
  hold(mesh) {
    if (this.held) this.rightHand.remove(this.held);
    this.held = mesh;
    if (!mesh) return;
    mesh.position.set(0, -0.2, 0.02);
    mesh.rotation.set(0, Math.PI / 2, Math.PI / 2);
    this.rightHand.add(mesh);
  }

  // laptop tucked under the left forearm (NPC carriers)
  carry(mesh) {
    if (this.carried) this.arms[0].elbow.remove(this.carried);
    this.carried = mesh;
    if (!mesh) return;
    mesh.position.set(-0.08, -0.15, 0.02);
    mesh.rotation.set(0, Math.PI / 2, Math.PI / 2);
    this.arms[0].elbow.add(mesh);
  }

  update(dt) {
    const s = this.state;
    const t = this.target;
    const moving = s === 'walk' || s === 'run';
    const speed = this.speed || (s === 'run' ? 7 : s === 'walk' ? 2.5 : 0);

    t.thighL = t.thighR = t.kneeL = t.kneeR = t.armL = t.armR = t.lean = 0;
    t.elbowL = t.elbowR = -0.15;
    t.spread = 0.06;
    t.hipsY = HIPS_Y;

    if (moving) {
      this.phase += dt * clamp(speed * 2.4, 5, 18);
      const a = clamp(speed * 0.14, 0.3, 0.95);
      const sn = Math.sin(this.phase), cs = Math.cos(this.phase);
      t.thighL = -sn * a; t.thighR = sn * a;
      t.kneeL = Math.max(0, cs) * a * 1.3 + 0.05;
      t.kneeR = Math.max(0, -cs) * a * 1.3 + 0.05;
      t.armL = sn * a * 0.8; t.armR = -sn * a * 0.8;
      t.elbowL = t.elbowR = -(0.25 + a * 0.8);
      t.lean = s === 'run' ? 0.18 : 0.04;
      t.hipsY = HIPS_Y - a * 0.03 + Math.abs(cs) * a * 0.04;
    } else if (s === 'jump') {
      t.thighL = -0.7; t.thighR = -0.2; t.kneeL = 1.1; t.kneeR = 0.5;
      t.armL = t.armR = -0.5; t.elbowL = t.elbowR = -0.6;
    } else if (s === 'sit') {
      t.thighL = t.thighR = -1.45; t.kneeL = t.kneeR = 1.35;
      t.armL = t.armR = -1.0; t.elbowL = t.elbowR = -0.3;
      t.hipsY = 0.62; t.lean = 0.15;
    } else {
      this.phase += dt * 1.8;
      t.lean = 0.015 * Math.sin(this.phase);
    }
    if (this.carried) { t.armL = -0.35; t.elbowL = -1.45; }
    if (this.held && s !== 'sit') { t.armR = Math.min(t.armR, -0.25); t.elbowR = -0.9; }
    if (this.dead) { t.armL = t.armR = -0.2; t.spread = 0.9; t.thighL = t.thighR = 0; t.kneeL = t.kneeR = 0.1; }
    if (this.flinchT > 0) {
      this.flinchT -= dt;
      t.lean -= 0.5 * Math.sin(Math.PI * clamp(this.flinchT / 0.3, 0, 1));
    }

    const k = 1 - Math.exp(-14 * dt);
    for (const key of POSE_KEYS) this.pose[key] += (t[key] - this.pose[key]) * k;
    const p = this.pose;

    const [L, R] = this.legs;
    L.hip.rotation.x = p.thighL; R.hip.rotation.x = p.thighR;
    L.knee.rotation.x = p.kneeL; R.knee.rotation.x = p.kneeR;
    const [AL, AR] = this.arms;
    AL.shoulder.rotation.x = p.armL; AL.elbow.rotation.x = p.elbowL; AL.shoulder.rotation.z = p.spread;
    AR.shoulder.rotation.x = p.armR; AR.elbow.rotation.x = p.elbowR; AR.shoulder.rotation.z = -p.spread;
    this.torso.rotation.set(p.lean, 0, 0);
    this.hips.position.y = p.hipsY;

    if (this.attackT !== null) {
      this.attackT += dt;
      const u = this.attackT / this.attackDur;
      if (u >= 1) {
        this.attackT = null;
      } else if (this.attackWeapon) {
        // overhead slam: wind up, strike down, recover
        const arm = u < 0.4 ? THREE.MathUtils.lerp(p.armR, -2.7, u / 0.4)
          : u < 0.6 ? THREE.MathUtils.lerp(-2.7, -0.7, (u - 0.4) / 0.2)
            : THREE.MathUtils.lerp(-0.7, p.armR, (u - 0.6) / 0.4);
        AR.shoulder.rotation.x = arm;
        AR.elbow.rotation.x = -0.35;
        this.torso.rotation.y = 0.25 * Math.sin(Math.PI * u);
      } else {
        const e = Math.sin(Math.PI * u);
        AR.shoulder.rotation.x = p.armR + (-1.55 - p.armR) * e;
        AR.elbow.rotation.x = p.elbowR + (-0.05 - p.elbowR) * e;
        AR.shoulder.rotation.z = -0.06 + 0.25 * e;
        this.torso.rotation.y = 0.35 * e;
      }
    }

    this.fallT += ((this.dead ? 1 : 0) - this.fallT) * (1 - Math.exp(-7 * dt));
    this.fall.rotation.x = -Math.PI / 2 * this.fallT;
    this.fall.position.y = 0.12 * this.fallT;
  }
}
