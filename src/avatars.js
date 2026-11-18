import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { Humanoid, randomOutfit } from './humanoid.js';
import { mulberry32 } from './utils.js';

// Rigged + animated GLBs hosted in the three.js repo. jsDelivr first, raw GitHub as a fallback.
const SOURCES = [
  'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r170/examples/models/gltf',
  'https://raw.githubusercontent.com/mrdoob/three.js/r170/examples/models/gltf',
];

export const AVATAR_HEIGHT = 1.8;

// yawOffset turns each model so that it faces +Z, which is what the player controller assumes.
// Procedural avatars are built in code (humanoid.js) and work offline.
export const AVATARS = [
  { id: 'consultant', name: 'EPAM Consultant', procedural: { seed: 11, female: false, jacket: '#1f2a44', trousers: '#1f2a44', skin: '#e0ac69', hair: '#1b1b1b' },
    blurb: 'Navy EPAM suit, cyan tie, badge on. Built in, works offline.' },
  { id: 'manager', name: 'Delivery Manager', procedural: { seed: 4, female: true, longHair: true, jacket: '#2b2f36', trousers: '#2b2f36', skin: '#c68642', hair: '#3b2a1a' },
    blurb: 'Ships on Friday, every Friday. Built in, works offline.' },
  { id: 'soldier', name: 'The Operative', file: 'Soldier.glb', yawOffset: Math.PI,
    blurb: 'Field consultant. Always on site, always on time.' },
  { id: 'xbot', name: 'X Bot', file: 'Xbot.glb', yawOffset: 0,
    blurb: 'Delivery engineer in matte grey. Full Mixamo skeleton.' },
  { id: 'robot', name: 'Robo Intern', file: 'RobotExpressive/RobotExpressive.glb', yawOffset: 0,
    blurb: 'First week on the job. Has a jump animation and is very proud of it.' },
];

export const FALLBACK_AVATAR = AVATARS[0];

const loader = new GLTFLoader();
const cache = new Map();

function loadGltf(file) {
  if (!cache.has(file)) {
    cache.set(file, (async () => {
      let lastError;
      for (const base of SOURCES) {
        try { return await loader.loadAsync(`${base}/${file}`); } catch (e) { lastError = e; }
      }
      cache.delete(file);
      throw lastError;
    })());
  }
  return cache.get(file);
}

function pick(clips, ...patterns) {
  for (const p of patterns) {
    const clip = clips.find(c => p.test(c.name));
    if (clip) return clip;
  }
  return null;
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _dir = new THREE.Vector3();
const _q = new THREE.Quaternion(), _qw = new THREE.Quaternion(), _qp = new THREE.Quaternion();

// Rotate `bone` (in world space) so the bone -> child direction blends toward `dir` by weight w.
function aimBone(bone, child, dir, w) {
  bone.getWorldPosition(_a);
  child.getWorldPosition(_b);
  _b.sub(_a).normalize();
  _q.setFromUnitVectors(_b, dir);
  _q.slerp(_qw.identity(), 1 - w);
  bone.getWorldQuaternion(_qw);
  bone.parent.getWorldQuaternion(_qp);
  bone.quaternion.copy(_qp.invert().multiply(_q.multiply(_qw)));
  bone.updateMatrixWorld(true);
}

class Avatar {
  // root (moved/rotated by the player) > fall (death tilt) > turn (fixes model facing) > fit (scales to AVATAR_HEIGHT) > model
  constructor(def, model, clips) {
    this.def = def;
    this.root = new THREE.Group();
    this.fall = new THREE.Group();
    const turn = new THREE.Group();
    const fit = new THREE.Group();
    turn.rotation.y = def.yawOffset;
    this.root.add(this.fall);
    this.fall.add(turn);
    turn.add(fit);
    fit.add(model);

    const bones = {};
    model.traverse(o => {
      if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; }
      if (!o.isBone) return;
      if (/RightArm$/i.test(o.name)) bones.arm = o;
      else if (/RightForeArm$/i.test(o.name)) bones.fore = o;
      else if (/(RightHand|Hand\.?R|Palm\d?\.?R)$/i.test(o.name) && !bones.hand) bones.hand = o;
    });
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const scale = AVATAR_HEIGHT / Math.max(box.max.y - box.min.y, 1e-3);
    const center = box.getCenter(new THREE.Vector3());
    fit.scale.setScalar(scale);
    fit.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
    this.root.updateMatrixWorld(true);

    // weapon holder, scaled back to metres so held meshes keep their real size
    this.rightHand = new THREE.Group();
    if (bones.hand) {
      bones.hand.add(this.rightHand);
      this.rightHand.scale.setScalar(1 / bones.hand.getWorldScale(_a).x);
      this.handAxis = 'bone';
    } else {
      this.rightHand.position.set(-0.3, 0.95, 0.15);
      this.root.add(this.rightHand);
      this.handAxis = 'root';
    }
    this.armBones = bones.arm && bones.fore && bones.hand ? bones : null;

    this.mixer = clips.length ? new THREE.AnimationMixer(model) : null;
    this.actions = {};
    const named = {
      idle: pick(clips, /^idle$/i, /idle/i),
      walk: pick(clips, /^walk(ing)?$/i, /walk/i),
      run: pick(clips, /^run(ning)?$/i, /run/i),
      jump: pick(clips, /^jump$/i),
      punch: pick(clips, /^punch$/i),
      death: pick(clips, /^death$/i),
      sit: pick(clips, /^sitting$/i),
    };
    for (const [state, clip] of Object.entries(named)) {
      if (!clip || !this.mixer) continue;
      const action = this.mixer.clipAction(clip);
      if (state === 'jump' || state === 'punch' || state === 'death') { action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; }
      this.actions[state] = action;
    }
    this.canSit = !!this.actions.sit;
    this.current = null;
    this.state = 'idle';
    this.lock = 0;
    this.aimT = null;
    this.dead = false;
    this.fallT = 0;
    this.held = null;
    this.fade('idle');
  }

  fade(state) {
    const action = this.actions[state];
    if (!action || action === this.current) return;
    action.reset().fadeIn(0.2).play();
    this.current?.fadeOut(0.2);
    this.current = action;
  }

  play(state) {
    this.state = state;
    if (this.lock <= 0 && !this.dead) this.fade(state);
  }

  setSpeed() {}
  flinch() {}

  setDead(dead) {
    if (dead === this.dead) return;
    this.dead = dead;
    if (dead && this.actions.death) this.fade('death');
    else if (!dead) { this.lock = 0; this.fade(this.state); }
  }

  punch(withWeapon = false) {
    if (this.actions.punch && !withWeapon) {
      this.fade('punch');
      this.lock = this.actions.punch.getClip().duration * 0.8;
    } else {
      this.aimT = 0;
      this.aimDur = withWeapon ? 0.45 : 0.3;
    }
  }

  hold(mesh) {
    if (this.held) this.rightHand.remove(this.held);
    this.held = mesh;
    if (!mesh) return;
    if (this.handAxis === 'bone') { mesh.position.set(0, 0.2, 0); mesh.rotation.set(0, 0, Math.PI / 2); }
    else { mesh.position.set(0, 0, 0.15); mesh.rotation.set(0, Math.PI / 2, Math.PI / 2); }
    this.rightHand.add(mesh);
  }

  update(dt) {
    this.mixer?.update(dt);
    if (this.lock > 0) {
      this.lock -= dt;
      if (this.lock <= 0 && !this.dead) this.fade(this.state);
    }
    if (this.aimT !== null) {
      this.aimT += dt;
      const u = this.aimT / this.aimDur;
      if (u >= 1) this.aimT = null;
      else if (this.armBones) {
        const w = Math.sin(Math.PI * u);
        this.root.getWorldDirection(_dir);
        _dir.y = -0.1;
        _dir.normalize();
        aimBone(this.armBones.arm, this.armBones.fore, _dir, w);
        aimBone(this.armBones.fore, this.armBones.hand, _dir, w);
      }
    }
    if (!this.actions.death) {
      this.fallT += ((this.dead ? 1 : 0) - this.fallT) * (1 - Math.exp(-7 * dt));
      this.fall.rotation.x = -Math.PI / 2 * this.fallT;
      this.fall.position.y = 0.15 * this.fallT;
    }
  }
}

export async function createAvatar(def) {
  if (def.procedural) {
    const { seed, ...overrides } = def.procedural;
    return new Humanoid(randomOutfit('employee', mulberry32(seed), overrides), def);
  }
  const gltf = await loadGltf(def.file);
  return new Avatar(def, SkeletonUtils.clone(gltf.scene), gltf.animations);
}
