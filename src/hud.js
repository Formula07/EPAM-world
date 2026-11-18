import { CHEATS } from './cheats.js';

const PX_PER_M_FOOT = 1.6;
const PX_PER_M_DRIVE = 0.85;
const PICKUP_COLORS = { cash: '#6fd36f', laptop: '#39c2d7', coffee: '#d9955a' };

const $ = id => document.getElementById(id);

// GTA-style overlay: money, wanted stars, health/armor, weapon, prompts, toasts and the radar.
export class Hud {
  constructor(map) {
    this.map = map;
    this.root = $('hud');
    this.canvas = $('minimap');
    this.ctx = this.canvas.getContext('2d');
    this.el = {
      money: $('money'), moneyPop: $('money-pop'), stars: $('wanted'), health: $('health-bar').firstElementChild,
      armorBar: $('armor-bar'), armor: $('armor-bar').firstElementChild, weapon: $('weapon-name'),
      prompt: $('prompt'), toasts: $('toasts'), vehicle: $('vehicle-name'), big: $('big-message'),
      flash: $('damage-flash'), help: $('help'), lockHint: $('lock-hint'),
    };
    this.shownMoney = 0;
    this.time = 0;
    this.scale = PX_PER_M_FOOT;
    this.lastPrompt = null;
    this.vehicleTimer = 0;
    this.popTimer = 0;
    this.popAmount = 0;
    this.stars = [];
    for (let i = 0; i < 5; i++) {
      const s = document.createElement('i');
      s.textContent = '★';
      this.el.stars.appendChild(s);
      this.stars.push(s);
    }
    this.buildHelp();
    document.addEventListener('pointerlockchange', () => {
      this.el.lockHint.hidden = document.pointerLockElement !== null;
    });
  }

  buildHelp() {
    const controls = [
      ['W A S D', 'Move / drive'], ['Shift', 'Run'], ['Space', 'Jump / handbrake'], ['Mouse', 'Look · aim tank turret'],
      ['Click', 'Punch · swing laptop · fire cannon'], ['F', 'Enter / exit vehicle'], ['E', 'Snatch a laptop (near someone carrying one)'],
      ['Q', 'Switch weapon'], ['Wheel', 'Camera zoom'], ['Tab', 'Toggle this help'], ['Esc', 'Free the cursor'],
    ];
    const rows = list => list.map(([k, d]) => `<tr><td>${k}</td><td>${d}</td></tr>`).join('');
    this.el.help.innerHTML = `
      <h2>Controls</h2><table>${rows(controls)}</table>
      <h2>Cheat codes <small>just type them while playing</small></h2>
      <table class="cheats">${rows(CHEATS.map(c => [c.code, c.desc]))}</table>`;
  }

  show(name, avatarName) {
    $('hud-name').textContent = name;
    $('hud-avatar').textContent = avatarName;
    this.root.hidden = false;
  }

  toggleHelp() { this.el.help.hidden = !this.el.help.hidden; }

  toast(text, kind = '') {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = text;
    this.el.toasts.appendChild(t);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstElementChild.remove();
    setTimeout(() => t.classList.add('out'), 3200);
    setTimeout(() => t.remove(), 3700);
  }

  moneyPopup(amount) {
    this.popAmount = this.popTimer > 0 ? this.popAmount + amount : amount;
    this.popTimer = 1.6;
    this.el.moneyPop.textContent = `+$${this.popAmount.toLocaleString()}`;
    this.el.moneyPop.hidden = false;
  }

  vehicleName(name) {
    this.el.vehicle.textContent = name;
    this.el.vehicle.hidden = false;
    this.vehicleTimer = 2.5;
  }

  bigMessage(text, kind = '') {
    this.el.big.textContent = text;
    this.el.big.className = kind;
    this.el.big.hidden = !text;
  }

  flashDamage() {
    const f = this.el.flash;
    f.classList.remove('on');
    void f.offsetWidth;    // restart the CSS animation
    f.classList.add('on');
  }

  update(dt, game) {
    this.time += dt;
    const { player, police } = game;

    // money counts up like the GTA bankroll
    const diff = player.money - this.shownMoney;
    this.shownMoney = Math.abs(diff) < 1 ? player.money : this.shownMoney + diff * (1 - Math.exp(-6 * dt)) + Math.sign(diff);
    if (Math.sign(player.money - this.shownMoney) !== Math.sign(diff)) this.shownMoney = player.money;
    this.el.money.textContent = '$' + String(Math.round(this.shownMoney)).padStart(8, '0');
    this.popTimer -= dt;
    if (this.popTimer <= 0) this.el.moneyPop.hidden = true;

    const blinkOff = police.searching && Math.floor(this.time * 3) % 2 === 0;
    this.stars.forEach((s, i) => s.classList.toggle('on', i < police.level && !blinkOff));
    this.el.stars.classList.toggle('active', police.level > 0);

    this.el.health.style.width = `${(player.health / player.maxHealth) * 100}%`;
    this.el.health.parentElement.classList.toggle('low', player.health < 30);
    this.el.armorBar.hidden = player.armor <= 0;
    this.el.armor.style.width = `${player.armor}%`;
    this.el.weapon.textContent = player.vehicle?.type.cannon ? 'Tank Cannon' : player.weapon.name;

    if (player.prompt !== this.lastPrompt) {
      this.lastPrompt = player.prompt;
      this.el.prompt.innerHTML = player.prompt ?? '';
      this.el.prompt.hidden = !player.prompt;
    }
    this.vehicleTimer -= dt;
    if (this.vehicleTimer <= 0) this.el.vehicle.hidden = true;

    this.drawMinimap(dt, game);
  }

  drawMinimap(dt, game) {
    const { ctx, canvas } = this;
    const player = game.player;
    const yaw = game.rig.yaw;
    const pos = player.vehicle ? player.vehicle.pos : player.position;
    const wanted = player.vehicle ? PX_PER_M_DRIVE : PX_PER_M_FOOT;
    this.scale += (wanted - this.scale) * (1 - Math.exp(-3 * dt));
    const s = this.scale;
    const r = canvas.width / 2;
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    // world (x, z) -> radar pixels, rotated so the camera's view direction is up
    const toScreen = (x, z) => {
      const dx = (x - pos.x) * s, dz = (z - pos.z) * s;
      return { x: r + dx * cos - dz * sin, y: r + dx * sin + dz * cos };
    };

    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
    ctx.arc(r, r, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#4b6b3c';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(r, r);
    ctx.rotate(yaw);
    ctx.scale(s, s);
    ctx.translate(-pos.x, -pos.z);
    const rect = (o, color) => { ctx.fillStyle = color; ctx.fillRect(o.x - o.w / 2, o.z - o.d / 2, o.w, o.d); };
    rect(this.map.plaza, '#a7a69f');
    for (const road of this.map.roads) rect(road, '#2e3135');
    for (const b of this.map.buildings) rect(b, b.hq ? '#39c2d7' : b.police ? '#4a5f8f' : b.clinic ? '#c9d2dc' : '#8a929e');
    ctx.restore();

    const dot = (p, color, size = 3, square = false) => {
      ctx.fillStyle = color;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (square) ctx.rect(p.x - size, p.y - size, size * 2, size * 2);
      else ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    };
    const inside = p => (p.x - r) ** 2 + (p.y - r) ** 2 < (r - 4) ** 2;
    const flash = Math.floor(this.time * 4) % 2 === 0;

    for (const p of game.pickups.blips) {
      const q = toScreen(p.x, p.z);
      if (inside(q)) dot(q, PICKUP_COLORS[p.kind], p.kind === 'cash' ? 2.5 : 3, p.kind !== 'cash');
    }
    for (const v of game.vehicles.list) {
      if (v === player.vehicle || v.wrecked) continue;
      const q = toScreen(v.pos.x, v.pos.z);
      if (!inside(q)) continue;
      const color = v.isPolice || v.type.siren ? (v.sirenOn ? (flash ? '#3a7bff' : '#ff3b3b') : '#3a7bff') : v.type.cannon ? '#6b8f5a' : '#e8e8e8';
      dot(q, color, v.type.cannon ? 4 : 2.6, true);
    }
    for (const n of game.npcs.officers) {
      const q = toScreen(n.x, n.z);
      if (inside(q)) dot(q, flash ? '#3a7bff' : '#ff3b3b', 3);
    }

    // landmarks stick to the rim when far away
    const landmark = (spot, draw) => {
      let q = toScreen(spot.x, spot.z);
      const dx = q.x - r, dy = q.y - r, d = Math.hypot(dx, dy);
      if (d > r - 12) q = { x: r + (dx / d) * (r - 12), y: r + (dy / d) * (r - 12) };
      draw(q);
    };
    landmark(game.world.clinic, q => {
      ctx.fillStyle = '#fff';
      ctx.fillRect(q.x - 7, q.y - 7, 14, 14);
      ctx.fillStyle = '#e53935';
      ctx.fillRect(q.x - 5, q.y - 1.6, 10, 3.2);
      ctx.fillRect(q.x - 1.6, q.y - 5, 3.2, 10);
    });
    landmark(game.world.station, q => {
      ctx.fillStyle = '#1f3c88';
      ctx.beginPath();
      ctx.arc(q.x, q.y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('P', q.x, q.y + 0.5);
    });

    // player arrow
    const heading = player.vehicle ? player.vehicle.heading : player.heading;
    ctx.translate(r, r);
    ctx.rotate(yaw - heading);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 7);
    ctx.lineTo(5, -5);
    ctx.lineTo(0, -2.5);
    ctx.lineTo(-5, -5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // the rim flashes red/blue while wanted
    const level = game.police.level;
    canvas.style.borderColor = level > 0 ? (flash ? '#ff3b3b' : '#3a7bff') : 'rgba(0,0,0,.75)';
  }
}
