// Race HUD (DOM overlay).
import { ANIMALS, DERIVED } from '@shared/animals';
import { EV, ITEM_INFO, FL, IT } from '@shared/constants';
import { SimEvent } from '@shared/sim';
import { RaceSource } from '../game/raceSource';
import { TrackPath } from '../tracks/trackPath';
import { h, fmtTime, portraits, ordinal } from './dom';
import { input } from '../game/input';
import { ZK } from '@shared/track';

export class Hud {
  root: HTMLElement;
  private els: Record<string, HTMLElement> = {};
  private standings: HTMLElement;
  private minimap: HTMLCanvasElement;
  private mapBg: HTMLCanvasElement;
  private mapPts: [number, number][] = [];
  private notes: HTMLElement;
  private lastPlace = 0;
  private lastCountdown = 99;
  private fpsAcc = 0; private fpsFrames = 0; fps = 0;
  private lastCp = 0;
  private stTimer = 0;
  private stKey = '';

  constructor(parent: HTMLElement, private src: RaceSource, private path: TrackPath, showFps: boolean) {
    const e = this.els;
    const stat = (cls: string, label: string) => {
      const fill = h('div', { class: 'bar-fill' });
      const wrap = h('div', { class: `meter ${cls}` }, h('div', { class: 'meter-icon' }, '⚡'), h('div', { class: 'meter-body' }, h('div', { class: 'meter-label' }, label), h('div', { class: 'bar' }, fill)));
      return [wrap, fill] as const;
    };
    const [stWrap, stFill] = stat('stamina', 'Stamina');
    const [boWrap, boFill] = stat('boost', 'Boost');
    e.stFill = stFill; e.boFill = boFill; e.stWrap = stWrap;
    this.standings = h('div', { class: 'standings' });
    this.minimap = h('canvas', { class: 'minimap', width: 220, height: 220 });
    this.mapBg = document.createElement('canvas'); this.mapBg.width = 220; this.mapBg.height = 220;
    this.notes = h('div', { class: 'notes' });
    const btn = (cls: string, label: string, down: () => void, up?: () => void) => {
      const b = h('button', { class: `tbtn ${cls}` }, label);
      b.addEventListener('pointerdown', (ev) => { ev.preventDefault(); down(); b.classList.add('down'); });
      const release = () => { up?.(); b.classList.remove('down'); };
      b.addEventListener('pointerup', release); b.addEventListener('pointerleave', release); b.addEventListener('pointercancel', release);
      return b;
    };
    this.root = h('div', { class: 'hud' },
      h('div', { class: 'hud-pos' }, e.place = h('span', { class: 'pos-big' }, '1'), e.total = h('span', { class: 'pos-total' }, '/8'), h('div', { class: 'pos-label' }, 'Position')),
      this.standings,
      h('div', { class: 'hud-top' },
        e.lap = h('div', { class: 'pill lap' }, '1/1 Lap'),
        h('div', { class: 'pill flag' }, '🏁'),
        e.timer = h('div', { class: 'pill timer' }, '⏱ 00:00.00'),
      ),
      e.dist = h('div', { class: 'pill dist' }, '0 m to finish'),
      e.cp = h('div', { class: 'checkpoint' }),
      h('div', { class: 'hud-right' },
        h('div', { class: 'speed' }, e.speed = h('span', {}, '0'), h('small', {}, ' km/h')),
        stWrap, boWrap,
      ),
      h('div', { class: 'item-slot' }, e.itemIcon = h('div', { class: 'item-icon' }, ''), e.itemName = h('div', { class: 'item-name' }, ''), h('div', { class: 'key' }, 'SPACE')),
      e.ability = h('div', { class: 'ability' }, e.abilityIcon = h('div', { class: 'ab-icon' }, ''), e.abilityCd = h('div', { class: 'ab-cd' }), e.abilityName = h('div', { class: 'ab-name' }), h('div', { class: 'key' }, 'E')),
      this.minimap,
      this.notes,
      e.countdown = h('div', { class: 'countdown' }),
      e.net = h('div', { class: 'netinfo' }),
      e.fps = h('div', { class: 'fps', style: { display: showFps ? '' : 'none' } }),
      e.exhaust = h('div', { class: 'exhausted-warn' }, 'EXHAUSTED!'),
      h('div', { class: 'touch-left' },
        btn('arrow', '←', () => input.press('left')),
        btn('arrow', '↑', () => input.press('jump')),
        btn('arrow', '↓', () => input.setTouchSlide(true), () => input.setTouchSlide(false)),
        btn('arrow', '→', () => input.press('right')),
      ),
      h('div', { class: 'touch-right' },
        btn('round boostbtn', '⏫', () => input.setTouchBoost(true), () => input.setTouchBoost(false)),
        h('div', { class: 'key boostkey' }, 'SHIFT'),
      ),
    );
    e.speedlines = h('div');
    parent.append(this.root);
    const ab = ANIMALS[src.infos[src.myIdx]?.animal ?? 0].ability;
    e.abilityName.textContent = ab.name;
    e.abilityIcon.textContent = ['🛡', '❄', '🐂', '🐾', '🌑'][src.infos[src.myIdx]?.animal ?? 0];
    this.buildMinimap();
  }

  private buildMinimap(): void {
    const p = this.path, b = p.bounds;
    const w = this.mapBg.width, pad = 18;
    const sc = (w - pad * 2) / Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
    const ox = (w - (b.maxX - b.minX) * sc) / 2, oz = (w - (b.maxZ - b.minZ) * sc) / 2;
    const P = [0, 0, 0];
    this.mapPts = [];
    const proj = (x: number, z: number): [number, number] => [w - (ox + (x - b.minX) * sc), oz + (z - b.minZ) * sc];
    for (let s = 0; s <= p.lapLength; s += 4) { p.point(s, 0, 0, P); this.mapPts.push(proj(P[0], P[2])); }
    const ctx = this.mapBg.getContext('2d')!;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(20,20,40,0.55)'; ctx.lineWidth = 14; ctx.beginPath();
    this.mapPts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 6; ctx.stroke();
    const [fx, fy] = this.mapPts[this.mapPts.length - 1];
    ctx.fillStyle = '#111'; ctx.fillRect(fx - 5, fy - 5, 10, 10);
    (this as any).proj = proj;
  }

  update(dt: number): void {
    const src = this.src, e = this.els;
    const me = src.me();
    const track = src.track;
    const n = src.infos.length;
    const t = src.time();
    // fps
    this.fpsAcc += dt; this.fpsFrames++;
    if (this.fpsAcc >= 0.5) { this.fps = this.fpsFrames / this.fpsAcc; this.fpsAcc = 0; this.fpsFrames = 0; e.fps.textContent = `${this.fps.toFixed(0)} FPS`; }
    // countdown
    if (t < 0) {
      const c = Math.ceil(-t);
      e.countdown.textContent = String(c);
      e.countdown.className = 'countdown show';
      this.lastCountdown = c;
    } else if (t < 1.0) {
      e.countdown.textContent = 'GO!'; e.countdown.className = 'countdown show go';
    } else e.countdown.className = 'countdown';
    // place
    const place = me.place || src.render[src.myIdx]?.place || 1;
    e.place.textContent = String(place);
    e.total.textContent = `/${n}`;
    if (this.lastPlace && place !== this.lastPlace && t > 1) this.notify(place < this.lastPlace ? `▲ ${ordinal(place)} place!` : `▼ ${ordinal(place)} place`, place < this.lastPlace ? 'good' : 'bad');
    this.lastPlace = place;
    // lap / timer / distance
    const lap = Math.min(track.laps, Math.floor(Math.max(0, me.s) / track.lapLength) + 1);
    e.lap.textContent = `${lap}/${track.laps} Lap`;
    e.timer.textContent = `⏱ ${fmtTime(me.finished ? me.finishTime : Math.max(0, t))}`;
    e.dist.textContent = me.finished ? 'FINISHED!' : `${Math.max(0, Math.ceil(track.length - me.s))} m to finish`;
    // speed & meters
    const d = DERIVED[me.animal];
    e.speed.textContent = String(Math.round(me.v * 3.6));
    e.stFill.style.width = `${(me.stamina / d.staminaMax) * 100}%`;
    e.stWrap.classList.toggle('low', !!me.exhausted || me.stamina < d.staminaMax * 0.2);
    const boostPow = Math.max(0, Math.min(1, (me.v / d.maxSpeed - 0.9) / 0.6));
    e.boFill.style.width = `${boostPow * 100}%`;
    e.exhaust.classList.toggle('show', !!me.exhausted && t > 0);
    // item
    if (me.item >= 0) {
      e.itemIcon.textContent = ITEM_INFO[me.item].icon; e.itemName.textContent = ITEM_INFO[me.item].name;
      e.itemIcon.parentElement!.classList.add('has');
    } else { e.itemIcon.textContent = ''; e.itemName.textContent = ''; e.itemIcon.parentElement!.classList.remove('has'); }
    // ability
    const ab = ANIMALS[me.animal].ability;
    if (ab.passive) {
      e.abilityCd.style.setProperty('--p', me.nineUsed ? '0' : '1');
      e.ability.classList.toggle('ready', !me.nineUsed);
      e.abilityCd.textContent = me.nineUsed ? 'USED' : 'READY';
    } else {
      const p = 1 - me.abilityCd / ab.cooldown;
      e.abilityCd.style.setProperty('--p', String(p));
      e.ability.classList.toggle('ready', me.abilityCd <= 0 && me.stamina >= ab.cost);
      e.ability.classList.toggle('active', me.abilityT > 0);
      e.abilityCd.textContent = me.abilityT > 0 ? 'ACTIVE' : me.abilityCd > 0 ? me.abilityCd.toFixed(1) : me.stamina < ab.cost ? 'LOW ST' : 'READY';
    }
    // standings
    const order = src.render.slice().sort((a, b) => (a.place || a.idx + 1) - (b.place || b.idx + 1));
    order.forEach((r, i) => { if (!r.place) r.place = i + 1; });
    const rows = order.slice(0, 8);
    this.stTimer -= dt;
    const key = rows.map((r) => `${r.idx}:${r.finished ? 1 : 0}`).join(',');
    if (this.stTimer <= 0 && key !== this.stKey) { this.stTimer = 0.25; this.stKey = key; this.standings.innerHTML = ''; } else rows.length = 0;
    for (const r of rows) {
      const info = src.infos[r.idx];
      if (!info) continue;
      const row = h('div', { class: `st-row${r.idx === src.myIdx ? ' me' : ''}` },
        h('span', { class: 'st-pos' }, String(r.place)),
        portraits[info.animal] ? h('img', { src: portraits[info.animal], class: 'st-img' }) : h('span', {}, ANIMALS[info.animal].emoji),
        h('span', { class: 'st-name' }, info.name),
        info.isAI ? h('span', { class: 'tag ai' }, 'AI') : src.online && r.idx !== src.myIdx ? h('span', { class: 'tag human' }, 'P') : null,
        r.finished ? h('span', { class: 'st-fin' }, '🏁') : null,
      );
      this.standings.append(row);
    }
    // minimap
    const ctx = this.minimap.getContext('2d')!;
    ctx.clearRect(0, 0, 220, 220);
    ctx.drawImage(this.mapBg, 0, 0);
    const P = [0, 0, 0];
    const proj = (this as any).proj as (x: number, z: number) => [number, number];
    const cols = ['#ff9a1a', '#4fc3ff', '#ff4f4f', '#ffd21a', '#b57bff'];
    for (const r of order.slice().reverse()) {
      this.path.point(r.s, 0, 0, P);
      const [x, y] = proj(P[0], P[2]);
      const info = src.infos[r.idx];
      ctx.beginPath(); ctx.arc(x, y, r.idx === src.myIdx ? 8 : 6, 0, Math.PI * 2);
      ctx.fillStyle = cols[info?.animal ?? 0]; ctx.fill();
      ctx.lineWidth = r.idx === src.myIdx ? 3 : 2; ctx.strokeStyle = r.idx === src.myIdx ? '#ffffff' : '#222'; ctx.stroke();
    }
    // network
    if (src.online) {
      const ping = src.ping();
      e.net.textContent = `● ${ping} ms`;
      e.net.className = `netinfo ${ping < 80 ? 'good' : ping < 160 ? 'ok' : 'bad'}`;
    }
    void IT; void FL;
  }

  notify(text: string, kind: 'good' | 'bad' | 'info' | 'item' = 'info'): void {
    const el = h('div', { class: `note ${kind}` }, text);
    this.notes.prepend(el);
    while (this.notes.children.length > 4) this.notes.lastElementChild!.remove();
    setTimeout(() => el.classList.add('out'), 1700);
    setTimeout(() => el.remove(), 2200);
  }

  checkpoint(idx: number, t: number, cpCount: number): void {
    const e = this.els.cp;
    e.textContent = `CHECKPOINT ${idx + 1}/${cpCount}  ·  ${fmtTime(t)}`;
    e.classList.remove('show'); void e.offsetWidth; e.classList.add('show');
    this.lastCp = idx;
  }

  onEvent(ev: SimEvent): void {
    const me = this.src.myIdx;
    const name = (i: number) => this.src.infos[i]?.name ?? '?';
    switch (ev.k) {
      case EV.ITEM_GET: if (ev.a === me) this.notify(`${ITEM_INFO[ev.b].icon} ${ITEM_INFO[ev.b].name}!`, 'item'); break;
      case EV.ITEM_USE: if (ev.a === me) this.notify(`Used ${ITEM_INFO[ev.b].name}`, 'item'); break;
      case EV.ATTACK_HIT:
        if (ev.b === me) this.notify(`💥 Hit by ${name(ev.a)}${ev.c < 8 ? ` (${ITEM_INFO[ev.c].name})` : ' (BULL CHARGE)'}!`, 'bad');
        else if (ev.a === me) this.notify(`🎯 You hit ${name(ev.b)}!`, 'good');
        break;
      case EV.SHIELD_BLOCK: if (ev.a === me) this.notify('🛡️ Shield blocked an attack!', 'good'); break;
      case EV.IMMUNE: if (ev.a === me) this.notify('🌑 Shadow Step: immune!', 'good'); break;
      case EV.KNOCKDOWN: if (ev.a === me) this.notify('KNOCKDOWN!', 'bad'); break;
      case EV.RECOVER: if (ev.a === me) this.notify('Recovered!', 'good'); break;
      case EV.NINE_LIVES: if (ev.a === me) this.notify('🐾 NINE LIVES saved you!', 'good'); break;
      case EV.BOOST: if (ev.a === me) this.notify('BOOST!', 'info'); break;
      case EV.ABILITY: if (ev.a === me) this.notify(`${ANIMALS[this.src.infos[me].animal].ability.name}!`, 'good'); break;
      case EV.GATE: if (ev.a === me && ev.b >= 0) this.notify(['🟢 SPEED GATE', '🔵 STAMINA GATE', '🟡 ACCEL GATE', '🔴 DANGER BOOST'][ev.b] ?? 'BOOST PAD', 'good'); break;
      case EV.PIT_FALL: if (ev.a === me) this.notify('Fell into the pit!', 'bad'); break;
      case EV.EXHAUSTED: if (ev.a === me) this.notify('Out of stamina!', 'bad'); break;
      case EV.STAMINA_PICK: if (ev.a === me) this.notify('+25 Stamina', 'good'); break;
      case EV.CHECKPOINT: if (ev.a === me) { const r = this.src.me(); this.checkpoint(r.nextCp - 1, this.src.time(), this.src.track.checkpoints.length); } break;
    }
    void ZK;
  }

  destroy(): void { this.root.remove(); }
}
