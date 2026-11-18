import * as THREE from 'three';
import { EPAM_CYAN, brandTexture } from './branding.js';
import { LAPTOPS, createLaptopMesh } from './weapons.js';
import { dist2d, randRange } from './utils.js';

const CASH_LIFE = 45;
const WEAPON_RESPAWN = 40;
const COFFEE_RESPAWN = 60;

const billGeo = new THREE.BoxGeometry(0.34, 0.07, 0.17);
const bandGeo = new THREE.BoxGeometry(0.06, 0.075, 0.175);
const ringGeo = new THREE.RingGeometry(0.45, 0.55, 32).rotateX(-Math.PI / 2);
const cupGeo = new THREE.CylinderGeometry(0.09, 0.07, 0.22, 16);
const lidGeo = new THREE.CylinderGeometry(0.095, 0.095, 0.03, 16);
const sleeveGeo = new THREE.CylinderGeometry(0.087, 0.078, 0.08, 16, 1, true);
let mats = null;
function materials() {
  mats ??= {
    bill: new THREE.MeshStandardMaterial({ color: '#4caf50', emissive: '#1b5e20', emissiveIntensity: 0.6, roughness: 0.6 }),
    band: new THREE.MeshStandardMaterial({ color: EPAM_CYAN, roughness: 0.5 }),
    cup: new THREE.MeshStandardMaterial({ color: '#f4f1ea', roughness: 0.6 }),
    lid: new THREE.MeshStandardMaterial({ color: '#2b1d14', roughness: 0.6 }),
    sleeve: new THREE.MeshStandardMaterial({ map: brandTexture('', { bg: '#15181d', w: 512, h: 128 }), roughness: 0.6, side: THREE.DoubleSide }),
    ring: {
      cash: new THREE.MeshBasicMaterial({ color: '#6fd36f', transparent: true, opacity: 0.7, toneMapped: false }),
      laptop: new THREE.MeshBasicMaterial({ color: EPAM_CYAN, transparent: true, opacity: 0.7, toneMapped: false }),
      coffee: new THREE.MeshBasicMaterial({ color: '#e0a060', transparent: true, opacity: 0.7, toneMapped: false }),
    },
  };
  return mats;
}

function cashMesh() {
  const m = materials();
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const bill = new THREE.Mesh(billGeo, m.bill);
    bill.position.y = i * 0.075;
    bill.rotation.y = (i - 1) * 0.2;
    const band = new THREE.Mesh(bandGeo, m.band);
    bill.add(band);
    g.add(bill);
  }
  return g;
}

function coffeeMesh() {
  const m = materials();
  const g = new THREE.Group();
  g.add(new THREE.Mesh(cupGeo, m.cup));
  const lid = new THREE.Mesh(lidGeo, m.lid);
  lid.position.y = 0.125;
  const sleeve = new THREE.Mesh(sleeveGeo, m.sleeve);
  g.add(lid, sleeve);
  g.scale.setScalar(1.6);
  return g;
}

// Collectibles: EPAM money, laptop weapons and coffee (health).
export class Pickups {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.timers = [];   // fixed spots waiting to respawn
    for (const s of game.world.laptopSpots) this.add('laptop', s.x, s.z, { type: s.type, spot: s });
    for (const s of game.world.coffeeSpots) this.add('coffee', s.x, s.z, { spot: s });
  }

  add(kind, x, z, opts = {}) {
    const holder = new THREE.Group();
    holder.position.set(x, 0, z);
    const item = kind === 'cash' ? cashMesh() : kind === 'coffee' ? coffeeMesh() : createLaptopMesh(opts.type);
    if (kind === 'laptop') { item.scale.setScalar(1.8); item.rotation.x = -0.5; }
    const spinner = new THREE.Group();
    spinner.add(item);
    holder.add(spinner);
    const ring = new THREE.Mesh(ringGeo, materials().ring[kind]);
    ring.position.y = 0.05;
    holder.add(ring);
    this.game.scene.add(holder);
    const p = { kind, x, z, holder, spinner, phase: Math.random() * 6, age: 0, ...opts };
    this.list.push(p);
    return p;
  }

  dropCash(pos, amount) {
    const bundles = amount > 100 ? 3 : amount > 50 ? 2 : 1;
    for (let i = 0; i < bundles; i++) {
      const a = Math.random() * Math.PI * 2, r = randRange(0.4, 1.4);
      this.add('cash', pos.x + Math.cos(a) * r, pos.z + Math.sin(a) * r, { amount: Math.round(amount / bundles) });
    }
  }

  dropLaptop(pos, type) {
    this.add('laptop', pos.x + randRange(-0.8, 0.8), pos.z + randRange(-0.8, 0.8), { type, temporary: true });
  }

  remove(p) {
    this.game.scene.remove(p.holder);
    this.list.splice(this.list.indexOf(p), 1);
    if (p.spot) this.timers.push({ spot: p.spot, kind: p.kind, type: p.type, t: p.kind === 'coffee' ? COFFEE_RESPAWN : WEAPON_RESPAWN });
  }

  update(dt) {
    const player = this.game.player;
    const pos = player.vehicle ? player.vehicle.pos : player.position;
    for (const p of [...this.list]) {
      p.age += dt;
      p.phase += dt;
      p.spinner.rotation.y += dt * 2;
      p.spinner.position.y = 0.55 + Math.sin(p.phase * 2.5) * 0.12;
      if ((p.kind === 'cash' || p.temporary) && p.age > CASH_LIFE) { this.remove(p); continue; }
      if (player.dead) continue;
      // money can be scooped up from a vehicle, everything else needs you on foot
      const reach = player.vehicle ? (p.kind === 'cash' ? player.vehicle.radius : -1) : 1.1;
      if (dist2d(p, pos) > reach || p.age < 0.4) continue;
      if (this.collect(p)) this.remove(p);
    }
    this.timers = this.timers.filter(t => {
      t.t -= dt;
      if (t.t > 0) return true;
      this.add(t.kind, t.spot.x, t.spot.z, { type: t.type, spot: t.spot });
      return false;
    });
  }

  collect(p) {
    const game = this.game;
    const player = game.player;
    if (p.kind === 'cash') {
      player.addMoney(p.amount);
      game.sfx.cash();
      return true;
    }
    if (p.kind === 'coffee') {
      if (player.health >= player.maxHealth) return false;
      player.health = Math.min(player.maxHealth, player.health + 30);
      game.hud.toast('EPAM coffee: +30 health');
      game.sfx.pickup();
      return true;
    }
    const isNew = player.giveWeapon(p.type);
    game.hud.toast(isNew ? `Picked up ${LAPTOPS[p.type].name}` : `${LAPTOPS[p.type].name} sold for $100`);
    if (!isNew) player.addMoney(100);
    game.sfx.pickup();
    return true;
  }

  // positions for minimap blips
  get blips() { return this.list; }
}
