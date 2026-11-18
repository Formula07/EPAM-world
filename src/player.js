import * as THREE from 'three';
import { Capsule } from 'three/addons/math/Capsule.js';
import { CharacterBody } from './character.js';
import { FISTS, LAPTOPS, createLaptopMesh } from './weapons.js';
import { headingTo, lerpAngle, randRange } from './utils.js';

const JUMP_SPEED = 9.5;      // ≈1.5m jump height
const WALK_SPEED = 3.6;
const RUN_SPEED = 7.5;
const MAX_HEALTH = 100;
const ROB_RANGE = 1.8;

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _wish = new THREE.Vector3();
const _testCapsule = new Capsule(new THREE.Vector3(), new THREE.Vector3(), 0.35);

export class Player {
  constructor(game, avatar, name) {
    this.game = game;
    this.avatar = avatar;
    this.name = name;
    this.body = new CharacterBody(game.world.octree, { substeps: 5 });
    this.maxHealth = MAX_HEALTH;
    this.health = MAX_HEALTH;
    this.armor = 0;
    this.money = 500;
    this.weapons = [];          // laptop ids
    this.weaponIndex = -1;      // -1 = fists
    this.attackCooldown = 0;
    this.pendingHit = null;
    this.vehicle = null;
    this.dead = false;
    this.cheats = { god: false, moonJump: false, fastRun: false };
    this.prompt = null;
    this.spawnAt(game.world.spawn);
  }

  get position() { return this.avatar.root.position; }
  get x() { return this.body.x; }
  get z() { return this.body.z; }
  get weapon() { return this.weaponIndex >= 0 ? LAPTOPS[this.weapons[this.weaponIndex]] : FISTS; }

  spawnAt({ x, z, heading }) {
    this.body.place(x, z);
    this.heading = heading;
    this.body.syncTo(this.avatar.root, this.heading);
  }

  heal() { this.health = this.maxHealth; }

  addMoney(amount) {
    this.money = Math.max(0, this.money + amount);
    if (amount > 0) this.game.hud.moneyPopup(amount);
  }

  giveWeapon(id) {
    if (this.weapons.includes(id)) return false;
    this.weapons.push(id);
    this.equip(this.weapons.length - 1);
    return true;
  }

  equip(index) {
    this.weaponIndex = index;
    this.avatar.hold(index >= 0 ? createLaptopMesh(this.weapons[index]) : null);
  }

  cycleWeapon() {
    const next = this.weaponIndex + 1 >= this.weapons.length ? -1 : this.weaponIndex + 1;
    this.equip(next);
    this.game.hud.toast(`Weapon: ${this.weapon.name}`);
  }

  loseWeapons() {
    this.weapons = [];
    this.equip(-1);
  }

  takeDamage(amount, source = null) {
    if (this.dead || this.cheats.god) return;
    if (this.vehicle) {
      // inside a vehicle the vehicle soaks the hit
      this.vehicle.damage(amount);
      return;
    }
    const absorbed = Math.min(this.armor, amount * 0.7);
    this.armor -= absorbed;
    this.health -= amount - absorbed;
    this.game.hud.flashDamage();
    this.game.sfx.hurt();
    this.avatar.flinch();
    if (source && amount > 15) {
      const away = Math.atan2(this.x - source.x, this.z - source.z);
      this.body.knock(Math.sin(away) * 6, Math.cos(away) * 6, 4);
    }
    if (this.health <= 0) {
      this.health = 0;
      this.game.onPlayerDeath();
    }
  }

  update(dt, input, rig) {
    this.attackCooldown -= dt;
    this.prompt = null;
    if (this.dead) {
      this.body.slide(dt, 5);
      this.body.syncTo(this.avatar.root, this.heading);
      this.avatar.update(dt);
      return;
    }
    if (this.vehicle) { this.updateDriving(dt, input, rig); return; }

    // Movement is relative to where the camera looks (yaw 0 looks down -Z).
    const yaw = rig.yaw;
    _fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    _right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    const { x, y } = input.axis;
    _wish.set(0, 0, 0).addScaledVector(_fwd, y).addScaledVector(_right, x);
    const moving = _wish.lengthSq() > 0;
    if (moving) _wish.normalize();

    const running = moving && input.run;
    const speed = (running ? RUN_SPEED : WALK_SPEED) * (this.cheats.fastRun ? 1.8 : 1);
    const jump = input.consume('jump') ? JUMP_SPEED * (this.cheats.moonJump ? 2.2 : 1) : 0;
    this.body.gravityScale = this.cheats.moonJump && this.body.velocity.y < 0 ? 0.45 : 1;
    this.body.move(dt, _wish.x, _wish.z, speed, jump);
    if (this.body.collider.end.y < -25) this.spawnAt(this.game.world.spawn);

    if (moving) this.heading = lerpAngle(this.heading, Math.atan2(_wish.x, _wish.z), 1 - Math.exp(-12 * dt));

    if (input.consume('cycle')) this.cycleWeapon();
    if (input.consume('attack')) this.attack(rig);
    if (this.pendingHit !== null) {
      this.pendingHit -= dt;
      if (this.pendingHit <= 0) { this.pendingHit = null; this.landHit(); }
    }

    const game = this.game;
    const car = game.vehicles.nearestEnterable(this.x, this.z);
    if (car) this.prompt = `<kbd>F</kbd> Enter ${car.type.name}`;
    if (input.consume('enter') && car) { this.enterVehicle(car); return; }

    const victim = game.npcs.nearestInCone(this.x, this.z, this.heading, ROB_RANGE, 1.4, n => !!n.laptop && n.state !== 'knocked');
    if (victim && !car) this.prompt = `<kbd>E</kbd> Take laptop`;
    if (input.consume('steal') && victim) this.rob(victim);

    this.body.syncTo(this.avatar.root, this.heading);
    this.animate(dt, running);
  }

  attack(rig) {
    if (this.attackCooldown > 0) return;
    const w = this.weapon;
    this.attackCooldown = w.cooldown;
    // soft lock-on: turn toward the closest person roughly in front of the camera
    const target = this.game.npcs.nearestInCone(this.x, this.z, rig.lookHeading, 2.8, 1.1);
    if (target) this.heading = headingTo(this, target);
    this.avatar.punch(w !== FISTS);
    this.game.sfx.whoosh();
    this.pendingHit = w === FISTS ? 0.12 : 0.22;
  }

  landHit() {
    const hits = this.game.npcs.meleeHit(this.x, this.z, this.heading, this.weapon, 'player');
    if (hits) {
      this.game.sfx.punch();
      const fx = this.x + Math.sin(this.heading) * 0.8, fz = this.z + Math.cos(this.heading) * 0.8;
      this.game.effects.sparks(new THREE.Vector3(fx, 1.4, fz), this.weapon === FISTS ? '#ffffff' : '#39c2d7', 6, 3);
    }
  }

  rob(npc) {
    const value = Math.round(randRange(150, 600) * (npc.laptop === 'gaming' ? 2 : 1));
    npc.dropLaptop();
    npc.avatar.flinch();
    npc.threat = { x: this.x, z: this.z };
    npc.setState('flee');
    this.heading = headingTo(this, npc);
    this.avatar.punch(false);
    this.addMoney(value);
    this.game.hud.toast(`Laptop snatched and sold — +$${value.toLocaleString()}`);
    this.game.sfx.cash();
    this.game.npcs.panic(npc, 12, this);
    this.game.police.reportCrime('robbery');
  }

  enterVehicle(v) {
    this.vehicle = v;
    v.driver = 'player';
    v.controls.throttle = 0;
    this.pendingHit = null;
    const seated = v.type.seated && this.avatar.canSit;
    this.avatar.root.visible = seated;
    if (seated) this.avatar.play('sit');
    this.game.onEnterVehicle(v);
  }

  exitVehicle() {
    const v = this.vehicle;
    const spot = v.exitSpots().find(s => this.spotIsFree(s.x, s.z)) ?? { x: v.pos.x, z: v.pos.z };
    v.driver = null;
    v.controls.throttle = 0;
    this.vehicle = null;
    this.body.place(spot.x, spot.z);
    this.heading = v.heading;
    this.avatar.root.visible = true;
    this.avatar.root.rotation.set(0, 0, 0);
    this.avatar.play('idle');
    this.body.syncTo(this.avatar.root, this.heading);
    this.game.onExitVehicle(v);
  }

  die() {
    if (this.vehicle) this.exitVehicle();
    this.dead = true;
    this.pendingHit = null;
    this.avatar.setDead(true);
  }

  revive(at) {
    this.dead = false;
    this.health = this.maxHealth;
    this.armor = 0;
    this.avatar.setDead(false);
    this.spawnAt(at);
  }

  spotIsFree(x, z) {
    // capsule lifted off the ground so the floor itself doesn't count as blocking
    _testCapsule.start.set(x, 0.6, z);
    _testCapsule.end.set(x, 1.45, z);
    if (this.game.world.octree.capsuleIntersect(_testCapsule)) return false;
    return !this.game.vehicles.list.some(v => v !== this.vehicle && v.distanceTo(x, z) < 0.4);
  }

  updateDriving(dt, input, rig) {
    const v = this.vehicle;
    const { x, y } = input.axis;
    v.controls.throttle = y;
    v.controls.steer = -x;
    v.controls.brake = input.handbrake;
    input.consume('jump');
    if (v.type.cannon) {
      v.turretYaw = Math.atan2(Math.sin(rig.lookHeading - v.heading), Math.cos(rig.lookHeading - v.heading));
      if (input.consume('attack') && v.reload <= 0) { v.reload = 1.2; this.game.fireShell(v, 'player'); }
    } else {
      input.consume('attack');
    }
    // the body rides along so the player pops out where the vehicle is
    this.body.place(v.pos.x, v.pos.z);
    this.heading = v.heading;
    if (this.avatar.root.visible) {
      // sitting on the bike saddle (seat top ≈0.89m, sit pose hips at 0.62m)
      const seat = v.toWorld(-0.35, 0);
      this.avatar.root.position.set(seat.x, 0.27, seat.z);
      this.avatar.root.rotation.set(0, v.heading, 0);
      this.avatar.root.rotateZ(v.model.body.rotation.z);
    } else {
      // hidden inside, but keep `position` meaningful for everything that tracks the player
      this.avatar.root.position.copy(v.pos);
    }
    this.avatar.update(dt);
    this.prompt = `<kbd>F</kbd> Exit${v.type.cannon ? ' · <kbd>Click</kbd> Fire cannon' : ''}`;
    if (input.consume('enter')) this.exitVehicle();
  }

  animate(dt, running) {
    const horizontal = this.body.horizontalSpeed;
    this.avatar.setSpeed(horizontal);
    // short grace period so tiny bumps don't flicker into the jump pose
    if (this.body.airTime > 0.12) this.avatar.play('jump');
    else if (horizontal < 0.4) this.avatar.play('idle');
    else if (running && horizontal > WALK_SPEED + 0.5) this.avatar.play('run');
    else this.avatar.play('walk');
    this.avatar.update(dt);
  }
}
