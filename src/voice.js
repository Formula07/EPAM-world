import { clamp, headingTo, wrapAngle } from './utils.js';

const FULL_VOLUME_RANGE = 8;   // metres: full volume
const SILENT_RANGE = 60;       // metres: inaudible beyond this

// Open-mic proximity voice chat. Remote voices are routed through Web Audio so they get
// quieter with distance and pan left/right by where the speaker is relative to the camera.
export class Voice {
  constructor(sfx) {
    this.sfx = sfx;
    this.stream = null;
    this.muted = false;
    this.voices = new Map();   // peer id -> { audio, gain, pan, analyser, data, level }
  }

  async startMic() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      console.warn('Microphone unavailable', e);
      this.stream = null;
    }
    return this.stream;
  }

  toggleMute() {
    this.muted = !this.muted;
    for (const track of this.stream?.getAudioTracks() ?? []) track.enabled = !this.muted;
    return this.muted;
  }

  add(id, stream) {
    this.remove(id);
    this.sfx.unlock();
    const ctx = this.sfx.ctx;
    if (!ctx) return;
    // Chrome only starts decoding remote WebRTC audio once it's attached to a media element
    const audio = new Audio();
    audio.muted = true;
    audio.srcObject = stream;
    audio.play().catch(() => {});
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const pan = ctx.createStereoPanner();
    source.connect(analyser);
    source.connect(gain).connect(pan).connect(ctx.destination);
    this.voices.set(id, { audio, source, gain, pan, analyser, data: new Uint8Array(analyser.fftSize), level: 0 });
  }

  remove(id) {
    const v = this.voices.get(id);
    if (!v) return;
    v.source.disconnect();
    v.pan.disconnect();
    v.audio.srcObject = null;
    this.voices.delete(id);
  }

  // listener: {x, z} of the local player; remotes: RemotePlayers
  update(listener, lookHeading, remotes) {
    const ctx = this.sfx.ctx;
    if (!ctx) return;
    for (const [id, v] of this.voices) {
      const r = remotes.get(id);
      if (!r) continue;
      const d = Math.hypot(r.x - listener.x, r.z - listener.z);
      const volume = clamp(1 - (d - FULL_VOLUME_RANGE) / (SILENT_RANGE - FULL_VOLUME_RANGE), 0, 1);
      const side = wrapAngle(headingTo(listener, r) - lookHeading);   // negative = to the right
      v.gain.gain.setTargetAtTime(volume * volume, ctx.currentTime, 0.1);
      v.pan.pan.setTargetAtTime(d < 1.5 ? 0 : clamp(-Math.sin(side), -1, 1) * 0.8, ctx.currentTime, 0.1);

      // speaking indicator for the HUD
      v.analyser.getByteTimeDomainData(v.data);
      let sum = 0;
      for (const s of v.data) sum += (s - 128) ** 2;
      const rms = Math.sqrt(sum / v.data.length) / 128;
      v.level += (rms - v.level) * 0.3;
      r.speaking = v.level > 0.02 && !r.muted;
    }
  }
}
