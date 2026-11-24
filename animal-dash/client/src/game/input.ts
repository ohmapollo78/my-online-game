// Input: keyboard, gamepad and on-screen buttons all feed one InputState.
// Discrete actions are monotonic counters (robust over the network); boost/slide are held.
import { InputState, emptyInput } from '@shared/sim';

export type Action = 'left' | 'right' | 'jump' | 'item' | 'ability';

export class InputManager {
  state: InputState = emptyInput();
  enabled = false;
  onPause: () => void = () => {};
  onEmote: (n: number) => void = () => {};
  onAction: (a: Action) => void = () => {};
  private keys = new Set<string>();
  private touchBoost = false;
  private touchSlide = false;
  private padPrev: boolean[] = [];
  private padAxisPrev = 0;

  constructor() {
    window.addEventListener('keydown', (e) => this.keyDown(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.touchBoost = false; this.touchSlide = false; });
  }

  private keyDown(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.code === 'Escape') { this.onPause(); return; }
    if (!this.enabled) return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
    this.keys.add(e.code);
    if (e.repeat) return;
    switch (e.code) {
      case 'ArrowLeft': case 'KeyA': this.press('left'); break;
      case 'ArrowRight': case 'KeyD': this.press('right'); break;
      case 'ArrowUp': case 'KeyW': this.press('jump'); break;
      case 'Space': this.press('item'); break;
      case 'KeyE': case 'KeyQ': case 'KeyF': this.press('ability'); break;
      case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': this.onEmote(Number(e.code.slice(5)) - 1); break;
    }
  }

  press(a: Action): void {
    if (!this.enabled) return;
    const s = this.state;
    if (a === 'left') s.leftN++;
    else if (a === 'right') s.rightN++;
    else if (a === 'jump') s.jumpN++;
    else if (a === 'item') s.itemN++;
    else if (a === 'ability') s.abilityN++;
    this.onAction(a);
  }
  setTouchBoost(v: boolean) { this.touchBoost = v; }
  setTouchSlide(v: boolean) { this.touchSlide = v; }

  /** Poll held keys and gamepads once per frame. */
  poll(): InputState {
    const k = this.keys;
    let boost = k.has('ShiftLeft') || k.has('ShiftRight') || this.touchBoost;
    let slide = k.has('ArrowDown') || k.has('KeyS') || this.touchSlide;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const btn = (i: number) => !!p.buttons[i]?.pressed;
      const edge = (i: number, a: Action) => { const now = btn(i); if (now && !this.padPrev[i]) this.press(a); this.padPrev[i] = now; };
      edge(0, 'jump'); edge(2, 'item'); edge(3, 'ability'); edge(14, 'left'); edge(15, 'right'); edge(12, 'jump');
      if (btn(9) && !this.padPrev[9]) this.onPause();
      this.padPrev[9] = btn(9);
      const ax = p.axes[0] ?? 0;
      const dir = ax < -0.6 ? -1 : ax > 0.6 ? 1 : 0;
      if (dir !== 0 && dir !== this.padAxisPrev) this.press(dir < 0 ? 'left' : 'right');
      this.padAxisPrev = dir;
      boost = boost || btn(7) || btn(5);
      slide = slide || btn(1) || btn(13) || (p.axes[1] ?? 0) > 0.6;
      break;
    }
    this.state.boost = this.enabled && boost;
    this.state.slide = this.enabled && slide;
    return this.state;
  }

  /** Start a new race with fresh counters. */
  reset(): void { this.state = emptyInput(); }
}

export const input = new InputManager();
