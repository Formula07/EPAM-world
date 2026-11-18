// Tiny synthesized sound effects (no audio files needed). Must be unlocked by a user gesture.
export class Sfx {
  constructor() {
    this.ctx = null;
    this.sirenLevel = 0;
  }

  unlock() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.35;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this.siren = this.ctx.createOscillator();
    this.siren.type = 'triangle';
    this.sirenGain = this.ctx.createGain();
    this.sirenGain.gain.value = 0;
    this.siren.connect(this.sirenGain).connect(this.master);
    this.siren.start();
  }

  tone(freq, dur, { type = 'sine', to = freq, gain = 0.3, delay = 0 } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  noise(dur, { gain = 0.4, cutoff = 1200, delay = 0 } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, t);
    filter.frequency.exponentialRampToValueAtTime(80, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  punch() { this.noise(0.12, { gain: 0.5, cutoff: 900 }); this.tone(140, 0.12, { to: 60, gain: 0.4 }); }
  whoosh() { this.noise(0.15, { gain: 0.12, cutoff: 3000 }); }
  cash() { this.tone(988, 0.08, { type: 'square', gain: 0.12 }); this.tone(1319, 0.25, { type: 'square', gain: 0.12, delay: 0.08 }); }
  pickup() { this.tone(523, 0.1, { type: 'triangle', gain: 0.2 }); this.tone(784, 0.2, { type: 'triangle', gain: 0.2, delay: 0.1 }); }
  explosion() { this.noise(1.2, { gain: 0.9, cutoff: 1600 }); this.tone(80, 0.8, { to: 30, gain: 0.5 }); }
  cannon() { this.noise(0.4, { gain: 0.6, cutoff: 2500 }); this.tone(120, 0.3, { to: 40, gain: 0.4 }); }
  crash() { this.noise(0.35, { gain: 0.5, cutoff: 2000 }); }
  hurt() { this.tone(220, 0.18, { type: 'sawtooth', to: 120, gain: 0.15 }); }
  cheat() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.15, { type: 'square', gain: 0.1, delay: i * 0.08 })); }
  wanted() { this.tone(660, 0.12, { type: 'square', gain: 0.08 }); this.tone(440, 0.2, { type: 'square', gain: 0.08, delay: 0.12 }); }
  door() { this.tone(300, 0.08, { type: 'square', to: 200, gain: 0.1 }); }

  // level 0..1 = how loud the nearest police siren is
  update(time, level) {
    if (!this.ctx) return;
    this.sirenLevel += (level - this.sirenLevel) * 0.1;
    this.sirenGain.gain.value = this.sirenLevel * 0.06;
    this.siren.frequency.value = 900 + 350 * Math.sin(time * 4.5);
  }
}
