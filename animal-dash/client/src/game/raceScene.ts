// Renders a race from any RaceSource: environment, obstacles, items, animals, effects,
// chase camera, name tags and event-driven audio/particles.
import { Renderer } from '../engine/renderer';
import { ParticleSystem } from '../engine/particles';
import { mat4, compose, multiply, damp, clamp } from '../engine/math';
import { TrackScene } from '../tracks/trackScene';
import { ObstacleRenderer } from '../obstacles/obstacleRenderer';
import { ItemRenderer } from '../items/itemRenderer';
import { AnimalActor } from '../characters/actor';
import { B } from '../characters/animalModels';
import { RaceSource } from './raceSource';
import { EV, FL, RS, IT } from '@shared/constants';
import { ANIMALS, DERIVED } from '@shared/animals';
import { decodeLoadout } from '@shared/progression';
import { TRACK_DEFS } from '@shared/tracks';
import { ATTACK_CHARGE } from '@shared/sim';
import { audio } from '../audio/audio';
import { Hud } from '../ui/hud';
import { h } from '../ui/dom';
import { profiles } from './profile';

const TRAIL_COLORS: number[][] = [[1, 0.6, 0.15], [0.35, 0.8, 1], [1, 0.3, 0.25], [1, 0.85, 0.2], [0.7, 0.35, 1]];

interface Fx { kind: 'ring' | 'bomb'; x: number; y: number; z: number; t: number; dur: number; col: number[]; size: number; }

const sceneCache = new Map<string, { scene: TrackScene; obs: ObstacleRenderer; items: ItemRenderer }>();
export function getTrackVisuals(gl: WebGL2RenderingContext, trackId: string) {
  let v = sceneCache.get(trackId);
  if (!v) {
    const def = TRACK_DEFS.find((d) => d.id === trackId)!;
    const scene = new TrackScene(gl, def);
    v = { scene, obs: new ObstacleRenderer(gl, scene), items: new ItemRenderer(gl, scene) };
    sceneCache.set(trackId, v);
  }
  return v;
}

export class RaceScene {
  readonly src: RaceSource;
  readonly hud: Hud;
  private vis: ReturnType<typeof getTrackVisuals>;
  private actors: AnimalActor[];
  private particles = new ParticleSystem(5000);
  private fx: Fx[] = [];
  private cam = { s: 0, x: 0, y: 3, dist: 6, fov: 62, shake: 0, lookY: 1, orbit: 0 };
  private tags: HTMLElement[] = [];
  private tagLayer: HTMLElement;
  private m = mat4(); private m2 = mat4(); private m3 = mat4();
  private P = [0, 0, 0]; private Q = [0, 0, 0];
  private lastTime = -99;
  private finishedShown = false;
  private emotes = new Map<number, { text: string; until: number }>();
  private wall = 0;
  private stepTimers: number[] = [];
  private victories: string[] = [];

  constructor(private r: Renderer, src: RaceSource, overlay: HTMLElement) {
    this.src = src;
    this.vis = getTrackVisuals(r.gl, src.track.def.id);
    this.vis.scene.applyEnvironment(r);
    this.actors = src.infos.map((info) => new AnimalActor(r.gl, info.animal, info.cosmetics ? decodeLoadout(info.cosmetics) : null));
    this.victories = src.infos.map((info) => (info.cosmetics ? decodeLoadout(info.cosmetics).victory : '') || 'vic_hop');
    this.tagLayer = h('div', { class: 'tags' });
    overlay.append(this.tagLayer);
    this.tags = src.infos.map((info, i) => {
      const isMe = i === src.myIdx;
      const el = h('div', { class: `nametag${info.isAI ? ' ai' : ''}${isMe ? ' me' : ''}` },
        info.isAI ? h('span', { class: 'tag ai' }, '🤖 AI') : h('span', { class: 'tag human' }, isMe ? 'YOU' : '👤'),
        ' ', info.name, h('span', { class: 'emote' }));
      this.tagLayer.append(el);
      return el;
    });
    this.hud = new Hud(overlay, src, this.vis.scene.path, profiles.settings.showFps);
    const me = src.render[src.myIdx] ?? src.render[0];
    this.cam.s = me.s - 6; this.cam.x = me.x;
    this.stepTimers = src.infos.map(() => 0);
    audio.setCrowd(src.track.def.id === 'stadium', 0.12);
  }

  showEmote(idx: number, text: string): void { this.emotes.set(idx, { text, until: this.wall + 2.5 }); }

  update(dt: number): void {
    this.wall += dt;
    const src = this.src;
    const t = src.time();
    const r = this.r;
    const path = this.vis.scene.path;
    // countdown beeps
    if (t < 0 && Math.ceil(-t) !== Math.ceil(-this.lastTime) && this.lastTime < 0 && t > -3.05) audio.play('count');
    if (t >= 0 && this.lastTime < 0) { audio.play('go'); audio.cheer(); }
    this.lastTime = t;

    // events -> effects, audio, HUD
    for (const e of src.drainEvents()) this.onEvent(e);

    // actors
    const me = src.render[src.myIdx] ?? src.render[0];
    src.render.forEach((rr, i) => {
      const actor = this.actors[i];
      const info = src.infos[i];
      actor.scaleMul = damp(actor.scaleMul, rr.flags & FL.MEAT ? 1.3 : 1, 6, dt);
      const victory = rr.finished && rr.place <= 3 ? this.victories[i] : '';
      actor.update({
        state: t < 0 ? RS.IDLE : rr.state, speed: rr.v, vy: rr.vy, grounded: (rr.flags & FL.GROUNDED) !== 0 || rr.y <= 0.01,
        landT: i === src.myIdx ? src.me().landT : 0, exhausted: (rr.flags & FL.EXHAUSTED) !== 0, boosting: (rr.flags & (FL.BOOSTING | FL.ROCKET | FL.GATE_BOOST)) !== 0,
        lateral: clamp(rr.lateral, -15, 15), victory, dt,
      });
      path.frame(rr.s, rr.x, rr.y, this.m);
      actor.computeBones(this.m);
      // footstep dust & audio
      if (actor.anim.stepped) {
        const ground = path.point(rr.s - 0.3, rr.x, 0.05, this.P);
        const dust = src.track.def.id === 'stadium' ? [0.85, 0.55, 0.45] : [0.85, 0.85, 0.75];
        this.particles.emit(ground[0], ground[1], ground[2], (Math.random() - 0.5) * 1.5, 0.8 + Math.random(), (Math.random() - 0.5) * 1.5, 0.45, 0.18, 0.45, dust[0], dust[1], dust[2], 0.3, -1, false, 2);
        if (i === src.myIdx) { this.stepTimers[i] = 0; audio.play('step', 0.6); }
      }
      // boost trails (per-animal colour, like the reference art)
      if (rr.flags & (FL.BOOSTING | FL.ROCKET | FL.GATE_BOOST) || (rr.flags & FL.ABILITY && (info.animal === 1 || info.animal === 4))) {
        const col = rr.flags & FL.ROCKET ? [1, 0.5, 0.1] : rr.flags & FL.GATE_BOOST && !(rr.flags & FL.BOOSTING) ? [0.3, 1, 0.4] : TRAIL_COLORS[info.animal];
        for (let k = 0; k < 2; k++) {
          const p = path.point(rr.s - 0.6 - Math.random() * 0.4, rr.x + (Math.random() - 0.5) * 0.6, 0.3 + Math.random() * 0.6 + rr.y, this.P);
          this.particles.emit(p[0], p[1], p[2], (Math.random() - 0.5), Math.random() * 0.5, (Math.random() - 0.5), 0.35, 0.24, 0.04, col[0], col[1], col[2], 0.75, 0, true, 1);
        }
      }
      if (rr.flags & FL.EXHAUSTED && Math.random() < 0.08) {
        const p = actor.bonePos(B.HEAD, this.P);
        this.particles.emit(p[0], p[1] + 0.3, p[2], (Math.random() - 0.5) * 2, 2, (Math.random() - 0.5) * 2, 0.6, 0.12, 0.08, 0.5, 0.8, 1, 0.9, -9);
      }
      if ((rr.state === RS.KNOCKDOWN || rr.state === RS.STUMBLE) && Math.random() < 0.3) {
        const p = actor.bonePos(B.HEAD, this.P);
        this.particles.emit(p[0], p[1] + 0.5, p[2], Math.cos(this.wall * 8) * 1.5, 0.3, Math.sin(this.wall * 8) * 1.5, 0.4, 0.18, 0.05, 1, 0.9, 0.2, 1, 0, true);
      }
      if (rr.flags & FL.ROCKET) {
        const p = path.point(rr.s - 0.9, rr.x, 0.9 + rr.y, this.P);
        this.particles.emit(p[0], p[1], p[2], (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, 0.3, 0.6, 0.1, 1, 0.6, 0.15, 1, 2, true);
      }
    });

    this.updateCamera(dt, me);
    this.particles.update(dt);
    for (let i = this.fx.length - 1; i >= 0; i--) if (this.wall - this.fx[i].t > this.fx[i].dur) this.fx.splice(i, 1);

    // ---------------- draw
    r.time = this.wall;
    r.begin();
    this.vis.scene.draw(r, this.wall);
    this.vis.obs.draw(r, t, me.s);
    this.vis.items.draw(r, this.wall, me.s, (i) => src.boxAvail(i), (i) => src.pickAvail(i), src.entities());
    const im = this.vis.items.meshes;
    src.render.forEach((rr, i) => {
      if (Math.abs(rr.s - me.s) > 160) return;
      const actor = this.actors[i];
      const info = src.infos[i];
      const ab = ANIMALS[info.animal].ability.id;
      let tint: number[] | null = null, alpha = 1, spec: number | undefined;
      if (rr.flags & FL.FROZEN) tint = [0.6, 0.85, 1.25];
      if (rr.flags & FL.ABILITY) {
        if (ab === 'ironbark') { tint = [0.8, 0.85, 1.0]; spec = 1.2; }
        if (ab === 'shadowstep') { alpha = 0.5; tint = [0.7, 0.45, 1.2]; }
        if (ab === 'bullcharge') tint = [1.25, 0.75, 0.7];
      }
      if (rr.flags & FL.INVULN && rr.state === RS.RUN && Math.floor(this.wall * 12) % 2 === 0) alpha = Math.min(alpha, 0.55);
      actor.draw(r, { tint, alpha, spec, flash: null });
      const body = actor.world[B.BODY];
      const sz = actor.model.spec.scale * actor.scaleMul;
      if (rr.flags & FL.SHIELD) {
        compose(this.m2, 0, 0, 0, 0, this.wall, 0, 1.0 / sz * 1.1, 1.0 / sz * 1.0, 1.0 / sz * 1.2);
        multiply(this.m3, body, this.m2);
        r.draw(im.shield, this.m3, { alpha: 0.22 + Math.sin(this.wall * 6) * 0.05, emissive: 0.8, shadow: false });
      }
      if (rr.flags & FL.MAGNET) {
        const head = actor.world[B.HEAD];
        compose(this.m2, 0, 0.55, 0, 0, this.wall * 3, 0, 1.5, 1.5, 1.5);
        multiply(this.m3, head, this.m2); r.draw(im.magnet, this.m3, { emissive: 0.2 });
      }
      if (rr.flags & FL.ROCKET) {
        compose(this.m2, 0, 0.35, -0.2, 0, 0, this.wall * 10, 1.6, 1.6, 1.6);
        multiply(this.m3, body, this.m2); r.draw(im.rocket, this.m3);
      }
      if (rr.flags & FL.MEAT) {
        const head = actor.world[B.HEAD];
        compose(this.m2, 0, -0.1, 0.45, 0, Math.PI / 2, 0, 0.9, 0.9, 0.9);
        multiply(this.m3, head, this.m2); r.draw(im.meat, this.m3);
      }
      if (rr.flags & FL.FROZEN) {
        path.frame(rr.s, rr.x, rr.y, this.m);
        compose(this.m2, 0, 0, 0, 0, this.wall * 0.5, 0);
        multiply(this.m3, this.m, this.m2); r.draw(im.ice, this.m3, { alpha: 0.75, emissive: 0.3 });
      }
      if (rr.state === RS.KNOCKDOWN || rr.state === RS.RECOVER) {
        const head = actor.world[B.HEAD];
        for (let k = 0; k < 3; k++) {
          const a = this.wall * 5 + (k * Math.PI * 2) / 3;
          compose(this.m2, Math.cos(a) * 0.3, 0.45, Math.sin(a) * 0.3, 0, a, 0, 1.4, 1.4, 1.4);
          multiply(this.m3, head, this.m2); r.draw(im.star, this.m3, { emissive: 1, shadow: false });
        }
      }
    });
    for (const f of this.fx) {
      const k = (this.wall - f.t) / f.dur;
      // rings grow in radius but stay thin (scale y ~ constant) so the camera never ends up inside the tube
      const sc = f.size * (0.2 + k);
      compose(this.m, f.x, f.y, f.z, 0, 0, 0, sc, f.kind === 'ring' ? 1.5 : sc, sc);
      if (f.kind === 'ring') r.draw(im.ring, this.m, { tint: f.col, alpha: (1 - k) * 0.8, emissive: 1, shadow: false });
      else r.draw(im.shield, this.m, { tint: f.col, alpha: (1 - k) * 0.6, emissive: 1, shadow: false });
    }
    const v = me.v;
    const maxV = DERIVED[src.infos[src.myIdx]?.animal ?? 0].maxSpeed;
    r.speedLines = damp(r.speedLines, t > 0 && !me.finished ? clamp((v / maxV - 1.02) * 2.2, 0, 0.9) : 0, 6, dt);
    r.speedLineColor = me.flags & FL.ROCKET ? [1, 0.7, 0.4] : [1, 1, 1];
    r.render(this.particles);
    this.updateTags(t);
    this.hud.update(dt);
    audio.intensity = clamp(v / maxV - 0.6, 0, 1);
  }

  private updateCamera(dt: number, me: { s: number; x: number; y: number; v: number; flags: number; state: number; finished: boolean }): void {
    const c = this.cam;
    const path = this.vis.scene.path;
    const scene = this.vis.scene;
    const boosting = (me.flags & (FL.BOOSTING | FL.ROCKET | FL.GATE_BOOST)) !== 0;
    const maxV = DERIVED[this.src.infos[this.src.myIdx]?.animal ?? 0].maxSpeed;
    if (me.finished) {
      // victory orbit
      c.orbit += dt * 0.6;
      const ang = c.orbit;
      const eyeS = me.s + Math.cos(ang) * 5, eyeX = me.x + Math.sin(ang) * 5;
      const eye = path.point(eyeS, eyeX, 2.2, this.P);
      const look = path.point(me.s, me.x, 0.9, this.Q);
      this.r.shadowCenter = look.slice();
      this.r.setCamera(eye, look, 55);
      return;
    }
    c.orbit = 0;
    const speedK = clamp(me.v / maxV, 0, 1.6);
    const targetDist = 5.4 + (boosting ? 1.4 : 0) + speedK * 0.6;
    c.dist = damp(c.dist, targetDist, 3, dt);
    const camS = me.s - c.dist;
    const el = scene.edgeAt(camS, false) + 0.3, er = scene.edgeAt(camS, true) - 0.3;
    c.x = damp(c.x, clamp(me.x * 0.8, el, er), 7, dt);
    c.y = damp(c.y, 2.35 + me.y * 0.55, 6, dt);
    c.lookY = damp(c.lookY, 0.8 + me.y * 0.75, 8, dt);
    c.fov = damp(c.fov, 60 + clamp((speedK - 0.8) * 30, 0, 14) + (boosting ? 5 : 0), 4, dt);
    c.shake = Math.max(0, c.shake - dt * 2.5);
    const sh = profiles.settings.cameraShake ? c.shake : 0;
    const eye = path.point(camS, c.x + (Math.random() - 0.5) * sh * 0.6, c.y + (Math.random() - 0.5) * sh * 0.5, this.P);
    // keep the camera above the track surface and any rising terrain
    const look = path.point(me.s + 7, me.x * 0.85, c.lookY, this.Q);
    this.r.shadowCenter = path.point(me.s + 12, 0, 0, [0, 0, 0]);
    this.r.setCamera(eye, look, c.fov);
  }

  private updateTags(t: number): void {
    const src = this.src;
    const me = src.render[src.myIdx];
    const out = [0, 0, 0];
    src.render.forEach((rr, i) => {
      const el = this.tags[i];
      const actor = this.actors[i];
      const em = this.emotes.get(i);
      const emEl = el.lastElementChild as HTMLElement;
      if (em && em.until > this.wall) { emEl.textContent = em.text; emEl.style.display = ''; } else emEl.style.display = 'none';
      const near = !me || Math.abs(rr.s - me.s) < 70;
      const head = actor.bonePos(B.HEAD, this.P);
      if (!near || !this.r.project(head[0], head[1] + 0.9, head[2], out) || (i === src.myIdx && !(em && em.until > this.wall) && t > 2)) { el.style.display = 'none'; return; }
      el.style.display = '';
      const sc = clamp(14 / out[2], 0.55, 1.1);
      el.style.transform = `translate(${out[0]}px, ${out[1]}px) translate(-50%, -100%) scale(${sc})`;
    });
  }

  private onEvent(e: { k: number; a: number; b: number; c: number }): void {
    const src = this.src;
    const me = src.myIdx;
    this.hud.onEvent({ ...e, t: 0 });
    const rr = src.render[e.a];
    if (!rr) return;
    const path = this.vis.scene.path;
    const P = path.point(rr.s, rr.x, rr.y + 0.6, [0, 0, 0]);
    const ps = this.particles;
    const mine = e.a === me;
    const dist = Math.abs(rr.s - (src.render[me]?.s ?? rr.s));
    const vol = mine ? 1 : clamp(1 - dist / 40, 0, 0.6);
    const pan = mine ? 0 : clamp((rr.x - (src.render[me]?.x ?? 0)) / 8, -0.8, 0.8);
    const shake = (k: number) => { if (mine) this.cam.shake = Math.max(this.cam.shake, k); };
    switch (e.k) {
      case EV.JUMP: if (vol > 0.05) audio.play('jump', vol * 0.8, pan); break;
      case EV.RAMP: audio.play('whoosh', vol, pan); ps.burst(10, P[0], P[1] - 0.5, P[2], 3, 0.5, 0.3, 0.5, 0.7, 1, 0.8, -4, true); break;
      case EV.LAND: if (vol > 0.05) audio.play('land', vol, pan); ps.burst(12, P[0], P[1] - 0.55, P[2], 3, 0.5, 0.45, 0.85, 0.75, 0.65, 0.6, -2, false, 0.1); shake(0.12); break;
      case EV.SLIDE: if (vol > 0.05) audio.play('slide', vol, pan); ps.burst(10, P[0], P[1] - 0.5, P[2], 2.5, 0.5, 0.4, 0.85, 0.7, 0.6, 0.5, -2); break;
      case EV.BOOST: if (mine) audio.play('boost', 0.7); break;
      case EV.ITEM_GET: if (mine) audio.play('item'); break;
      case EV.BOX_TAKEN: ps.burst(18, P[0], P[1] + 0.4, P[2], 5, 0.6, 0.3, 1, 0.7, 0.2, 1, -6, true); break;
      case EV.STAMINA_PICK: if (mine) audio.play('pickup'); ps.burst(14, P[0], P[1] + 0.3, P[2], 3, 0.6, 0.25, 0.4, 0.8, 1, 1, -2, true); break;
      case EV.ITEM_USE: {
        audio.play('use', vol, pan);
        if (e.b === IT.CHAOS) { audio.play('explode', Math.max(vol, 0.5), pan); ps.burst(60, P[0], P[1], P[2], 12, 0.8, 0.9, 1, 0.55, 0.15, 1, -3, true); ps.burst(30, P[0], P[1], P[2], 6, 1.2, 1.2, 0.3, 0.3, 0.3, 0.7, 1); this.fx.push({ kind: 'bomb', x: P[0], y: P[1], z: P[2], t: this.wall, dur: 0.5, col: [1, 0.6, 0.2], size: 12 }); shake(0.5); }
        if (e.b === IT.FROZEN) { audio.play('freeze', Math.max(vol, 0.5)); this.fx.push({ kind: 'ring', x: P[0], y: P[1] - 0.4, z: P[2], t: this.wall, dur: 0.7, col: [0.6, 0.9, 1], size: 22 }); ps.burst(50, P[0], P[1], P[2], 14, 0.9, 0.35, 0.7, 0.95, 1, 1, -1, true, 0); }
        if (e.b === IT.CHICKEN) audio.play('cluck', Math.max(vol, 0.4), pan);
        if (e.b === IT.ROCKET) { audio.play('rocket', vol); shake(0.25); }
        if (e.b === IT.SHIELD) audio.play('shield', vol);
        if (e.b === IT.MEAT || e.b === IT.MAGNET) audio.play('ability', vol * 0.7);
        if (e.b === IT.BANANA) audio.play('slip', vol * 0.4, pan);
        break;
      }
      case EV.ATTACK_HIT: {
        const vr = src.render[e.b];
        if (!vr) break;
        const V = path.point(vr.s, vr.x, vr.y + 0.7, [0, 0, 0]);
        ps.burst(24, V[0], V[1], V[2], 6, 0.5, 0.35, 1, 0.95, 0.4, 1, -4, true);
        if (e.c === IT.CHICKEN) ps.burst(16, V[0], V[1], V[2], 4, 1.2, 0.25, 1, 1, 1, 1, -3);
        if (e.c === IT.BANANA) audio.play('slip', e.b === me ? 1 : 0.4);
        if (e.c === ATTACK_CHARGE) audio.play('hit', 0.6);
        if (e.b === me) { audio.play('hit'); this.cam.shake = Math.max(this.cam.shake, 0.45); }
        break;
      }
      case EV.SHIELD_BLOCK: audio.play('shield', vol); ps.burst(30, P[0], P[1], P[2], 6, 0.5, 0.3, 0.4, 0.9, 1, 1, 0, true); break;
      case EV.IMMUNE: ps.burst(20, P[0], P[1], P[2], 4, 0.5, 0.3, 0.6, 0.3, 1, 1, 0, true); break;
      case EV.HIT_OBS: audio.play('hit', vol * 0.8, pan); ps.burst(16, P[0], P[1], P[2], 5, 0.4, 0.3, 1, 1, 1, 1, -5, true); shake(0.3); break;
      case EV.SMASH: audio.play('explode', vol * 0.5, pan); ps.burst(30, P[0], P[1], P[2], 9, 0.7, 0.35, 0.9, 0.7, 0.4, 1, -10); shake(0.2); break;
      case EV.KNOCKDOWN: audio.play('knock', vol, pan); ps.burst(24, P[0], P[1], P[2], 7, 0.6, 0.35, 1, 1, 0.4, 1, -6, true); shake(0.6); break;
      case EV.RECOVER: if (mine) audio.play('recover'); break;
      case EV.NINE_LIVES: audio.play('recover', vol); ps.burst(40, P[0], P[1], P[2], 6, 0.8, 0.35, 1, 0.7, 0.2, 1, 1, true); break;
      case EV.PIT_FALL: audio.play('fall', vol, pan); break;
      case EV.RESPAWN: ps.burst(20, P[0], P[1], P[2], 3, 0.6, 0.4, 1, 1, 1, 1, 2, true); break;
      case EV.GATE: {
        audio.play('gate', vol, pan);
        const col = [[0.3, 1, 0.4], [0.3, 0.65, 1], [1, 0.9, 0.2], [1, 0.25, 0.2]][e.b] ?? [0.3, 1, 0.4];
        ps.burst(26, P[0], P[1], P[2], 6, 0.5, 0.35, col[0], col[1], col[2], 1, 0, true);
        break;
      }
      case EV.ABILITY: {
        audio.play('ability', vol, pan);
        const col = TRAIL_COLORS[src.infos[e.a].animal];
        ps.burst(40, P[0], P[1], P[2], 7, 0.6, 0.4, col[0], col[1], col[2], 1, 0, true);
        this.fx.push({ kind: 'ring', x: P[0], y: P[1] - 0.5, z: P[2], t: this.wall, dur: 0.45, col, size: 4 });
        break;
      }
      case EV.EXHAUSTED: if (mine) audio.play('error', 0.6); break;
      case EV.BUMP: audio.play('hit', vol * 0.4, pan); break;
      case EV.FINISH: {
        ps.burst(80, P[0], P[1] + 1, P[2], 9, 1.4, 0.3, Math.random(), Math.random(), Math.random(), 1, -5, true);
        if (mine) {
          audio.play('finish'); audio.cheer();
          const place = src.render[me].place;
          if (place === 1) setTimeout(() => audio.play('victory'), 600);
          this.finishedShown = true;
        }
        break;
      }
      case EV.CHECKPOINT: if (mine) audio.play('gate', 0.4); break;
    }
  }

  dispose(): void {
    this.hud.destroy();
    this.tagLayer.remove();
    this.particles.clear();
    audio.setCrowd(false);
  }
}
