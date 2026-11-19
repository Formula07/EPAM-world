const FORWARD = ['KeyW', 'ArrowUp'];
const BACK = ['KeyS', 'ArrowDown'];
const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];
const RUN = ['ShiftLeft', 'ShiftRight'];

// One-shot actions, queued on key down and consumed once by the game.
const ACTIONS = {
  Space: 'jump',
  KeyF: 'enter',
  Enter: 'enter',
  KeyE: 'steal',
  KeyQ: 'cycle',
  Tab: 'help',
  KeyV: 'mute',
};

export class Input {
  constructor(dom) {
    this.keys = new Set();
    this.queued = new Set();
    this.onKey = null;      // raw key feed (cheat codes)
    addEventListener('keydown', e => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
      if (!e.repeat) {
        const action = ACTIONS[e.code];
        if (action) this.queued.add(action);
        this.onKey?.(e.code);
      }
      this.keys.add(e.code);
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    dom.addEventListener('mousedown', e => {
      if (e.button === 0 && document.pointerLockElement === dom) this.queued.add('attack');
    });
  }

  any(codes) { return codes.some(c => this.keys.has(c)); }

  get axis() {
    return {
      x: (this.any(RIGHT) ? 1 : 0) - (this.any(LEFT) ? 1 : 0),
      y: (this.any(FORWARD) ? 1 : 0) - (this.any(BACK) ? 1 : 0),
    };
  }

  get run() { return this.any(RUN); }
  get handbrake() { return this.keys.has('Space'); }

  consume(action) {
    const queued = this.queued.has(action);
    this.queued.delete(action);
    return queued;
  }

  clearQueue() { this.queued.clear(); }
}
