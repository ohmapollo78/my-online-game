// Procedural, rigged 3D animals. Each animal is a small skeleton of bones; every bone owns
// a merged mesh built from ellipsoids/capsules/cones with per-vertex fur patterns.
import { MeshBuilder, Mesh, M, RGB, ColorSpec } from '../engine/mesh';
import { hexToRgb } from '../engine/math';

export const B = {
  BODY: 0, HEAD: 1, EAR_L: 2, EAR_R: 3, EYES: 4, TONGUE: 5,
  TAIL0: 6, TAIL1: 7, TAIL2: 8,
  FLU: 9, FLL: 10, FRU: 11, FRL: 12, BLU: 13, BLL: 14, BRU: 15, BRL: 16,
} as const;
export const BONE_COUNT = 17;
export const BONE_PARENT = [-1, 0, 1, 1, 1, 1, 0, 6, 7, 0, 9, 0, 11, 0, 13, 0, 15];

export interface Palette { main: RGB; belly: RGB; accent: RGB; nose: RGB; iris: RGB; inner: RGB; collar: RGB; stripe: RGB; }

export interface AnimalSpec {
  id: string;
  scale: number;
  body: [number, number, number]; // radii x(w) y(h) z(len)
  headR: number;
  headOff: [number, number, number];
  snout: [number, number, number]; // radii
  eyeR: number;
  eyeSpread: number;
  ear: 'flop' | 'point' | 'cat';
  earSize: number;
  tail: 'curl' | 'fluffy' | 'stub' | 'long';
  legU: number; legL: number; legR: number; pawR: number;
  legX: number; legZf: number; legZb: number;
  spec: number;
  palette: Palette;
}

const c = (h: number): RGB => hexToRgb(h);

export const SPECS: AnimalSpec[] = [
  { id: 'pug', scale: 1.45, body: [0.27, 0.25, 0.36], headR: 0.25, headOff: [0, 0.2, 0.34], snout: [0.12, 0.08, 0.06], eyeR: 0.065, eyeSpread: 0.1,
    ear: 'flop', earSize: 0.1, tail: 'curl', legU: 0.13, legL: 0.11, legR: 0.065, pawR: 0.07, legX: 0.15, legZf: 0.2, legZb: -0.2, spec: 0.12,
    palette: { main: c(0xe0bb85), belly: c(0xecd2a6), accent: c(0x2b211b), nose: c(0x1a1412), iris: c(0x3a2414), inner: c(0x2b211b), collar: c(0xd8262f), stripe: c(0xc79e66) } },
  { id: 'husky', scale: 1.35, body: [0.2, 0.22, 0.48], headR: 0.19, headOff: [0, 0.22, 0.47], snout: [0.085, 0.075, 0.17], eyeR: 0.05, eyeSpread: 0.085,
    ear: 'point', earSize: 0.13, tail: 'fluffy', legU: 0.24, legL: 0.24, legR: 0.055, pawR: 0.06, legX: 0.11, legZf: 0.3, legZb: -0.3, spec: 0.15,
    palette: { main: c(0x5f6670), belly: c(0xf4f4f6), accent: c(0x3c4148), nose: c(0x18181b), iris: c(0x47a6ff), inner: c(0xf0e4e4), collar: c(0x2f6bff), stripe: c(0x4b5058) } },
  { id: 'rottweiler', scale: 1.35, body: [0.26, 0.27, 0.5], headR: 0.22, headOff: [0, 0.22, 0.5], snout: [0.11, 0.09, 0.13], eyeR: 0.048, eyeSpread: 0.095,
    ear: 'flop', earSize: 0.1, tail: 'stub', legU: 0.24, legL: 0.22, legR: 0.075, pawR: 0.08, legX: 0.15, legZf: 0.32, legZb: -0.3, spec: 0.22,
    palette: { main: c(0x1c1917), belly: c(0xa25a26), accent: c(0xa25a26), nose: c(0x0c0b0a), iris: c(0x4a2a12), inner: c(0x1c1917), collar: c(0xf08a12), stripe: c(0x131110) } },
  { id: 'orangecat', scale: 1.4, body: [0.16, 0.17, 0.36], headR: 0.19, headOff: [0, 0.18, 0.35], snout: [0.07, 0.05, 0.04], eyeR: 0.06, eyeSpread: 0.085,
    ear: 'cat', earSize: 0.11, tail: 'long', legU: 0.16, legL: 0.16, legR: 0.045, pawR: 0.05, legX: 0.09, legZf: 0.23, legZb: -0.22, spec: 0.12,
    palette: { main: c(0xf39a3a), belly: c(0xfff0dc), accent: c(0xc8601c), nose: c(0xf08aa0), iris: c(0x6fd04a), inner: c(0xf7b7c2), collar: c(0x22c0b8), stripe: c(0xc8601c) } },
  { id: 'blackcat', scale: 1.4, body: [0.15, 0.16, 0.4], headR: 0.175, headOff: [0, 0.18, 0.39], snout: [0.065, 0.048, 0.04], eyeR: 0.058, eyeSpread: 0.08,
    ear: 'cat', earSize: 0.12, tail: 'long', legU: 0.18, legL: 0.18, legR: 0.042, pawR: 0.045, legX: 0.085, legZf: 0.26, legZb: -0.25, spec: 0.45,
    palette: { main: c(0x15151c), belly: c(0x1d1d26), accent: c(0x2a2a36), nose: c(0x2a2026), iris: c(0xffd21a), inner: c(0x3a2a34), collar: c(0x9b4dff), stripe: c(0x101016) } },
];

export function bodyY(s: AnimalSpec): number { return s.legU + s.legL + s.pawR * 0.6 + s.body[1] * 0.45; }

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Cosmetic skins recolour the palette only (pure visuals). */
export function skinPalette(p: Palette, skin: string): Palette {
  if (skin === 'skin_gold') {
    const g = c(0xf2c230), d = c(0xc8901a);
    return { ...p, main: g, belly: mix(g, [1, 1, 0.85], 0.5), accent: d, stripe: d, collar: c(0x6a2bd9) };
  }
  if (skin === 'skin_midnight') {
    const m = c(0x283a8a), d = c(0x161f52);
    return { ...p, main: m, belly: c(0x7ea2ff), accent: d, stripe: c(0x9b6bff), collar: c(0xffd21a), iris: c(0x9cf3ff) };
  }
  if (skin === 'skin_candy') {
    return { ...p, main: c(0xffa9d4), belly: c(0xfff3fa), accent: c(0x7fe0d0), stripe: c(0xff7fbf), collar: c(0x7fe0d0) };
  }
  return p;
}

export interface AnimalModel {
  spec: AnimalSpec;
  meshes: (Mesh | null)[];
  /** rest translation of each bone relative to its parent */
  offsets: number[][];
  /** rest rotation (rx, ry, rz) */
  rest: number[][];
  headTop: number[]; // anchor in head space
  eyeFront: number[];
  neck: number[]; // anchor in body space
  back: number[];
  /** Blender-made skinned model; when present it replaces the procedural meshes */
  glb?: import('./glbCharacters').GlbCharacter;
}

export function buildAnimal(gl: WebGL2RenderingContext, animal: number, skin = ''): AnimalModel {
  const s = SPECS[animal];
  const p = skinPalette(s.palette, skin);
  const [bw, bh, bl] = s.body;
  const id = s.id;
  const builders: MeshBuilder[] = Array.from({ length: BONE_COUNT }, () => new MeshBuilder());

  // ---------------------------------------------------------------- body (pivot = body centre)
  const bodyColor: ColorSpec = (x, y, z) => {
    const ny = y / bh, nz = z / bl;
    if (id === 'husky') {
      if (ny < -0.15 || (nz > 0.55 && ny < 0.35)) return p.belly;
      if (ny > 0.55) return p.accent;
      return p.main;
    }
    if (id === 'rottweiler') {
      if (nz > 0.6 && ny < 0.15 && Math.abs(x) < bw * 0.55) return p.accent;
      return p.main;
    }
    if (id === 'orangecat') {
      if (ny < -0.35) return p.belly;
      if (Math.sin(z * 26 + Math.abs(x) * 6) > 0.3 && ny > -0.25) return p.stripe;
      return p.main;
    }
    if (id === 'pug') {
      if (ny < -0.3) return p.belly;
      return p.main;
    }
    return p.main;
  };
  const bb = builders[B.BODY];
  bb.sphere(M(0, 0, 0), bw, bh, bl, bodyColor, 22, 14);
  if (id === 'rottweiler') { // muscular chest and haunches
    bb.sphere(M(0, -0.02, bl * 0.5), bw * 1.08, bh * 0.95, bl * 0.45, bodyColor, 16, 10);
    bb.sphere(M(0, 0.0, -bl * 0.55), bw * 0.98, bh * 0.9, bl * 0.42, bodyColor, 16, 10);
  }
  if (id === 'husky') { // fluffy ruff
    bb.sphere(M(0, 0.04, bl * 0.62), bw * 1.05, bh * 1.05, bl * 0.32, (x, y) => (y < 0 ? p.belly : p.main), 16, 10);
  }
  if (id === 'pug') { // chubby rolls
    bb.torus(M(0, 0.02, bl * 0.45, Math.PI / 2, 0, 0), bw * 0.88, 0.035, p.stripe, 18, 6);
  }
  // collar
  const neckZ = bl * 0.78, neckY = bh * 0.35;
  bb.torus(M(0, neckY, neckZ, Math.PI / 2 - 0.35, 0, 0), Math.max(bw * 0.62, s.headR * 0.62), 0.028, p.collar, 20, 6);
  bb.sphere(M(0, neckY - Math.max(bw * 0.62, s.headR * 0.62) * 0.95, neckZ + 0.05), 0.035, 0.035, 0.02, c(0xffd24a), 8, 6);

  // ---------------------------------------------------------------- head (pivot = neck)
  const hr = s.headR;
  const hb = builders[B.HEAD];
  const headColor: ColorSpec = (x, y, z) => {
    const ny = y / hr;
    if (id === 'husky') {
      // classic husky mask: grey cap with white face and eyebrow spots
      const brow = Math.hypot(Math.abs(x) - s.eyeSpread, y - hr * 0.45) < hr * 0.13 && z > 0;
      if (brow) return p.belly;
      if (ny > 0.2 && !(z > hr * 0.5 && Math.abs(x) < hr * 0.18 && ny < 0.55)) return p.main;
      return p.belly;
    }
    if (id === 'rottweiler') {
      const brow = Math.hypot(Math.abs(x) - s.eyeSpread, y - hr * 0.42) < hr * 0.12 && z > 0;
      if (brow) return p.accent;
      if (ny < -0.25 && z > 0) return p.accent;
      return p.main;
    }
    if (id === 'pug') {
      if (z > hr * 0.55 && ny < 0.25) return p.accent; // black mask
      return p.main;
    }
    if (id === 'orangecat') {
      if (ny < -0.3 && z > 0) return p.belly;
      if (ny > 0.35 && Math.sin(x * 60) > 0.4 && z > -hr * 0.2) return p.stripe;
      return p.main;
    }
    return p.main;
  };
  const headSquash = id.includes('cat') ? 0.88 : id === 'pug' ? 0.92 : 0.95;
  hb.sphere(M(0, 0, 0), hr * (id.includes('cat') ? 1.08 : 1), hr * headSquash, hr, headColor, 22, 16);
  // snout / muzzle
  const [sx, sy, sz] = s.snout;
  const snoutColor: ColorSpec = id === 'husky' ? p.belly : id === 'rottweiler' ? p.accent : id === 'pug' ? p.accent : id === 'orangecat' ? p.belly : p.main;
  const snoutZ = hr * 0.82;
  hb.sphere(M(0, -hr * 0.3, snoutZ + sz * 0.5), sx, sy, Math.max(sz, 0.05), snoutColor, 14, 10);
  if (id.includes('cat')) { // cheek puffs
    hb.sphere(M(-sx * 0.55, -hr * 0.36, snoutZ + 0.02), sx * 0.6, sy * 0.85, 0.05, snoutColor, 10, 8);
    hb.sphere(M(sx * 0.55, -hr * 0.36, snoutZ + 0.02), sx * 0.6, sy * 0.85, 0.05, snoutColor, 10, 8);
    // whiskers
    for (const side of [-1, 1]) for (let k = 0; k < 3; k++) {
      hb.box(M(side * (sx + 0.06), -hr * 0.33 + k * 0.018, snoutZ + 0.03, 0, side * 0.15, side * (k - 1) * 0.12), 0.14, 0.004, 0.004, [0.95, 0.95, 0.95]);
    }
  }
  // nose
  const noseZ = snoutZ + Math.max(sz, 0.05) * 1.35;
  hb.sphere(M(0, -hr * 0.22, noseZ), id.includes('cat') ? 0.025 : 0.045, id.includes('cat') ? 0.018 : 0.03, 0.025, p.nose, 10, 8);
  // mouth line
  hb.box(M(0, -hr * 0.3 - sy * 0.75, noseZ - 0.03), sx * 0.9, 0.012, 0.02, [0.12, 0.06, 0.06]);
  if (id === 'pug') { // wrinkles
    for (let k = 0; k < 3; k++) hb.torus(M(0, hr * (0.28 + k * 0.1), hr * (0.86 - k * 0.07), -0.2, 0, Math.PI), hr * (0.28 - k * 0.04), 0.012, p.stripe, 14, 5, Math.PI * 0.8);
    hb.torus(M(0, -hr * 0.05, snoutZ + 0.02, -0.25, 0, Math.PI), sx * 0.9, 0.014, [0.12, 0.1, 0.09], 14, 5, Math.PI * 0.9);
  }

  // ---------------------------------------------------------------- eyes (own bone for blinking)
  const eb = builders[B.EYES];
  const eyeY = hr * 0.15, eyeZ = hr * 0.78;
  for (const side of [-1, 1]) {
    const ex = side * s.eyeSpread * (id === 'pug' ? 1.25 : 1);
    eb.sphere(M(ex, 0, 0), s.eyeR, s.eyeR * 1.05, s.eyeR * 0.7, [0.98, 0.98, 0.98], 12, 10);
    eb.sphere(M(ex, -s.eyeR * 0.05, s.eyeR * 0.45), s.eyeR * 0.72, s.eyeR * 0.78, s.eyeR * 0.35, p.iris, 12, 8);
    const pupilW = id.includes('cat') ? 0.25 : 0.45;
    eb.sphere(M(ex, -s.eyeR * 0.05, s.eyeR * 0.62), s.eyeR * pupilW, s.eyeR * 0.6, s.eyeR * 0.22, [0.03, 0.03, 0.04], 10, 8);
    eb.sphere(M(ex + s.eyeR * 0.25, s.eyeR * 0.3, s.eyeR * 0.72), s.eyeR * 0.18, s.eyeR * 0.18, s.eyeR * 0.1, [1, 1, 1], 8, 6, 0.9);
  }

  // ---------------------------------------------------------------- ears
  for (const side of [-1, 1]) {
    const eb2 = builders[side < 0 ? B.EAR_L : B.EAR_R];
    const e = s.earSize;
    if (s.ear === 'flop') {
      eb2.sphere(M(side * 0.02, -e * 0.7, 0, 0, 0, side * 0.2), e * 0.75, e * 1.1, e * 0.25, id === 'pug' ? p.accent : p.main, 12, 8);
    } else if (s.ear === 'point') {
      eb2.cylinder(M(0, 0, 0, -0.1, 0, 0), 0.004, e * 0.6, e * 1.5, p.main, 4, true);
      eb2.cylinder(M(0, 0.01, 0.025, -0.1, 0, 0), 0.003, e * 0.38, e * 1.15, p.inner, 4, true);
    } else {
      eb2.cylinder(M(0, 0, 0, -0.05, Math.PI / 4, 0), 0.004, e * 0.62, e * 1.25, p.main, 4, true);
      eb2.cylinder(M(0, 0.005, 0.03, -0.05, Math.PI / 4, 0), 0.003, e * 0.4, e * 0.95, p.inner, 4, true);
    }
  }

  // ---------------------------------------------------------------- tongue
  builders[B.TONGUE].sphere(M(0, -0.02, 0.04), 0.035, 0.012, 0.06, c(0xff6f8a), 10, 6);

  // ---------------------------------------------------------------- tail
  if (s.tail === 'curl') {
    builders[B.TAIL0].torus(M(0, 0.06, 0, 0, 0, Math.PI / 2), 0.055, 0.03, p.main, 16, 8, Math.PI * 1.7);
  } else if (s.tail === 'stub') {
    builders[B.TAIL0].sphere(M(0, 0.03, -0.02), 0.04, 0.05, 0.04, p.main, 10, 8);
  } else if (s.tail === 'fluffy') {
    builders[B.TAIL0].sphere(M(0, 0, -0.08), 0.07, 0.07, 0.11, p.main, 12, 8);
    builders[B.TAIL1].sphere(M(0, 0, -0.08), 0.08, 0.08, 0.11, p.main, 12, 8);
    builders[B.TAIL2].sphere(M(0, 0, -0.07), 0.07, 0.07, 0.09, p.belly, 12, 8);
  } else {
    const tailCol: ColorSpec = id === 'orangecat' ? (_x, _y, z) => (Math.sin(z * 40) > 0.2 ? p.stripe : p.main) : p.main;
    builders[B.TAIL0].capsule(M(0, 0, -0.1, Math.PI / 2, 0, 0), 0.032, 0.16, tailCol, 10);
    builders[B.TAIL1].capsule(M(0, 0, -0.1, Math.PI / 2, 0, 0), 0.03, 0.16, tailCol, 10);
    builders[B.TAIL2].capsule(M(0, 0, -0.09, Math.PI / 2, 0, 0), 0.028, 0.13, id === 'orangecat' ? p.stripe : p.main, 10);
  }

  // ---------------------------------------------------------------- legs
  const legColorU: ColorSpec = id === 'husky' ? (_x, y) => (y < -s.legU * 0.5 ? p.belly : p.main) : p.main;
  const lowerColor: RGB = id === 'husky' ? p.belly : id === 'rottweiler' ? p.accent : id === 'orangecat' ? p.main : p.main;
  const pawColor: RGB = id === 'husky' || id === 'orangecat' ? p.belly : id === 'rottweiler' ? p.accent : id === 'pug' ? p.belly : p.main;
  for (const [u, l, front] of [[B.FLU, B.FLL, 1], [B.FRU, B.FRL, 1], [B.BLU, B.BLL, 0], [B.BRU, B.BRL, 0]] as const) {
    const thick = front ? 1 : 1.18;
    builders[u].capsule(M(0, -s.legU / 2, 0), s.legR * thick, s.legU, legColorU, 10);
    if (!front) builders[u].sphere(M(0, -s.legU * 0.1, 0), s.legR * 1.9, s.legR * 2.1, s.legR * 2.2, legColorU, 12, 8); // thigh
    builders[l].capsule(M(0, -s.legL / 2, 0), s.legR * 0.9, s.legL, lowerColor, 10);
    builders[l].sphere(M(0, -s.legL - s.pawR * 0.2, s.pawR * 0.35), s.pawR * 1.1, s.pawR * 0.75, s.pawR * 1.35, pawColor, 12, 8);
  }

  const meshes = builders.map((b) => (b.vertexCount ? b.build(gl) : null));
  const legY = -bh * 0.45;
  const offsets: number[][] = new Array(BONE_COUNT);
  offsets[B.BODY] = [0, bodyY(s), 0];
  offsets[B.HEAD] = [...s.headOff];
  offsets[B.EAR_L] = s.ear === 'flop' ? [-hr * 0.72, hr * 0.45, -hr * 0.05] : [-hr * 0.5, hr * 0.62, -hr * 0.05];
  offsets[B.EAR_R] = s.ear === 'flop' ? [hr * 0.72, hr * 0.45, -hr * 0.05] : [hr * 0.5, hr * 0.62, -hr * 0.05];
  offsets[B.EYES] = [0, eyeY, eyeZ];
  offsets[B.TONGUE] = [0, -hr * 0.3 - sy * 0.8, noseZ - 0.04];
  offsets[B.TAIL0] = [0, bh * 0.55, -bl * 0.92];
  offsets[B.TAIL1] = [0, 0, s.tail === 'fluffy' ? -0.17 : -0.2];
  offsets[B.TAIL2] = [0, 0, s.tail === 'fluffy' ? -0.17 : -0.2];
  offsets[B.FLU] = [-s.legX, legY, s.legZf]; offsets[B.FRU] = [s.legX, legY, s.legZf];
  offsets[B.BLU] = [-s.legX, legY, s.legZb]; offsets[B.BRU] = [s.legX, legY, s.legZb];
  offsets[B.FLL] = [0, -s.legU, 0]; offsets[B.FRL] = [0, -s.legU, 0];
  offsets[B.BLL] = [0, -s.legU, 0]; offsets[B.BRL] = [0, -s.legU, 0];
  const rest: number[][] = Array.from({ length: BONE_COUNT }, () => [0, 0, 0]);
  if (s.tail === 'long') { rest[B.TAIL0] = [0.55, 0, 0]; rest[B.TAIL1] = [0.45, 0, 0]; rest[B.TAIL2] = [0.4, 0, 0]; }
  if (s.tail === 'fluffy') { rest[B.TAIL0] = [0.9, 0, 0]; rest[B.TAIL1] = [0.8, 0, 0]; rest[B.TAIL2] = [0.7, 0, 0]; }
  if (s.ear === 'point') { rest[B.EAR_L] = [0, 0, 0.18]; rest[B.EAR_R] = [0, 0, -0.18]; }
  if (s.ear === 'cat') { rest[B.EAR_L] = [0, 0, 0.3]; rest[B.EAR_R] = [0, 0, -0.3]; }
  return {
    spec: s, meshes, offsets, rest,
    headTop: [0, hr * 0.9, -hr * 0.05],
    eyeFront: [0, eyeY, eyeZ + s.eyeR * 0.6],
    neck: [0, neckY, neckZ],
    back: [0, bh * 0.95, -bl * 0.1],
  };
}
