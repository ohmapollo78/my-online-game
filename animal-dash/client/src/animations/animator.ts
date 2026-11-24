// Procedural animation. The gait phase advances with *distance travelled / stride length*,
// so paws plant instead of sliding. Each state writes a target pose which the current pose
// blends toward for smooth transitions.
import { RS } from '@shared/constants';
import { B, BONE_COUNT, AnimalSpec } from '../characters/animalModels';
import { damp } from '../engine/math';

export interface AnimInput {
  state: number;
  speed: number;
  vy: number;
  grounded: boolean;
  landT: number;
  exhausted: boolean;
  boosting: boolean;
  lateral: number; // lateral velocity m/s
  victory: string; // '' or victory animation id
  dt: number;
  stride: number;
}

export const P = 9; // floats per bone: rx ry rz tx ty tz sx sy sz

export class Animator {
  pose = new Float32Array(BONE_COUNT * P);
  private target = new Float32Array(BONE_COUNT * P);
  phase = Math.random() * 6.28;
  time = Math.random() * 10;
  root = { y: 0, pitch: 0, roll: 0, yaw: 0, scale: 1 };
  private rootT = { y: 0, pitch: 0, roll: 0, yaw: 0 };
  private stateTime = 0;
  private lastState = -1;
  private blink = 0;
  private nextBlink = 2;
  tongue = 0;
  /** gait events (paw strikes) for footstep audio & dust */
  stepped = false;

  constructor(private spec: AnimalSpec) {
    for (let i = 0; i < BONE_COUNT; i++) { this.pose[i * P + 6] = this.pose[i * P + 7] = this.pose[i * P + 8] = 1; }
  }

  private set(b: number, rx: number, ry = 0, rz = 0, tx = 0, ty = 0, tz = 0, sx = 1, sy = 1, sz = 1): void {
    const o = b * P, t = this.target;
    t[o] = rx; t[o + 1] = ry; t[o + 2] = rz; t[o + 3] = tx; t[o + 4] = ty; t[o + 5] = tz; t[o + 6] = sx; t[o + 7] = sy; t[o + 8] = sz;
  }

  update(a: AnimInput): void {
    const dt = a.dt;
    this.time += dt;
    const t = this.time;
    if (a.state !== this.lastState) { this.stateTime = 0; this.lastState = a.state; }
    this.stateTime += dt;
    const st = this.stateTime;
    const s = this.spec;
    for (let i = 0; i < BONE_COUNT; i++) this.set(i, 0);
    const rt = this.rootT;
    rt.y = 0; rt.pitch = 0; rt.roll = 0; rt.yaw = 0;

    // ---- gait phase from distance travelled (no foot sliding)
    const prevPhase = this.phase;
    const gaitSpeed = a.grounded && (a.state === RS.RUN || a.state === RS.STUMBLE || a.state === RS.FINISHED || a.state === RS.RECOVER) ? a.speed : 0;
    this.phase += (gaitSpeed / a.stride) * Math.PI * 2 * dt;
    this.stepped = Math.floor(prevPhase / Math.PI) !== Math.floor(this.phase / Math.PI) && gaitSpeed > 1;
    const ph = this.phase;
    const amp = Math.min(1, a.speed / 7);
    let tongueT = a.exhausted ? 1 : 0;

    // ---- blink
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) { this.blink = 0.14; this.nextBlink = 2 + Math.random() * 3; }
    this.blink = Math.max(0, this.blink - dt);
    let eyeY = this.blink > 0 ? 0.1 : 1;

    const legs = (a1: number, a2: number, a3: number, a4: number, k1: number, k2: number, k3: number, k4: number) => {
      this.set(B.FLU, a1); this.set(B.FLL, k1);
      this.set(B.FRU, a2); this.set(B.FRL, k2);
      this.set(B.BLU, a3); this.set(B.BLL, k3);
      this.set(B.BRU, a4); this.set(B.BRL, k4);
    };
    const tailWag = (speed: number, mag: number, lift = 0) => {
      this.set(B.TAIL0, lift, Math.sin(t * speed) * mag);
      this.set(B.TAIL1, lift * 0.5, Math.sin(t * speed - 0.6) * mag);
      this.set(B.TAIL2, lift * 0.3, Math.sin(t * speed - 1.2) * mag);
    };

    const running = () => {
      const A = 0.95 * amp;
      // rotary gallop: front pair then hind pair
      const fl = Math.sin(ph), fr = Math.sin(ph + 0.4), bl = Math.sin(ph + Math.PI), br = Math.sin(ph + Math.PI + 0.4);
      const lift = (x: number) => Math.max(0, x);
      legs(
        -fl * A, -fr * A, -bl * A * 0.9, -br * A * 0.9,
        lift(Math.cos(ph)) * 1.2 * amp, lift(Math.cos(ph + 0.4)) * 1.2 * amp,
        -lift(Math.cos(ph + Math.PI)) * 1.1 * amp, -lift(Math.cos(ph + Math.PI + 0.4)) * 1.1 * amp,
      );
      const bob = Math.abs(Math.sin(ph)) * 0.06 * amp * s.scale;
      const rock = Math.sin(ph) * 0.12 * amp;
      this.set(B.BODY, rock, 0, Math.sin(ph * 0.5) * 0.03, 0, bob, 0, 1, 1 + Math.sin(ph * 2) * 0.03 * amp, 1);
      this.set(B.HEAD, -rock * 0.9 + (a.exhausted ? 0.3 : 0) - (a.boosting ? 0.12 : 0), -a.lateral * 0.04, 0);
      const earFlop = Math.sin(ph + 1.2) * 0.35 * amp;
      if (s.ear === 'flop') { this.set(B.EAR_L, earFlop - 0.2, 0, -0.2 - Math.abs(earFlop) * 0.5); this.set(B.EAR_R, earFlop - 0.2, 0, 0.2 + Math.abs(earFlop) * 0.5); }
      else { this.set(B.EAR_L, -0.25 * amp - (a.boosting ? 0.4 : 0), 0, 0.18); this.set(B.EAR_R, -0.25 * amp - (a.boosting ? 0.4 : 0), 0, -0.18); }
      tailWag(a.exhausted ? 4 : 10, a.exhausted ? 0.15 : 0.35, a.boosting ? -0.5 : 0);
      rt.roll = -a.lateral * 0.025;
      rt.yaw = a.lateral * 0.035;
    };

    switch (a.state) {
      case RS.IDLE: {
        const br = Math.sin(t * 2.2) * 0.025;
        this.set(B.BODY, 0, 0, 0, 0, br * 0.3, 0, 1 + br, 1 + br, 1);
        this.set(B.HEAD, Math.sin(t * 0.7) * 0.08, Math.sin(t * 0.45) * 0.35, Math.sin(t * 0.9) * 0.06);
        tailWag(7, 0.5);
        if (s.ear !== 'flop') { this.set(B.EAR_L, Math.max(0, Math.sin(t * 1.3 + 2)) * 0.25, 0, 0.18); this.set(B.EAR_R, Math.max(0, Math.sin(t * 1.1)) * 0.25, 0, -0.18); }
        else { this.set(B.EAR_L, 0, 0, -0.15); this.set(B.EAR_R, 0, 0, 0.15); }
        break;
      }
      case RS.RUN:
      case RS.FINISHED:
        if (a.victory && a.state === RS.FINISHED && a.speed < 9) { this.victory(a.victory, st, t); eyeY = 0.45; break; }
        running();
        break;
      case RS.JUMP: {
        const rising = a.vy > 0;
        const k = Math.max(-1, Math.min(1, a.vy / 8));
        legs(-0.9 * (0.5 + k * 0.5) - 0.3, -0.8 * (0.5 + k * 0.5) - 0.3, 0.9, 0.8, rising ? 0.3 : 1.0, rising ? 0.3 : 1.0, -0.4, -0.4);
        this.set(B.BODY, -k * 0.25);
        this.set(B.HEAD, k * 0.2);
        tailWag(6, 0.2, -0.6);
        if (s.ear === 'flop') { this.set(B.EAR_L, -0.8 * k, 0, -0.6); this.set(B.EAR_R, -0.8 * k, 0, 0.6); }
        else { this.set(B.EAR_L, -0.3, 0, 0.18); this.set(B.EAR_R, -0.3, 0, -0.18); }
        break;
      }
      case RS.SLIDE: {
        legs(-1.35, -1.3, 1.35, 1.3, -0.1, -0.1, 0.2, 0.2);
        rt.y = -(s.legU + s.legL) * 0.85;
        this.set(B.BODY, -0.12, 0, Math.sin(t * 30) * 0.03, 0, 0, 0, 1.05, 0.9, 1.05);
        this.set(B.HEAD, 0.05);
        tailWag(12, 0.15, -0.3);
        eyeY = 0.55;
        break;
      }
      case RS.STUMBLE: {
        running();
        rt.roll += Math.sin(st * 22) * 0.25 * Math.max(0, 1 - st * 1.5);
        this.set(B.HEAD, 0.4, Math.sin(st * 20) * 0.4);
        eyeY = 0.2;
        break;
      }
      case RS.KNOCKDOWN: {
        const k = Math.min(1, st * 5);
        rt.roll = (Math.PI / 2) * k * 0.95;
        rt.y = -0.1 * k;
        const fl = Math.sin(t * 16) * 0.5;
        legs(-0.6 + fl, -0.5 - fl, 0.5 + fl, 0.6 - fl, 0.6, 0.6, -0.5, -0.5);
        this.set(B.HEAD, -0.2, Math.sin(t * 6) * 0.3, 0.2);
        tailWag(3, 0.2);
        eyeY = 0.15;
        tongueT = 1;
        break;
      }
      case RS.RECOVER: {
        const k = Math.max(0, 1 - st * 3);
        rt.roll = (Math.PI / 2) * k * 0.95;
        this.set(B.HEAD, 0, Math.sin(st * 30) * 0.5 * (1 - k), 0);
        running();
        if (s.ear !== 'flop') { this.set(B.EAR_L, 0, Math.sin(st * 30) * 0.4, 0.3); this.set(B.EAR_R, 0, Math.sin(st * 30) * 0.4, -0.3); }
        break;
      }
      case RS.KNOCKBACK: {
        rt.pitch = -st * 9;
        legs(-1.2, -1.0, 1.2, 1.0, 0.4, 0.4, -0.4, -0.4);
        eyeY = 0.1;
        tongueT = 1;
        break;
      }
      case RS.FALLPIT: {
        rt.pitch = Math.min(1.2, st * 2);
        rt.roll = Math.sin(st * 8) * 0.5;
        const fl = Math.sin(t * 25) * 0.8;
        legs(-1 + fl, -1 - fl, 1 + fl, 1 - fl, 0.5, 0.5, -0.5, -0.5);
        this.set(B.HEAD, -0.5);
        eyeY = 1.3;
        break;
      }
    }

    // landing squash overlay
    if (a.landT > 0 && a.grounded) {
      const k = a.landT / 0.25;
      rt.y -= 0.12 * k * s.scale * (s.legU + s.legL);
      const o = B.BODY * P;
      this.target[o + 6] *= 1 + 0.12 * k; this.target[o + 7] *= 1 - 0.18 * k;
      this.target[B.FLL * P] += 0.5 * k; this.target[B.FRL * P] += 0.5 * k;
    }
    // exhaustion overlay: droopy head, tongue out
    if (a.exhausted && a.state === RS.RUN) {
      this.target[B.HEAD * P] += 0.25;
      if (s.ear === 'flop') { this.target[B.EAR_L * P + 2] -= 0.3; this.target[B.EAR_R * P + 2] += 0.3; }
      eyeY = Math.min(eyeY, 0.55);
    }
    this.set(B.EYES, 0, 0, 0, 0, 0, 0, 1, eyeY, 1);
    this.tongue = damp(this.tongue, tongueT, 10, dt);
    this.set(B.TONGUE, 0.3, 0, 0, 0, 0, 0, this.tongue, this.tongue, this.tongue);

    // blend toward target
    const rate = a.state === RS.RUN || a.state === RS.FINISHED ? 30 : 16;
    const k = 1 - Math.exp(-rate * dt);
    for (let i = 0; i < this.pose.length; i++) this.pose[i] += (this.target[i] - this.pose[i]) * k;
    // eyes snap for crisp blinks
    this.pose[B.EYES * P + 7] = this.target[B.EYES * P + 7];
    const r = this.root;
    const rk = 1 - Math.exp(-14 * dt);
    r.y += (rt.y - r.y) * rk;
    r.pitch += (rt.pitch - r.pitch) * (a.state === RS.KNOCKBACK ? 1 : rk);
    r.roll += (rt.roll - r.roll) * rk;
    r.yaw += (rt.yaw - r.yaw) * (a.victory ? 1 : rk);
  }

  private victory(kind: string, st: number, t: number): void {
    const rt = this.rootT;
    const hop = Math.abs(Math.sin(t * 6));
    switch (kind) {
      case 'vic_spin':
        rt.yaw = t * 7; rt.y = hop * 0.15;
        this.set(B.FLU, -0.8); this.set(B.FRU, -0.8);
        break;
      case 'vic_dance':
        rt.roll = Math.sin(t * 8) * 0.25; rt.y = hop * 0.1;
        this.set(B.BODY, 0, Math.sin(t * 8) * 0.3, 0);
        this.set(B.HEAD, 0, -Math.sin(t * 8) * 0.4, Math.sin(t * 8) * 0.3);
        this.set(B.FLU, -0.6 + Math.sin(t * 8) * 0.6); this.set(B.FRU, -0.6 - Math.sin(t * 8) * 0.6);
        break;
      case 'vic_flip': {
        const cyc = (t * 1.2) % 1;
        rt.y = Math.sin(cyc * Math.PI) * 0.9;
        rt.pitch = cyc < 0.6 ? -(cyc / 0.6) * Math.PI * 2 : 0;
        this.set(B.FLU, -1); this.set(B.FRU, -1); this.set(B.BLU, 1); this.set(B.BRU, 1);
        break;
      }
      default: // happy hops
        rt.y = hop * 0.35;
        this.set(B.BODY, -0.3 * hop);
        this.set(B.FLU, -1.0 * hop - 0.3); this.set(B.FRU, -1.1 * hop - 0.3);
        this.set(B.HEAD, -0.3, Math.sin(t * 3) * 0.3);
    }
    this.set(B.TAIL0, -0.4, Math.sin(t * 14) * 0.6);
    this.set(B.TAIL1, 0, Math.sin(t * 14 - 0.6) * 0.6);
    this.set(B.TAIL2, 0, Math.sin(t * 14 - 1.2) * 0.6);
    void st;
  }
}
