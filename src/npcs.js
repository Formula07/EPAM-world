import { Humanoid, randomOutfit } from './humanoid.js';
import { CharacterBody } from './character.js';
import { LAPTOP_IDS, createLaptopMesh } from './weapons.js';
import { clamp, dist2d, headingTo, lerpAngle, pick, randRange, wrapAngle } from './utils.js';

const PED_COUNT = 26;
const LAPTOP_CHANCE = 0.4;
const CORPSE_TIME = 25;

// EPAM employees walking around campus, plus EPAM police officers (kind === 'police').
export class Npc {
  constructor(game, kind, x, z) {
    this.game = game;
    this.kind = kind;
    this.police = kind === 'police';
    this.avatar = new Humanoid(randomOutfit(kind));
    this.body = new CharacterBody(game.world.octree, { substeps: 2 });
    this.body.place(x, z);
    this.health = this.police ? 120 : 100;
    this.heading = Math.random() * Math.PI * 2;
    this.state = this.police ? 'chase' : 'wander';
    this.stateTime = 0;
    this.walkSpeed = randRange(1.2, 1.7);
    this.target = null;
    this.threat = null;
    this.detour = 0;
    this.detourSign = 1;
    this.stuckClock = 0;
    this.stuckCount = 0;
    this.lastX = x;
    this.lastZ = z;
    this.attackCooldown = randRange(0.3, 1);
    this.hitCooldown = 0;
    this.laptop = null;
    if (!this.police && Math.random() < LAPTOP_CHANCE) {
      this.laptop = pick(Math.random, LAPTOP_IDS);
      this.avatar.carry(createLaptopMesh(this.laptop));
    }
    game.scene.add(this.avatar.root);
    this.body.syncTo(this.avatar.root, this.heading);
  }

  get alive() { return this.state !== 'dead'; }
  get x() { return this.body.x; }
  get z() { return this.body.z; }

  update(dt) {
    this.stateTime += dt;
    this.attackCooldown -= dt;
    this.hitCooldown -= dt;
    const game = this.game;
    let speed = 0, running = false;

    switch (this.state) {
      case 'wander': {
        if (!this.target || dist2d(this, this.target) < 1.2 || this.stuckCount > 2) {
          this.target = game.world.randomWalkPoint(this, 6, 35);
          this.stuckCount = 0;
        }
        speed = this.walkSpeed;
        this.steerTo(this.target, speed, dt);
        break;
      }
      case 'flee': {
        const away = Math.atan2(this.x - this.threat.x, this.z - this.threat.z);
        const goal = { x: this.x + Math.sin(away) * 8, z: this.z + Math.cos(away) * 8 };
        speed = 5.4; running = true;
        this.steerTo(goal, speed, dt);
        if (this.stateTime > 7) this.setState('wander');
        break;
      }
      case 'chase': {
        const p = game.player;
        if (game.police.level === 0) { this.setState('wander'); break; }
        const target = p.vehicle ? p.vehicle.pos : p.position;
        const d = p.vehicle ? p.vehicle.distanceTo(this.x, this.z) : dist2d(this, target);
        if (d > 1.15) {
          speed = 6.2; running = true;
          this.steerTo(target, speed, dt);
        } else {
          this.body.move(dt, 0, 0, 0);
          this.heading = lerpAngle(this.heading, headingTo(this, target), 1 - Math.exp(-10 * dt));
          game.police.officerAdjacent(this);
          if (game.police.level >= 3 && !p.vehicle && this.attackCooldown <= 0) {
            this.attackCooldown = 1.1;
            this.avatar.punch(false);
            game.sfx.punch();
            p.takeDamage(8, this);
          }
        }
        break;
      }
      case 'knocked': {
        this.body.slide(dt, 3);
        if (this.stateTime > 1.8 && this.body.onFloor) {
          this.avatar.setDead(false);
          this.setState(this.police ? 'chase' : 'flee');
        }
        break;
      }
      case 'dead': {
        this.body.slide(dt, 5);
        if (this.stateTime > CORPSE_TIME - 2) this.avatar.root.position.y -= dt * 0.3;
        break;
      }
      default: break;
    }

    if (this.state !== 'knocked' && this.state !== 'dead') {
      const horizontal = this.body.horizontalSpeed;
      this.avatar.setSpeed(horizontal);
      this.avatar.play(!this.body.onFloor && this.body.airTime > 0.3 ? 'jump' : horizontal < 0.3 ? 'idle' : running ? 'run' : 'walk');
      this.body.syncTo(this.avatar.root, this.heading);
    } else if (this.state === 'knocked' || this.stateTime < CORPSE_TIME - 2) {
      this.body.syncTo(this.avatar.root, this.heading);
    }
    this.avatar.update(dt);
  }

  setState(state) {
    this.state = state;
    this.stateTime = 0;
    this.target = null;
  }

  // Walk/run toward a point; side-step around obstacles when progress stalls.
  steerTo(goal, speed, dt) {
    let dx = goal.x - this.x, dz = goal.z - this.z;
    const d = Math.hypot(dx, dz) || 1;
    dx /= d; dz /= d;
    if (this.detour > 0) {
      this.detour -= dt;
      const a = this.detourSign * 1.3;
      const c = Math.cos(a), s = Math.sin(a);
      [dx, dz] = [dx * c + dz * s, -dx * s + dz * c];
    }
    this.body.move(dt, dx, dz, speed);
    this.heading = lerpAngle(this.heading, Math.atan2(dx, dz), 1 - Math.exp(-8 * dt));

    this.stuckClock += dt;
    if (this.stuckClock > 0.8) {
      const moved = Math.hypot(this.x - this.lastX, this.z - this.lastZ);
      if (moved < speed * 0.8 * 0.3) {
        this.detour = 1.0;
        this.detourSign = Math.random() < 0.5 ? -1 : 1;
        this.stuckCount++;
      }
      this.stuckClock = 0;
      this.lastX = this.x; this.lastZ = this.z;
    }
  }

  // from: {x, z} of the attacker. attacker === 'player' reports the crime to the police.
  takeHit(damage, from, { force = 3, knockdown = false, attacker = null } = {}) {
    if (!this.alive) return false;
    this.health -= damage;
    this.avatar.flinch();
    const away = Math.atan2(this.x - from.x, this.z - from.z);
    this.heading = wrapAngle(away + Math.PI);    // face the attacker, falls land on the back
    this.body.knock(Math.sin(away) * force, Math.cos(away) * force, force > 5 ? 3 : 1.5);
    const game = this.game;
    const killed = this.health <= 0;
    if (killed) this.die();
    else if (knockdown || force > 6) { this.setState('knocked'); this.avatar.setDead(true); }
    else if (this.police) this.setState('chase');
    else { this.threat = { x: from.x, z: from.z }; this.setState('flee'); }

    if (!this.police) game.npcs.panic(this, 14, from);
    if (attacker === 'player') {
      game.police.reportCrime(this.police ? (killed ? 'killCop' : 'assaultCop') : (killed ? 'kill' : 'assault'), this);
    }
    return killed;
  }

  die() {
    this.health = 0;
    this.setState('dead');
    this.avatar.setDead(true);
    const game = this.game;
    const pos = { x: this.x, z: this.z };
    game.pickups.dropCash(pos, Math.round(this.police ? randRange(60, 200) : randRange(20, 140)));
    if (this.laptop) {
      game.pickups.dropLaptop(pos, this.laptop);
      this.dropLaptop();
    }
  }

  dropLaptop() {
    this.laptop = null;
    this.avatar.carry(null);
  }

  remove() {
    this.game.scene.remove(this.avatar.root);
  }
}

export class NpcManager {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.respawnTimer = 0;
    const spawn = game.world.spawn;
    for (let i = 0; i < PED_COUNT; i++) {
      const p = game.world.randomWalkPoint(spawn, 8, 200);
      this.list.push(new Npc(game, 'ped', p.x + randRange(-1, 1), p.z + randRange(-1, 1)));
    }
  }

  spawnPolice(x, z) {
    const npc = new Npc(this.game, 'police', x, z);
    this.list.push(npc);
    return npc;
  }

  get officers() { return this.list.filter(n => n.police && n.alive); }

  update(dt) {
    const player = this.game.player;
    for (const n of this.list) n.update(dt);
    // clean up corpses and police that wandered off after the chase
    this.list = this.list.filter(n => {
      const gone = (n.state === 'dead' && n.stateTime > CORPSE_TIME)
        || (n.police && n.state === 'wander' && dist2d(n, player.position) > 70);
      if (gone) n.remove();
      return !gone;
    });
    // keep the streets populated, spawning out of sight
    this.respawnTimer -= dt;
    if (this.respawnTimer <= 0) {
      this.respawnTimer = 1.5;
      const peds = this.list.filter(n => !n.police && n.alive).length;
      if (peds < PED_COUNT) {
        const p = this.game.world.randomWalkPoint(player.position, 45, 90);
        this.list.push(new Npc(this.game, 'ped', p.x, p.z));
      }
    }
  }

  panic(origin, radius, threat) {
    for (const n of this.list) {
      if (n.police || n.state !== 'wander' || dist2d(n, origin) > radius) continue;
      n.threat = { x: threat.x, z: threat.z };
      n.setState('flee');
    }
  }

  // Closest living NPC in front of (x, z, heading) within range and a cone of half-angle arc.
  nearestInCone(x, z, heading, range, arc, filter = () => true) {
    let best = null, bestD = range;
    for (const n of this.list) {
      if (!n.alive || !filter(n)) continue;
      const d = Math.hypot(n.x - x, n.z - z);
      if (d > bestD) continue;
      const angle = Math.abs(wrapAngle(Math.atan2(n.x - x, n.z - z) - heading));
      if (angle > arc && d > 0.6) continue;
      best = n; bestD = d;
    }
    return best;
  }

  meleeHit(x, z, heading, weapon, attacker) {
    let hits = 0;
    for (const n of this.list) {
      if (!n.alive || n.hitCooldown > 0) continue;
      const d = Math.hypot(n.x - x, n.z - z);
      if (d > weapon.range + 0.3) continue;
      const angle = Math.abs(wrapAngle(Math.atan2(n.x - x, n.z - z) - heading));
      if (angle > weapon.arc && d > 0.6) continue;
      n.hitCooldown = 0.2;
      n.takeHit(weapon.damage * randRange(0.85, 1.15), { x, z }, { force: weapon.force, attacker });
      hits++;
    }
    return hits;
  }

  explosion(pos, radius, damage, attacker) {
    for (const n of this.list) {
      if (!n.alive) continue;
      const d = dist2d(n, pos);
      if (d > radius) continue;
      const falloff = 1 - d / radius;
      n.takeHit(damage * clamp(falloff + 0.3, 0, 1), pos, { force: 6 + 10 * falloff, knockdown: true, attacker });
    }
  }

  clearPolice() {
    this.list = this.list.filter(n => {
      if (n.police) n.remove();
      return !n.police;
    });
  }
}
