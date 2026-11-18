import * as THREE from 'three';

const sphere = new THREE.SphereGeometry(1, 16, 12);
const spark = new THREE.OctahedronGeometry(0.08, 0);

// Short-lived particles: explosions, smoke, hit sparks. Each entry animates itself until it returns false.
export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this.shake = 0;
    // one persistent light: adding/removing lights would force every material to recompile
    this.flash = new THREE.PointLight('#ffa040', 0, 30, 2);
    scene.add(this.flash);
  }

  add(mesh, life, tick) {
    this.scene.add(mesh);
    this.items.push({ mesh, life, t: 0, tick });
  }

  explosion(pos, radius = 5) {
    const fire = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    fire.position.copy(pos);
    this.add(fire, 0.55, (m, u) => {
      m.scale.setScalar(radius * (0.3 + 0.9 * Math.sqrt(u)));
      m.material.opacity = 1 - u;
      m.material.color.setHSL(0.09 - 0.07 * u, 1, 0.6 - 0.3 * u);
    });
    this.flash.position.copy(pos).setY(pos.y + 1.5);
    this.flash.distance = radius * 6;
    this.flash.intensity = 400;
    for (let i = 0; i < 8; i++) this.smoke(pos, radius * 0.5, 2 + Math.random());
    this.sparks(pos, '#ffcf6e', 14, 9);
    this.shake = Math.min(1.5, this.shake + 1);
  }

  smoke(pos, spread = 0.5, life = 1.6) {
    const m = new THREE.Mesh(sphere, new THREE.MeshStandardMaterial({ color: '#3a3a3a', transparent: true, depthWrite: false, roughness: 1 }));
    m.position.set(pos.x + (Math.random() - 0.5) * spread * 2, pos.y + Math.random() * spread, pos.z + (Math.random() - 0.5) * spread * 2);
    const rise = 1.5 + Math.random() * 1.5;
    const size = 0.4 + Math.random() * 0.6;
    this.add(m, life, (mesh, u, dt) => {
      mesh.position.y += rise * dt;
      mesh.scale.setScalar(size * (1 + u * 2.5));
      mesh.material.opacity = 0.7 * (1 - u);
    });
  }

  sparks(pos, color = '#ffffff', count = 6, speed = 4) {
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, toneMapped: false });
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(spark, material);
      m.position.copy(pos);
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.5 + Math.random()));
      this.add(m, 0.35, (mesh, u, dt) => {
        v.y -= 20 * dt;
        mesh.position.addScaledVector(v, dt);
        mesh.material.opacity = 1 - u;
      });
    }
  }

  update(dt) {
    this.shake *= Math.exp(-5 * dt);
    this.flash.intensity *= Math.exp(-8 * dt);
    this.items = this.items.filter(item => {
      item.t += dt;
      const u = Math.min(1, item.t / item.life);
      item.tick(item.mesh, u, dt);
      if (u < 1) return true;
      this.scene.remove(item.mesh);
      item.mesh.material.dispose();
      return false;
    });
  }
}
