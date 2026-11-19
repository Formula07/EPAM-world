import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { AVATARS, FALLBACK_AVATAR, createAvatar } from './avatars.js';
import { Vehicle } from './vehicles.js';
import { createLaptopMesh } from './weapons.js';
import { lerpAngle } from './utils.js';

const DELAY = 120;      // ms: render remote players slightly in the past so there are two snapshots to blend
const MAX_SNAPS = 12;
const PERSON_GAP = 0.65;

// Other players in the room: avatar + name tag driven by network snapshots, plus a
// look-alike vehicle while they drive (visual only: no physics, AI or damage on this side).
export class RemotePlayers {
  constructor(game) {
    this.game = game;
    this.players = new Map();
  }

  get list() { return [...this.players.values()]; }
  get(id) { return this.players.get(id); }

  async add(id, hello) {
    if (this.players.has(id)) return;
    const r = { id, name: hello.name || 'Player', avatar: null, tag: null, snaps: [], ghost: null, ghostType: null,
      weapon: null, x: 0, z: 0, onFoot: true, muted: false, speaking: false, removed: false };
    this.players.set(id, r);
    const def = AVATARS.find(a => a.id === hello.avatar) ?? FALLBACK_AVATAR;
    let avatar;
    try { avatar = await createAvatar(def); } catch { avatar = await createAvatar(FALLBACK_AVATAR); }
    if (r.removed) return;
    const tag = document.createElement('div');
    tag.className = 'name-tag remote';
    tag.textContent = r.name;
    r.tagEl = tag;
    r.tag = new CSS2DObject(tag);
    r.tag.position.set(0, 2.15, 0);
    avatar.root.add(r.tag);
    r.avatar = avatar;
    this.game.scene.add(avatar.root);
  }

  setState(id, s) {
    const r = this.players.get(id);
    if (!r) return;
    s.t = performance.now();
    r.snaps.push(s);
    if (r.snaps.length > MAX_SNAPS) r.snaps.shift();
  }

  setMuted(id, muted) {
    const r = this.players.get(id);
    if (r) r.muted = muted;
  }

  remove(id) {
    const r = this.players.get(id);
    if (!r) return;
    r.removed = true;
    if (r.avatar) { r.avatar.root.remove(r.tag); this.game.scene.remove(r.avatar.root); }
    if (r.ghost) this.game.scene.remove(r.ghost.root);
    this.players.delete(id);
  }

  update(dt) {
    const renderTime = performance.now() - DELAY;
    for (const r of this.players.values()) {
      if (!r.avatar || !r.snaps.length) continue;
      // the two snapshots around renderTime (or just the newest one)
      let a = r.snaps[0], b = r.snaps[0];
      for (const s of r.snaps) {
        if (s.t <= renderTime) a = s;
        b = s;
        if (s.t > renderTime) break;
      }
      const u = b.t > a.t ? Math.min(1, (renderTime - a.t) / (b.t - a.t)) : 1;
      const lerp = (p, q) => p + (q - p) * Math.max(0, u);
      const speed = b.t > a.t ? Math.hypot(b.x - a.x, b.z - a.z) / ((b.t - a.t) / 1000) : 0;
      this.updateVehicle(r, a.v && b.v && a.v.t === b.v.t ? { a: a.v, b: b.v, lerp, u } : b.v ? { a: b.v, b: b.v, lerp, u: 1 } : null, dt);

      const avatar = r.avatar;
      if (r.ghost) {
        r.x = r.ghost.pos.x; r.z = r.ghost.pos.z;
        const seated = r.ghost.type.seated && avatar.canSit;
        avatar.root.visible = seated;
        if (seated) {
          const seat = r.ghost.toWorld(-0.35, 0);
          avatar.root.position.set(seat.x, 0.27, seat.z);
          avatar.root.rotation.set(0, r.ghost.heading, 0);
          avatar.root.rotateZ(r.ghost.lean);
          avatar.play('sit');
        }
      } else {
        r.x = lerp(a.x, b.x); r.z = lerp(a.z, b.z);
        avatar.root.visible = true;
        avatar.root.position.set(r.x, lerp(a.y, b.y), r.z);
        avatar.root.rotation.set(0, lerpAngle(a.h, b.h, Math.max(0, u)), 0);
        if (!b.d) avatar.play(b.a || 'idle');
        avatar.setSpeed(speed);
      }
      r.onFoot = !r.ghost && !b.d;
      avatar.setDead(!!b.d);
      if (b.w !== r.weapon) {
        r.weapon = b.w;
        avatar.hold(b.w ? createLaptopMesh(b.w) : null);
      }
      r.tag.visible = avatar.root.visible;
      r.tagEl.classList.toggle('speaking', !!r.speaking);
      avatar.update(dt);
    }
  }

  updateVehicle(r, v, dt) {
    if (!v) {
      if (r.ghost) { this.game.scene.remove(r.ghost.root); r.ghost = null; r.ghostType = null; }
      return;
    }
    if (r.ghostType !== v.b.t) {
      if (r.ghost) this.game.scene.remove(r.ghost.root);
      r.ghost = new Vehicle(v.b.t, v.b.x, v.b.z, v.b.h);
      r.ghostType = v.b.t;
      this.game.scene.add(r.ghost.root);
    }
    const g = r.ghost;
    g.pos.x = v.lerp(v.a.x, v.b.x);
    g.pos.z = v.lerp(v.a.z, v.b.z);
    g.heading = lerpAngle(v.a.h, v.b.h, Math.max(0, v.u));
    g.lean = v.b.l || 0;
    for (const w of g.model.wheels) w.spin.rotation.x += ((v.b.s || 0) / w.r) * dt;
    g.sync();
  }

  // Remote players aren't simulated here, so only the local player gets pushed out of them.
  pushPlayer(player) {
    if (player.vehicle || player.dead) return;
    for (const r of this.players.values()) {
      if (!r.onFoot) continue;
      const dx = player.x - r.x, dz = player.z - r.z;
      const d = Math.hypot(dx, dz);
      if (d >= PERSON_GAP || d < 1e-4) continue;
      player.body.nudge((dx / d) * (PERSON_GAP - d), (dz / d) * (PERSON_GAP - d));
    }
  }
}
