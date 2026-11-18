import * as THREE from 'three';
import { clamp, dist2d, headingTo, wrapAngle } from './utils.js';

// Heat needed for each wanted star, and [heat, minimum stars] per crime.
const HEAT = [0, 30, 150, 400, 800, 1400];
const CRIMES = {
  assault: [25, 1],
  robbery: [40, 1],
  kill: [120, 2],
  assaultCop: [80, 2],
  killCop: [220, 3],
  vehicle: [60, 1],
  explosion: [50, 1],
  copcar: [60, 2],
};
// How many units chase you at each wanted level
const FOOT = [0, 2, 3, 5, 6, 8];
const CARS = [0, 0, 1, 2, 3, 3];
const TANKS = [0, 0, 0, 0, 1, 2];
const SIGHT = 45;

const _ray = new THREE.Ray();
const _o = new THREE.Vector3();
const _t = new THREE.Vector3();

export class Police {
  constructor(game) {
    this.game = game;
    this.heat = 0;
    this.level = 0;
    this.unseen = 0;
    this.searching = false;
    this.seen = false;
    this.arrest = 0;
    this.contact = false;
    this.units = [];        // police vehicles driven by AI
    this.spawnTimer = 0;
    this.seeTimer = 0;
  }

  reportCrime(kind) {
    const [heat, minStars] = CRIMES[kind] || [20, 1];
    const before = this.level;
    this.heat = Math.min(HEAT[5] + 300, Math.max(this.heat + heat, HEAT[minStars]));
    this.unseen = 0;
    this.recompute();
    if (this.level > before) this.game.onWantedRaised(this.level);
  }

  recompute() {
    let level = 0;
    for (let i = 1; i <= 5; i++) if (this.heat >= HEAT[i]) level = i;
    this.level = level;
  }

  setLevel(n) {
    const before = this.level;
    this.heat = HEAT[clamp(n, 0, 5)];
    this.unseen = 0;
    this.recompute();
    if (this.level > before) this.game.onWantedRaised(this.level);
    if (this.level === 0) this.clear();
  }

  clear() {
    this.heat = 0;
    this.level = 0;
    this.arrest = 0;
    this.searching = false;
    for (const v of this.units) if (v.driver !== 'player') this.game.vehicles.remove(v);
    this.units = [];
    this.game.npcs.clearPolice();
  }

  officerAdjacent() { this.contact = true; }

  get target() {
    const p = this.game.player;
    return p.vehicle ? p.vehicle.pos : p.position;
  }

  lineOfSight(from, to, fromHeight = 1.6) {
    _o.set(from.x, fromHeight, from.z);
    _t.set(to.x, 1.4, to.z);
    const d = _o.distanceTo(_t);
    if (d < 1e-3) return true;
    _ray.set(_o, _t.sub(_o).divideScalar(d));
    const hit = this.game.world.octree.rayIntersect(_ray);
    return !hit || hit.distance > d;
  }

  canSee(target) {
    for (const n of this.game.npcs.officers) {
      if (dist2d(n, target) < SIGHT && this.lineOfSight(n, target)) return true;
    }
    for (const v of this.units) {
      if (!v.wrecked && v.driver === 'ai' && dist2d(v.pos, target) < SIGHT && this.lineOfSight(v.pos, target, 1.8)) return true;
    }
    return false;
  }

  update(dt) {
    const game = this.game;
    const p = game.player;
    const target = this.target;

    // BUSTED: an officer keeps hold of you (only at 1-2 stars; above that they fight)
    const holdable = !p.vehicle || Math.abs(p.vehicle.speed) < 1.5;
    if (this.contact && this.level > 0 && this.level <= 2 && holdable && !p.dead) this.arrest += dt;
    else this.arrest = Math.max(0, this.arrest - dt * 0.7);
    this.contact = false;
    if (this.arrest > 1.8) { game.bust(); return; }

    // losing the cops: stay out of sight long enough and the stars drop one by one
    this.seeTimer -= dt;
    if (this.seeTimer <= 0) {
      this.seeTimer = 0.3;
      this.seen = this.level > 0 && this.canSee(target);
    }
    if (this.level > 0) {
      this.unseen = this.seen ? 0 : this.unseen + dt;
      this.searching = this.unseen > 1.5;
      if (this.unseen > 10 + this.level * 4) {
        this.heat = HEAT[this.level - 1];
        this.unseen = 0;
        this.recompute();
        if (this.level === 0) { game.onWantedCleared(); this.searching = false; }
      }
    }

    for (const v of this.units) if (v.driver === 'ai') this.driveUnit(v, dt, target);
    // forget wrecked or abandoned units once they are far away
    this.units = this.units.filter(v => {
      const far = dist2d(v.pos, target) > 110 || (this.level === 0 && dist2d(v.pos, target) > 70);
      if (far && v.driver !== 'player') { game.vehicles.remove(v); return false; }
      return v.driver !== 'player';
    });

    this.spawnTimer -= dt;
    if (this.level > 0 && this.spawnTimer <= 0) {
      this.spawnTimer = 2.5;
      const world = game.world;
      if (game.npcs.officers.length < FOOT[this.level]) {
        const pt = world.randomWalkPoint(target, 30, 55);
        game.npcs.spawnPolice(pt.x, pt.z);
      }
      const active = (id) => this.units.filter(v => !v.wrecked && v.type.id === id && !v.deployed).length;
      if (active('police') < CARS[this.level]) this.spawnUnit('police', world.randomRoadPoint(target, 60, 110));
      else if (active('tank') < TANKS[this.level]) this.spawnUnit('tank', world.randomRoadPoint(target, 60, 110));
    }

    // siren volume = closest police unit with lights on
    let siren = 0;
    for (const v of this.units) {
      if (v.sirenOn) siren = Math.max(siren, 1 - dist2d(v.pos, target) / 80);
    }
    game.sirenLevel = clamp(siren, 0, 1);
  }

  spawnUnit(type, pt) {
    const v = this.game.vehicles.spawn(type, pt.x, pt.z, pt.heading);
    v.driver = 'ai';
    v.sirenOn = true;
    v.isPolice = true;
    v.stuckClock = 0;
    v.reverseTime = 0;
    this.units.push(v);
  }

  driveUnit(v, dt, target) {
    if (v.wrecked) return;
    const game = this.game;
    const d = dist2d(v.pos, target);
    if (this.level === 0) {
      // head back out of the area
      v.sirenOn = false;
      const away = { x: v.pos.x * 2 - target.x, z: v.pos.z * 2 - target.z };
      this.autopilot(v, away, dt, 0);
      return;
    }
    if (v.type.cannon) {
      v.turretYaw = wrapAngle(headingTo(v.pos, target) - v.heading);
      const aimed = Math.abs(wrapAngle(v.turretYaw - v.model.turret.rotation.y)) < 0.12;
      if (this.level >= 4 && d < 45 && v.reload <= 0 && aimed && this.lineOfSight(v.pos, target, 2.4)) {
        v.reload = 4;
        game.fireShell(v, 'ai');
      }
      this.autopilot(v, target, dt, 16);
      return;
    }
    if (d < 12) {
      // pull up and let the officers out
      v.controls.throttle = 0;
      v.controls.brake = true;
      if (Math.abs(v.speed) < 1.5) {
        for (const spot of v.exitSpots().slice(0, 2)) game.npcs.spawnPolice(spot.x, spot.z);
        v.deployed = true;
        v.driver = null;
      }
      return;
    }
    this.autopilot(v, target, dt, 0);
  }

  // Steer toward a point, feel ahead for walls, reverse out when stuck.
  autopilot(v, goal, dt, stopDistance) {
    const c = v.controls;
    const diff = wrapAngle(headingTo(v.pos, goal) - v.heading);
    if (v.reverseTime > 0) {
      v.reverseTime -= dt;
      c.throttle = -1;
      c.steer = -Math.sign(diff) || 1;
      c.brake = false;
      return;
    }
    const look = 5 + Math.abs(v.speed) * 0.6;
    const front = v.toWorld(v.type.length / 2, 0);
    const ahead = this.freeDistance(front, v.heading, look);
    let avoid = 0;
    if (ahead < look) avoid = this.freeDistance(front, v.heading + 0.6, look) > this.freeDistance(front, v.heading - 0.6, look) ? 1 : -1;
    c.steer = clamp(diff * 2 + avoid * 0.9, -1, 1);
    c.throttle = Math.abs(diff) > 1.8 ? 0.35 : ahead < 4 ? 0.3 : 1;
    c.brake = false;
    if (stopDistance && dist2d(v.pos, goal) < stopDistance) { c.throttle = 0; c.brake = true; }
    v.stuckClock = c.throttle > 0.25 && Math.abs(v.speed) < 1 ? v.stuckClock + dt : 0;
    if (v.stuckClock > 1.2) { v.reverseTime = 1.2; v.stuckClock = 0; }
  }

  freeDistance(from, heading, length) {
    _ray.origin.set(from.x, 0.8, from.z);
    _ray.direction.set(Math.sin(heading), 0, Math.cos(heading));
    const hit = this.game.world.octree.rayIntersect(_ray);
    return hit ? Math.min(hit.distance, length) : length;
  }
}
