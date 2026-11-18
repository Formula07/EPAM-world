import * as THREE from 'three';
import { Capsule } from 'three/addons/math/Capsule.js';

export const GRAVITY = 30;
const FLOOR_NORMAL_Y = 0.55; // anything steeper than ~56° counts as a wall
const FALL_LIMIT = -25;

const _delta = new THREE.Vector3();

// Capsule vs. octree walker shared by the player and every NPC.
export class CharacterBody {
  constructor(octree, { radius = 0.35, height = 1.8, substeps = 3 } = {}) {
    this.octree = octree;
    this.radius = radius;
    this.height = height;
    this.substeps = substeps;   // more substeps keep fast movement from tunnelling through thin walls
    this.collider = new Capsule(new THREE.Vector3(), new THREE.Vector3(), radius);
    this.velocity = new THREE.Vector3();
    this.onFloor = false;
    this.airTime = 0;
    this.gravityScale = 1;
  }

  get x() { return this.collider.start.x; }
  get z() { return this.collider.start.z; }
  get feetY() { return this.collider.start.y - this.radius; }
  get horizontalSpeed() { return Math.hypot(this.velocity.x, this.velocity.z); }

  place(x, z, y = 0) {
    this.collider.start.set(x, y + this.radius, z);
    this.collider.end.set(x, y + this.height - this.radius, z);
    this.velocity.set(0, 0, 0);
  }

  // Steer the horizontal velocity toward (wishX, wishZ) * speed, then integrate.
  move(dt, wishX, wishZ, speed, jumpSpeed = 0) {
    const control = 1 - Math.exp(-(this.onFloor ? 12 : 2) * dt);
    this.velocity.x += (wishX * speed - this.velocity.x) * control;
    this.velocity.z += (wishZ * speed - this.velocity.z) * control;
    if (jumpSpeed && this.onFloor) this.velocity.y = jumpSpeed;
    this.integrate(dt);
  }

  // Uncontrolled sliding (knocked down, dead): ground friction only.
  slide(dt, friction = 4) {
    if (this.onFloor) {
      const f = Math.exp(-friction * dt);
      this.velocity.x *= f;
      this.velocity.z *= f;
    }
    this.integrate(dt);
  }

  integrate(dt) {
    const step = dt / this.substeps;
    for (let i = 0; i < this.substeps; i++) {
      this.velocity.y -= GRAVITY * this.gravityScale * step;
      this.collider.translate(_delta.copy(this.velocity).multiplyScalar(step));
      this.resolveCollisions();
    }
    this.airTime = this.onFloor ? 0 : this.airTime + dt;
    return this.collider.end.y < FALL_LIMIT;   // true = fell out of the world
  }

  resolveCollisions() {
    this.onFloor = false;
    const hit = this.octree.capsuleIntersect(this.collider);
    if (!hit) return;
    const { normal, depth } = hit;
    if (normal.y > FLOOR_NORMAL_Y) {
      this.onFloor = true;
      if (this.velocity.y < 0) this.velocity.y = 0;
    } else {
      // wall or ceiling: drop the part of the velocity that points into it, keep sliding along it
      const into = normal.dot(this.velocity);
      if (into < 0) this.velocity.addScaledVector(normal, -into);
    }
    this.collider.translate(_delta.copy(normal).multiplyScalar(depth));
  }

  // Positional nudge (character separation, vehicle push-out). Walls are resolved on the next step.
  nudge(dx, dz) {
    this.collider.translate(_delta.set(dx, 0, dz));
  }

  knock(vx, vz, vy = 3) {
    this.velocity.set(vx, Math.max(this.velocity.y, vy), vz);
    this.onFloor = false;
  }

  syncTo(object, heading) {
    object.position.set(this.collider.start.x, this.feetY, this.collider.start.z);
    object.rotation.y = heading;
  }
}
