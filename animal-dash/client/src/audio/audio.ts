// Procedural audio: every sound effect is synthesised with WebAudio and the music is a
// small step sequencer. No external audio assets are needed.

export interface AudioSettings { master: number; music: number; sfx: number; muted: boolean; }

type Sfx = 'step' | 'jump' | 'land' | 'slide' | 'boost' | 'item' | 'use' | 'hit' | 'knock' | 'fall' | 'recover' | 'count' | 'go'
  | 'finish' | 'victory' | 'click' | 'gate' | 'pickup' | 'cluck' | 'explode' | 'freeze' | 'shield' | 'rocket' | 'ability' | 'slip' | 'whoosh' | 'error';

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode; private musicBus!: GainNode; private sfxBus!: GainNode;
  private noise!: AudioBuffer;
  settings: AudioSettings = { master: 0.8, music: 0.55, sfx: 0.8, muted: false };
  private musicTimer: number | null = null;
  private musicKind: 'menu' | 'race' | null = null;
  private step = 0;
  private nextTime = 0;
  private crowd: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  intensity = 0; // 0..1 drives music energy during races

  /** Must be called from a user gesture (browser autoplay policy). */
  unlock(): void {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(this.ctx.destination);
    this.musicBus = this.ctx.createGain(); this.musicBus.connect(this.master);
    this.sfxBus = this.ctx.createGain(); this.sfxBus.connect(this.master);
    const len = this.ctx.sampleRate * 1.5;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.applySettings();
    if (this.musicKind) { const k = this.musicKind; this.musicKind = null; this.startMusic(k); }
  }

  applySettings(): void {
    if (!this.ctx) return;
    const s = this.settings;
    this.master.gain.value = s.muted ? 0 : s.master;
    this.musicBus.gain.value = s.music * 0.5;
    this.sfxBus.gain.value = s.sfx;
  }

  // ------------------------------------------------------------------ helpers
  private env(g: GainNode, t: number, a: number, peak: number, dur: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }
  private osc(type: OscillatorType, f0: number, f1: number, t: number, dur: number, vol: number, bus: AudioNode, pan = 0): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    this.env(g, t, 0.005, vol, dur);
    let out: AudioNode = g;
    if (pan) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
    o.connect(g); out.connect(bus);
    o.start(t); o.stop(t + dur + 0.05);
  }
  private noiseHit(t: number, dur: number, vol: number, freq: number, q: number, bus: AudioNode, type: BiquadFilterType = 'bandpass', sweepTo = 0, pan = 0): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain(); this.env(g, t, 0.004, vol, dur);
    let out: AudioNode = g;
    if (pan) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
    src.connect(f); f.connect(g); out.connect(bus);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }

  play(name: Sfx, vol = 1, pan = 0): void {
    if (!this.ctx || this.settings.muted) return;
    const t = this.ctx.currentTime + 0.005;
    const b = this.sfxBus;
    switch (name) {
      case 'step': this.noiseHit(t, 0.06, 0.18 * vol, 300 + Math.random() * 200, 1.2, b, 'lowpass', 0, pan); break;
      case 'jump': this.osc('square', 260, 620, t, 0.16, 0.12 * vol, b, pan); this.noiseHit(t, 0.1, 0.12 * vol, 1500, 1, b, 'highpass'); break;
      case 'land': this.osc('sine', 140, 50, t, 0.14, 0.4 * vol, b, pan); this.noiseHit(t, 0.12, 0.2 * vol, 500, 1, b, 'lowpass'); break;
      case 'slide': this.noiseHit(t, 0.45, 0.25 * vol, 2500, 0.7, b, 'bandpass', 600, pan); break;
      case 'boost': this.osc('sawtooth', 120, 480, t, 0.35, 0.12 * vol, b); this.noiseHit(t, 0.4, 0.2 * vol, 800, 0.6, b, 'bandpass', 4000); break;
      case 'whoosh': this.noiseHit(t, 0.35, 0.22 * vol, 400, 0.8, b, 'bandpass', 3000, pan); break;
      case 'item': [523, 659, 784, 1046].forEach((f, i) => this.osc('triangle', f, f, t + i * 0.055, 0.12, 0.16 * vol, b)); break;
      case 'use': this.osc('square', 880, 440, t, 0.15, 0.1 * vol, b); break;
      case 'hit': this.osc('square', 180, 60, t, 0.2, 0.25 * vol, b, pan); this.noiseHit(t, 0.18, 0.35 * vol, 900, 0.8, b, 'bandpass', 0, pan); break;
      case 'knock': this.osc('sawtooth', 300, 40, t, 0.6, 0.2 * vol, b, pan); this.noiseHit(t, 0.3, 0.35 * vol, 400, 1, b, 'lowpass'); [1200, 1500, 1800].forEach((f, i) => this.osc('sine', f, f * 1.1, t + 0.25 + i * 0.08, 0.1, 0.06 * vol, b)); break;
      case 'fall': this.osc('sine', 900, 120, t, 0.9, 0.18 * vol, b, pan); break;
      case 'recover': [392, 523, 659].forEach((f, i) => this.osc('triangle', f, f, t + i * 0.06, 0.12, 0.12 * vol, b)); break;
      case 'count': this.osc('square', 440, 440, t, 0.2, 0.2 * vol, b); break;
      case 'go': this.osc('square', 880, 880, t, 0.5, 0.22 * vol, b); this.osc('square', 1320, 1320, t, 0.5, 0.1 * vol, b); break;
      case 'finish': [523, 659, 784, 1046, 1318].forEach((f, i) => this.osc('square', f, f, t + i * 0.09, 0.25, 0.12 * vol, b)); this.noiseHit(t, 1.2, 0.2 * vol, 3000, 0.4, b); break;
      case 'victory': [[523, 0], [659, 0.15], [784, 0.3], [1046, 0.45], [784, 0.65], [1046, 0.8]].forEach(([f, d]) => this.osc('square', f, f, t + d, 0.22, 0.13 * vol, b)); break;
      case 'click': this.osc('triangle', 1200, 900, t, 0.05, 0.12 * vol, b); break;
      case 'error': this.osc('square', 200, 150, t, 0.2, 0.12 * vol, b); break;
      case 'gate': this.osc('sine', 600, 1500, t, 0.25, 0.18 * vol, b, pan); this.noiseHit(t, 0.3, 0.15 * vol, 2000, 0.5, b, 'highpass'); break;
      case 'pickup': this.osc('sine', 880, 1760, t, 0.15, 0.15 * vol, b, pan); break;
      case 'cluck': for (let i = 0; i < 3; i++) { this.osc('square', 700 + Math.random() * 200, 400, t + i * 0.07, 0.06, 0.1 * vol, b); } break;
      case 'explode': this.osc('sine', 120, 30, t, 0.7, 0.6 * vol, b); this.noiseHit(t, 0.8, 0.6 * vol, 1200, 0.5, b, 'lowpass', 100); break;
      case 'freeze': [1568, 2093, 2637, 3136].forEach((f, i) => this.osc('sine', f, f, t + i * 0.04, 0.4, 0.07 * vol, b)); this.noiseHit(t, 0.5, 0.15 * vol, 6000, 1, b, 'highpass'); break;
      case 'shield': this.osc('sine', 500, 1000, t, 0.3, 0.2 * vol, b); this.osc('sine', 750, 1500, t, 0.3, 0.12 * vol, b); break;
      case 'rocket': this.noiseHit(t, 1.0, 0.4 * vol, 300, 0.5, b, 'lowpass', 1500); this.osc('sawtooth', 80, 200, t, 0.8, 0.12 * vol, b); break;
      case 'ability': this.osc('sawtooth', 220, 880, t, 0.3, 0.14 * vol, b); this.osc('square', 330, 1320, t + 0.05, 0.25, 0.08 * vol, b); break;
      case 'slip': this.osc('sine', 1200, 200, t, 0.35, 0.2 * vol, b, pan); break;
    }
  }

  // ------------------------------------------------------------------ crowd ambience
  setCrowd(on: boolean, level = 0.15): void {
    if (!this.ctx) return;
    if (on && !this.crowd) {
      const src = this.ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
      const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.6;
      const g = this.ctx.createGain(); g.gain.value = level;
      src.connect(f); f.connect(g); g.connect(this.sfxBus); src.start();
      this.crowd = { src, gain: g };
    } else if (!on && this.crowd) { this.crowd.src.stop(); this.crowd = null; }
    else if (on && this.crowd) this.crowd.gain.gain.value = level;
  }
  cheer(): void { if (this.ctx) this.noiseHit(this.ctx.currentTime, 1.6, 0.35, 1100, 0.5, this.sfxBus); }

  // ------------------------------------------------------------------ music
  startMusic(kind: 'menu' | 'race'): void {
    if (this.musicKind === kind) return;
    this.musicKind = kind;
    if (!this.ctx) return;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.1;
    if (this.musicTimer === null) this.musicTimer = window.setInterval(() => this.schedule(), 25);
  }
  stopMusic(): void {
    this.musicKind = null;
    if (this.musicTimer !== null) { clearInterval(this.musicTimer); this.musicTimer = null; }
  }

  private schedule(): void {
    if (!this.ctx || !this.musicKind) return;
    const race = this.musicKind === 'race';
    const bpm = race ? 150 : 112;
    const stepDur = 60 / bpm / 4;
    while (this.nextTime < this.ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextTime, race);
      this.nextTime += stepDur;
      this.step++;
    }
  }

  private playStep(step: number, t: number, race: boolean): void {
    const b = this.musicBus;
    const s16 = step % 16;
    const bar = Math.floor(step / 16) % 4;
    const prog = race ? [[0, 4, 7], [-3, 0, 4], [5, 9, 12], [7, 11, 14]] : [[0, 4, 7], [7, 11, 14], [-3, 0, 4], [5, 9, 12]];
    const root = 261.63 * (race ? 1 : 0.75);
    const note = (semi: number) => root * Math.pow(2, semi / 12);
    const chord = prog[bar];
    // drums
    if (s16 % 4 === 0) { this.osc('sine', 150, 40, t, 0.18, race ? 0.55 : 0.35, b); }
    if (s16 === 4 || s16 === 12) this.noiseHit(t, 0.14, race ? 0.3 : 0.18, 1800, 0.8, b);
    if (s16 % 2 === 0 || race) this.noiseHit(t, 0.04, race ? 0.08 + this.intensity * 0.05 : 0.05, 8000, 1, b, 'highpass');
    // bass
    if (race ? s16 % 2 === 0 : s16 % 4 === 0) this.osc('triangle', note(chord[0] - 12), note(chord[0] - 12), t, 0.16, 0.28, b);
    // arpeggio lead
    const arp = [0, 1, 2, 1, 2, 0, 1, 2];
    if (s16 % 2 === 0) {
      const n = chord[arp[(s16 / 2) % 8]] + (race && bar % 2 ? 12 : 0);
      this.osc(race ? 'square' : 'triangle', note(n), note(n), t, 0.11, race ? 0.06 : 0.07, b);
    }
    // melody hook every other bar
    const melody = race ? [12, -1, 14, -1, 16, 14, 12, -1, 11, -1, 12, 14, 7, -1, -1, -1] : [7, -1, -1, 9, -1, -1, 12, -1, 11, -1, 9, -1, 7, -1, -1, -1];
    if (bar % 2 === 1 && melody[s16] >= 0) this.osc('sawtooth', note(melody[s16]), note(melody[s16]), t, 0.18, 0.045, b);
  }
}

export const audio = new AudioEngine();
