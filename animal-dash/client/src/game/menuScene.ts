// 3D backdrop for menus: animal lineup at the stadium start line, a rotatable single
// character preview (selection & garage), lobby podiums and the results podium.
import { Renderer } from '../engine/renderer';
import { mat4, compose, damp } from '../engine/math';
import { MeshBuilder, Mesh, M } from '../engine/mesh';
import { AnimalActor } from '../characters/actor';
import { ParticleSystem } from '../engine/particles';
import { RS } from '@shared/constants';
import { Loadout } from '@shared/progression';
import { getTrackVisuals } from './raceScene';
import { portraits } from '../ui/dom';

export type MenuMode = 'lineup' | 'single' | 'lobby' | 'podium';
export interface Showcase { animal: number; loadout: Loadout | null; label?: string; }

export class MenuScene {
  mode: MenuMode = 'lineup';
  private actors = new Map<string, AnimalActor>();
  private items: Showcase[] = [];
  private podium: Mesh;
  private particles = new ParticleSystem(1500);
  private t = 0;
  private yaw = 0.4;
  private yawVel = 0;
  private dragging = false;
  private lastX = 0;
  private m = mat4(); private m2 = mat4();
  private camAng = 0;

  constructor(private r: Renderer) {
    const b = new MeshBuilder();
    b.cylinder(M(0, 0, 0), 1.25, 1.35, 0.35, (x, y) => (y > 0.3 ? [1, 0.82, 0.25] : [0.95, 0.4, 0.55]), 32);
    b.torus(M(0, 0.35, 0), 1.25, 0.06, [1, 1, 1], 32, 6, Math.PI * 2, 0.6);
    this.podium = b.build(r.gl);
    const c = r.canvas;
    c.addEventListener('pointerdown', (e) => { if (this.mode === 'single') { this.dragging = true; this.lastX = e.clientX; } });
    window.addEventListener('pointerup', () => (this.dragging = false));
    window.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX; this.lastX = e.clientX;
      this.yaw += dx * 0.01; this.yawVel = dx * 0.6;
    });
  }

  set(mode: MenuMode, items: Showcase[]): void {
    this.mode = mode;
    this.items = items;
    if (mode === 'podium') this.particles.clear();
  }

  private actor(key: string, s: Showcase): AnimalActor {
    const k = `${key}:${s.animal}`;
    let a = this.actors.get(k);
    if (!a) { a = new AnimalActor(this.r.gl, s.animal, s.loadout); this.actors.set(k, a); }
    if (a.loadout !== s.loadout) a.setLoadout(s.loadout);
    return a;
  }

  update(dt: number): void {
    this.t += dt;
    const r = this.r;
    const vis = getTrackVisuals(r.gl, 'stadium');
    vis.scene.applyEnvironment(r);
    const path = vis.scene.path;
    if (!this.dragging) { this.yaw += this.yawVel * dt * 0.05; this.yawVel = damp(this.yawVel, 0, 3, dt); if (Math.abs(this.yawVel) < 0.05) this.yaw += dt * 0.35; }
    r.time = this.t;
    r.begin();
    vis.scene.draw(r, this.t);
    const baseS = 30;
    const P = [0, 0, 0], Q = [0, 0, 0];
    const items = this.items;
    let eye: number[], look: number[], fov = 50;
    const place = (idx: number, total: number, spacing: number) => (idx - (total - 1) / 2) * spacing;
    if (this.mode === 'single' && items[0]) {
      const a = this.actor('single', items[0]);
      path.frame(baseS, 0, 0, this.m);
      r.draw(this.podium, this.m);
      path.frame(baseS, 0, 0.35, this.m, this.yaw);
      a.update({ state: RS.IDLE, speed: 0, vy: 0, grounded: true, landT: 0, exhausted: false, boosting: false, lateral: 0, victory: '', dt });
      a.computeBones(this.m);
      a.draw(r);
      this.camAng = damp(this.camAng, 0, 3, dt);
      eye = path.point(baseS + 4.2, -1.3, 1.9, P); look = path.point(baseS, -0.6, 0.75, Q); fov = 42;
    } else if (this.mode === 'podium') {
      const heights = [1.1, 0.75, 0.45];
      const xs = [0, -2.6, 2.6];
      items.slice(0, 3).forEach((s, i) => {
        path.frame(baseS, xs[i], 0, this.m);
        compose(this.m2, 0, 0, 0, 0, 0, 0, 1, heights[i] / 0.35, 1);
        const pm = mat4(); multiplyInto(pm, this.m, this.m2);
        r.draw(this.podium, pm);
        const a = this.actor(`pod${i}`, s);
        path.frame(baseS, xs[i], heights[i], this.m, 0);
        a.update({ state: i === 0 ? RS.FINISHED : RS.IDLE, speed: 0, vy: 0, grounded: true, landT: 0, exhausted: false, boosting: false, lateral: 0, victory: i === 0 ? (s.loadout?.victory || 'vic_hop') : '', dt });
        a.computeBones(this.m);
        a.draw(r);
      });
      if (Math.random() < 0.6) {
        const p = path.point(baseS + (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 8, 6, P);
        this.particles.emit(p[0], p[1], p[2], (Math.random() - 0.5), -1, (Math.random() - 0.5), 3, 0.18, 0.18, Math.random(), Math.random(), Math.random(), 1, -1.5, false, 0.5);
      }
      eye = path.point(baseS + 9, -0.5, 3.2, P); look = path.point(baseS, 0, 1.4, Q); fov = 50;
    } else {
      const list = items.length ? items : [];
      const spacing = this.mode === 'lobby' ? 1.7 : 2.1;
      list.forEach((s, i) => {
        const x = place(i, list.length, spacing);
        path.frame(baseS, x, 0, this.m);
        if (this.mode === 'lobby') r.draw(this.podium, this.m);
        const a = this.actor(`line${i}`, s);
        path.frame(baseS, x, this.mode === 'lobby' ? 0.35 : 0, this.m, Math.sin(this.t * 0.5 + i) * 0.25);
        a.update({ state: RS.IDLE, speed: 0, vy: 0, grounded: true, landT: 0, exhausted: false, boosting: false, lateral: 0, victory: '', dt });
        a.computeBones(this.m);
        a.draw(r);
      });
      this.camAng += dt * 0.08;
      const sway = Math.sin(this.camAng) * 1.5;
      const span = Math.max(4, list.length * spacing);
      eye = path.point(baseS + 4 + span * 0.55, sway, 2.0 + span * 0.08, P); look = path.point(baseS, 0, 0.9, Q); fov = 48;
    }
    this.particles.update(dt);
    r.shadowCenter = look!.slice();
    r.speedLines = 0;
    r.setCamera(eye!, look!, fov);
    r.render(this.particles);
  }

  /** Render a portrait of each animal from the real models (used across the UI). */
  generatePortraits(): void {
    const r = this.r;
    const vis = getTrackVisuals(r.gl, 'stadium');
    vis.scene.applyEnvironment(r);
    for (let i = 0; i < 5; i++) {
      const a = new AnimalActor(r.gl, i, null);
      const url = r.snapshot(160, 160, () => {
        r.begin();
        compose(this.m, 0, -200, 0, 0, Math.PI + 0.45, 0);
        a.update({ state: RS.IDLE, speed: 0, vy: 0, grounded: true, landT: 0, exhausted: false, boosting: false, lateral: 0, victory: '', dt: 0.016 });
        a.anim.update({ state: RS.IDLE, speed: 0, vy: 0, grounded: true, landT: 0, exhausted: false, boosting: false, lateral: 0, victory: '', dt: 1, stride: 1 });
        a.computeBones(this.m);
        a.draw(r);
        const head = a.bonePos(5 - 4, [0, 0, 0]);
        const s = a.model.spec.headR * a.model.spec.scale;
        r.shadowCenter = head;
        r.setCamera([head[0] - s * 1.6, head[1] + s * 0.6, head[2] - s * 3.6], [head[0], head[1] - s * 0.1, head[2]], 40);
      });
      portraits[i] = url;
    }
  }
}

function multiplyInto(o: Float32Array, a: Float32Array, b: Float32Array) {
  // local helper to avoid importing multiply under a different name
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
    o[i * 4 + j] = s;
  }
}
