import * as THREE from 'three';
import { Hud } from './hud.js';
import { Sfx } from './audio.js';
import { Effects } from './effects.js';
import { VehicleManager } from './vehicles.js';
import { Pickups } from './pickups.js';
import { NpcManager } from './npcs.js';
import { Police } from './police.js';
import { Cheats } from './cheats.js';
import { Player } from './player.js';
import { ThirdPersonCamera } from './camera.js';
import { Network, inviteLink } from './net.js';
import { RemotePlayers } from './remotes.js';
import { Voice } from './voice.js';
import { clamp, dist2d } from './utils.js';

const SHELL_SPEED = 55;
const SHELL_GRAVITY = 9.8;
const SHELL_AIM_DISTANCE = 30;   // player shells are lobbed to land about this far ahead
const PERSON_GAP = 0.65;          // characters can't overlap closer than this
const HOSPITAL_FEE = 100;
const BAIL = 250;
const WRECK_LIFE = 40;
const PARKING_REFILL = 20;
const NET_RATE = 1 / 12;          // multiplayer state packets per second

const shellGeo = new THREE.SphereGeometry(0.16, 10, 8);
const shellMat = new THREE.MeshBasicMaterial({ color: '#ffcf6b', toneMapped: false });
const _v = new THREE.Vector3();
const _ray = new THREE.Ray();

// Owns every system of a running session and the rules that connect them.
export class Game {
  constructor({ scene, camera, canvas, world, input, avatar, name, nameTag, sfx, room = null }) {
    this.scene = scene;
    this.camera = camera;
    this.world = world;
    this.input = input;
    this.nameTag = nameTag;
    this.sfx = sfx ?? new Sfx();
    this.hud = new Hud(world.map);
    this.effects = new Effects(scene);
    this.vehicles = new VehicleManager(this);
    this.pickups = new Pickups(this);
    this.npcs = new NpcManager(this);
    this.police = new Police(this);
    this.cheats = new Cheats(this);
    this.player = new Player(this, avatar, name);
    scene.add(avatar.root);
    this.rig = new ThirdPersonCamera(camera, world.octree, canvas);
    this.rig.yaw = world.spawn.heading + Math.PI;   // start behind the player
    this.sirenLevel = 0;
    this.time = 0;
    this.shells = [];
    this.over = null;              // { kind: 'wasted' | 'busted', timer }
    this.playerHitCooldown = 0;
    this.parkingTimer = PARKING_REFILL;

    for (const p of world.parking) this.vehicles.spawn(p.type, p.x, p.z, p.heading);
    input.onKey = code => { if (!this.over) this.cheats.onKey(code); };
    this.hud.show(name, avatar.def.name);
    this.hud.toast('Welcome to EPAM City. Press Tab for controls and cheats.');

    this.net = null;
    this.remotes = null;
    this.voice = null;
    this.netTimer = 0;
    if (room) this.startMultiplayer(room, name, avatar.def.id);
  }

  // ---------- multiplayer ----------

  async startMultiplayer(code, name, avatarId) {
    const hud = this.hud;
    this.remotes = new RemotePlayers(this);
    this.voice = new Voice(this.sfx);
    hud.showRoom(code, inviteLink(code));
    const stream = await this.voice.startMic();
    if (!stream) hud.toast('Microphone blocked: you can hear others, but they cannot hear you.');
    const net = this.net = new Network({ code, hello: { name, avatar: avatarId }, stream });
    net.on('join', (id, hello) => {
      this.remotes.add(id, hello);
      hud.toast(`${hello.name} joined the city`);
      this.sfx.pickup();
      if (this.voice.muted) net.broadcast({ type: 'mute', muted: true });
    });
    net.on('state', (id, s) => this.remotes.setState(id, s));
    net.on('mute', (id, muted) => this.remotes.setMuted(id, muted));
    net.on('stream', (id, s) => this.voice.add(id, s));
    net.on('leave', (id, hello) => {
      this.remotes.remove(id);
      this.voice.remove(id);
      hud.toast(`${hello.name} left the city`);
    });
    net.on('status', text => hud.toast(text));
    try {
      await net.start();
    } catch (e) {
      console.warn('Multiplayer failed to start', e);
      hud.toast('Could not load multiplayer (peerjs from cdn.jsdelivr.net). Playing solo.');
      this.net = null;
    }
  }

  sendState(dt) {
    this.netTimer -= dt;
    if (this.netTimer > 0) return;
    this.netTimer = NET_RATE;
    const p = this.player, v = p.vehicle;
    const r2 = n => Math.round(n * 100) / 100;
    const pos = p.position;
    this.net.broadcast({
      type: 'state', x: r2(pos.x), y: r2(pos.y), z: r2(pos.z), h: r2(p.heading),
      a: p.avatar.state, d: p.dead, w: p.weaponIndex >= 0 ? p.weapons[p.weaponIndex] : null,
      v: v ? { t: v.type.id, x: r2(v.pos.x), z: r2(v.pos.z), h: r2(v.heading), l: r2(v.lean), s: r2(v.speed) } : null,
    });
  }

  update(dt) {
    this.time += dt;
    const { player, input } = this;
    if (input.consume('help')) this.hud.toggleHelp();
    if (input.consume('mute') && this.voice) {
      const muted = this.voice.toggleMute();
      this.net?.broadcast({ type: 'mute', muted });
      this.hud.toast(muted ? 'Microphone muted' : 'Microphone on');
    }
    if (this.over) input.clearQueue();

    player.update(dt, input, this.rig);
    if (player.vehicle) player.vehicle.invincible = player.cheats.god;
    this.vehicles.update(dt);
    if (!this.over) this.police.update(dt);
    this.npcs.update(dt);
    this.separateCharacters();
    this.remotes?.pushPlayer(player);
    this.vehicleVsCharacters(dt);
    this.pickups.update(dt);
    this.updateShells(dt);
    this.effects.update(dt);
    this.housekeeping(dt);

    const v = player.vehicle;
    let focus;
    if (v) {
      this.rig.setMode(v.type.camDistance, v.type.cannon ? 3.2 : v.type.seated ? 1.6 : 1.9);
      if (Math.abs(v.speed) > 2) this.rig.follow(v.heading, dt, v.type.cannon ? 1.2 : 2.5);
      focus = v.pos;
    } else {
      this.rig.setMode();
      focus = player.position;
    }
    this.rig.shake = this.effects.shake;
    this.rig.update(dt, focus);
    this.world.followSun(focus);
    this.nameTag.visible = player.avatar.root.visible;
    if (this.remotes) {
      this.remotes.update(dt);
      this.voice.update(focus, this.rig.lookHeading, this.remotes);
      if (this.net) this.sendState(dt);
    }
    this.hud.update(dt, this);
    this.sfx.update(this.time, this.sirenLevel);

    if (this.over) {
      this.over.timer -= dt;
      if (this.over.timer <= 0) this.respawn();
    }
  }

  // ---------- characters ----------

  separateCharacters() {
    const bodies = [];
    for (const n of this.npcs.list) if (n.alive && n.state !== 'knocked') bodies.push(n.body);
    if (!this.player.vehicle && !this.player.dead) bodies.push(this.player.body);
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i], b = bodies[j];
        const dx = b.x - a.x, dz = b.z - a.z;
        if (Math.abs(dx) > PERSON_GAP || Math.abs(dz) > PERSON_GAP) continue;
        const d = Math.hypot(dx, dz);
        if (d >= PERSON_GAP || d < 1e-4) continue;
        const push = (PERSON_GAP - d) / 2;
        a.nudge((-dx / d) * push, (-dz / d) * push);
        b.nudge((dx / d) * push, (dz / d) * push);
      }
    }
  }

  // Run people over, or just keep them out of the vehicle's footprint.
  vehicleVsCharacters(dt) {
    this.playerHitCooldown -= dt;
    const player = this.player;
    for (const v of this.vehicles.list) {
      const speed = Math.abs(v.speed);
      const fast = speed > 4;
      const reach = v.radius + 1;
      // a knock-back "from" point behind the person along the direction of travel, so they get flung forward
      const dir = Math.sign(v.speed) || 1;
      for (const n of this.npcs.list) {
        if (!n.alive || Math.abs(n.x - v.pos.x) > reach || Math.abs(n.z - v.pos.z) > reach) continue;
        const push = v.pushOut(n.x, n.z, 0.35);
        if (!push) continue;
        if (fast && n.hitCooldown <= 0 && !v.wrecked) {
          n.hitCooldown = 0.6;
          const from = { x: n.x - v.fx * dir, z: n.z - v.fz * dir };
          n.takeHit(speed * 4.5, from, { force: Math.min(14, speed * 0.7), knockdown: true, attacker: v.driver === 'player' ? 'player' : null });
          v.speed *= v.type.heavy ? 0.97 : 0.85;
          this.sfx.punch();
        } else {
          n.body.nudge(push.dx, push.dz);
        }
      }
      if (player.vehicle || player.dead || Math.abs(player.x - v.pos.x) > reach || Math.abs(player.z - v.pos.z) > reach) continue;
      const push = v.pushOut(player.x, player.z, 0.35);
      if (!push) continue;
      if (fast && !v.wrecked && this.playerHitCooldown <= 0) {
        this.playerHitCooldown = 0.8;
        player.takeDamage(speed * 3, { x: player.x - v.fx * dir, z: player.z - v.fz * dir });
      }
      player.body.nudge(push.dx, push.dz);
    }
  }

  // ---------- vehicles ----------

  onEnterVehicle(v) {
    this.hud.vehicleName(v.type.name);
    this.sfx.door();
    if (!v.owned && (v.isPolice || v.type.siren || v.type.cannon)) this.police.reportCrime('copcar');
    v.owned = true;
  }

  onExitVehicle(v) {
    v.invincible = false;
    this.sfx.door();
  }

  onVehicleCrash(v, impact) {
    this.sfx.crash();
    const front = v.toWorld(v.type.length / 2 * Math.sign(v.speed || 1), 0);
    this.effects.sparks(_v.set(front.x, 0.8, front.z), '#ffd27a', Math.min(14, Math.round(impact)), 5);
    if (v === this.player.vehicle) {
      this.effects.shake += clamp(impact / 30, 0, 0.6);
      // whoever the player rams gets blamed on the player if it blows up
      for (const o of this.vehicles.list) {
        if (o !== v && dist2d(o.pos, v.pos) < o.radius + v.radius + 1) o.lastHitBy = 'player';
      }
    }
  }

  onVehicleWrecked(v) {
    const player = this.player;
    if (player.vehicle === v) player.exitVehicle();
    v.driver = null;
    v.wreckTime = 0;
    const attacker = v.lastHitBy === 'player' || v.owned ? 'player' : null;
    this.explode(v.pos.clone().setY(1), v.type.heavy ? 8 : 6, 90, attacker);
  }

  spawnNearPlayer(type) {
    const p = this.player;
    const from = p.vehicle ? p.vehicle.pos : p.position;
    const h = this.rig.lookHeading;
    let x = from.x + Math.sin(h) * 7, z = from.z + Math.cos(h) * 7;
    if (!this.world.isWalkable(x, z)) ({ x, z } = this.world.randomRoadPoint(from, 5, 30));
    const v = this.vehicles.spawn(type, x, z, h + Math.PI / 2);
    v.owned = true;
    return v;
  }

  housekeeping(dt) {
    const target = this.player.position;
    for (const v of [...this.vehicles.list]) {
      if (!v.wrecked) continue;
      v.wreckTime = (v.wreckTime ?? 0) + dt;
      if (v.wreckTime > WRECK_LIFE && dist2d(v.pos, target) > 50) this.vehicles.remove(v);
    }
    // put parked cars back in empty spots the player can't see being filled
    this.parkingTimer -= dt;
    if (this.parkingTimer > 0) return;
    this.parkingTimer = PARKING_REFILL;
    for (const spot of this.world.parking) {
      if (dist2d(spot, target) < 50) continue;
      if (this.vehicles.list.some(v => dist2d(v.pos, spot) < 4)) continue;
      this.vehicles.spawn(spot.type, spot.x, spot.z, spot.heading);
    }
  }

  // ---------- tank shells and explosions ----------

  fireShell(v, owner) {
    v.root.updateMatrixWorld(true);
    const start = v.model.muzzle.getWorldPosition(new THREE.Vector3());
    const yaw = v.heading + v.model.turret.rotation.y;
    let range = SHELL_AIM_DISTANCE;
    if (owner !== 'player') range = clamp(dist2d(v.pos, this.police.target), 6, 60);
    // lob so the shell comes down at chest height `range` metres away
    const t = range / SHELL_SPEED;
    const vy = (1.2 - start.y) / t + 0.5 * SHELL_GRAVITY * t;
    const vel = new THREE.Vector3(Math.sin(yaw) * SHELL_SPEED, vy, Math.cos(yaw) * SHELL_SPEED);
    const mesh = new THREE.Mesh(shellGeo, shellMat);
    mesh.position.copy(start);
    this.scene.add(mesh);
    this.shells.push({ mesh, vel, owner, shooter: v, life: 2.5, trail: 0 });
    this.sfx.cannon();
    this.effects.smoke(start, 0.3, 1);
    this.effects.sparks(start, '#ffcf6b', 8, 4);
    if (owner === 'player') this.effects.shake += 0.35;
  }

  updateShells(dt) {
    this.shells = this.shells.filter(s => {
      s.life -= dt;
      s.vel.y -= SHELL_GRAVITY * dt;
      const pos = s.mesh.position;
      const step = s.vel.length() * dt;
      _ray.origin.copy(pos);
      _ray.direction.copy(s.vel).normalize();
      const wall = this.world.octree.rayIntersect(_ray);
      let hitAt = null;
      if (wall && wall.distance <= step) hitAt = _ray.at(wall.distance, new THREE.Vector3());
      pos.addScaledVector(s.vel, dt);
      if (!hitAt && pos.y <= 0.1) hitAt = pos.clone().setY(0.2);
      if (!hitAt && this.shellHitsSomething(s, pos)) hitAt = pos.clone();
      if (hitAt || s.life <= 0) {
        this.scene.remove(s.mesh);
        if (hitAt) this.explode(hitAt, 5, 110, s.owner === 'player' ? 'player' : null);
        return false;
      }
      s.trail -= dt;
      if (s.trail <= 0) { s.trail = 0.04; this.effects.smoke(pos, 0.05, 0.6); }
      return true;
    });
  }

  shellHitsSomething(s, pos) {
    for (const v of this.vehicles.list) {
      if (v !== s.shooter && pos.y < 2.6 && v.distanceTo(pos.x, pos.z) < 0.2) return true;
    }
    if (pos.y > 2.2) return false;
    for (const n of this.npcs.list) {
      if (n.alive && dist2d(n, pos) < 0.7 && !(s.owner !== 'player' && n.police)) return true;
    }
    const p = this.player;
    return s.owner !== 'player' && !p.vehicle && !p.dead && dist2d(p, pos) < 0.8;
  }

  explode(pos, radius, damage, attacker = null) {
    this.effects.explosion(pos, radius);
    this.sfx.explosion();
    this.npcs.explosion(pos, radius, damage, attacker);
    this.npcs.panic(pos, 30, pos);
    for (const v of this.vehicles.list) {
      const d = v.distanceTo(pos.x, pos.z);
      if (d > radius || v.wrecked) continue;
      if (attacker === 'player') v.lastHitBy = 'player';
      v.damage(damage * (1 - d / radius) * (v.type.heavy ? 0.6 : 2.2));
    }
    const p = this.player;
    if (!p.vehicle && !p.dead) {
      const d = dist2d(p, pos);
      if (d < radius) p.takeDamage(damage * clamp(1 - d / radius + 0.2, 0, 1), pos);
    }
    if (attacker === 'player') this.police.reportCrime('explosion');
  }

  // ---------- wanted level, death and arrest ----------

  onWantedRaised(level) {
    this.sfx.wanted();
    if (level >= 3 && level <= 5) this.hud.toast(level >= 4 ? 'EPAM Security is sending tanks!' : 'EPAM Police cruisers are on the way');
  }

  onWantedCleared() {
    this.hud.toast('You lost the EPAM Police.');
  }

  onPlayerDeath() {
    if (this.over) return;
    this.player.die();
    this.over = { kind: 'wasted', timer: 4 };
    this.hud.bigMessage('WASTED', 'wasted');
  }

  bust() {
    if (this.over) return;
    const p = this.player;
    if (p.vehicle) p.exitVehicle();
    p.dead = true;
    p.avatar.play('idle');
    this.over = { kind: 'busted', timer: 3.5 };
    this.hud.bigMessage('BUSTED', 'busted');
  }

  respawn() {
    const p = this.player;
    const wasted = this.over.kind === 'wasted';
    this.over = null;
    this.hud.bigMessage('');
    const fee = Math.min(p.money, (wasted ? HOSPITAL_FEE : BAIL) + Math.round(p.money * 0.1));
    p.money -= fee;
    this.hud.shownMoney = p.money;
    p.loseWeapons();
    this.police.clear();
    this.sirenLevel = 0;
    const at = wasted ? this.world.clinic : this.world.station;
    p.revive(at);
    this.rig.yaw = at.heading + Math.PI;
    this.hud.toast(wasted
      ? `EPAM Wellness Center patched you up. Bill: $${fee.toLocaleString()}`
      : `Released from EPAM Security HQ. Bail: $${fee.toLocaleString()}, laptops confiscated`);
  }
}
