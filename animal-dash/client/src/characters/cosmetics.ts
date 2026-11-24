// Cosmetic meshes (hats, glasses, outfits, accessories). Purely visual; built per animal so
// they fit each body, then attached to the head or body bone.
import { MeshBuilder, Mesh, M, RGB } from '../engine/mesh';
import { hexToRgb } from '../engine/math';
import { AnimalModel, B } from './animalModels';

export interface CosmeticPart { mesh: Mesh; bone: number; }
const c = (h: number): RGB => hexToRgb(h);
const cache = new Map<string, CosmeticPart | null>();

export function getCosmetic(gl: WebGL2RenderingContext, id: string, model: AnimalModel, animal: number): CosmeticPart | null {
  if (!id) return null;
  const key = `${animal}:${id}`;
  if (cache.has(key)) return cache.get(key)!;
  const part = build(gl, id, model);
  cache.set(key, part);
  return part;
}

function build(gl: WebGL2RenderingContext, id: string, m: AnimalModel): CosmeticPart | null {
  const b = new MeshBuilder();
  const s = m.spec;
  const hr = s.headR;
  const k = hr / 0.2;
  const [ht0, ht1, ht2] = m.headTop;
  const [ex, ey, ez] = m.eyeFront;
  const [bw, bh, bl] = s.body;
  const [nx, ny, nz] = m.neck;
  let bone: number = B.HEAD;
  switch (id) {
    case 'hat_cap':
      b.sphere(M(ht0, ht1 - 0.02 * k, ht2, 0, 0, 0), 0.17 * k, 0.11 * k, 0.17 * k, (_x, y) => (y < 0 ? c(0xd8262f) : c(0xd8262f)), 16, 8);
      b.cylinder(M(ht0, ht1 - 0.04 * k, ht2 + 0.15 * k, 0.12, 0, 0), 0.12 * k, 0.12 * k, 0.012 * k, c(0xb01c24), 16);
      b.sphere(M(ht0, ht1 + 0.09 * k, ht2), 0.025 * k, 0.02 * k, 0.025 * k, c(0xffffff), 8, 6);
      break;
    case 'hat_party':
      b.cylinder(M(ht0, ht1 - 0.03 * k, ht2, -0.15, 0, 0.15), 0.005, 0.1 * k, 0.28 * k, (_x, y) => (Math.floor(y / (0.05 * k)) % 2 ? c(0x3ad1ff) : c(0xff4fa8)), 16);
      b.sphere(M(ht0 + 0.04 * k, ht1 + 0.24 * k, ht2 - 0.04 * k), 0.035 * k, 0.035 * k, 0.035 * k, c(0xffe14a), 8, 6);
      break;
    case 'hat_beanie':
      b.sphere(M(ht0, ht1 - 0.03 * k, ht2), 0.18 * k, 0.15 * k, 0.18 * k, (_x, y) => (y < 0.02 * k ? c(0x2fb36b) : c(0x45d483)), 16, 10);
      b.sphere(M(ht0, ht1 + 0.13 * k, ht2), 0.05 * k, 0.05 * k, 0.05 * k, c(0xffffff), 10, 8);
      break;
    case 'hat_cowboy':
      b.cylinder(M(ht0, ht1 - 0.03 * k, ht2), 0.3 * k, 0.3 * k, 0.015 * k, c(0x8a5a2b), 20);
      b.cylinder(M(ht0, ht1 - 0.02 * k, ht2), 0.11 * k, 0.14 * k, 0.15 * k, c(0x9b6833), 16);
      b.cylinder(M(ht0, ht1 + 0.0 * k, ht2), 0.142 * k, 0.142 * k, 0.03 * k, c(0x3a2414), 16, false);
      break;
    case 'hat_top':
      b.cylinder(M(ht0, ht1 - 0.03 * k, ht2), 0.22 * k, 0.22 * k, 0.015 * k, c(0x141418), 20);
      b.cylinder(M(ht0, ht1 - 0.02 * k, ht2), 0.12 * k, 0.12 * k, 0.24 * k, c(0x1c1c22), 16);
      b.cylinder(M(ht0, ht1 + 0.0 * k, ht2), 0.123 * k, 0.123 * k, 0.04 * k, c(0xd8262f), 16, false);
      break;
    case 'hat_crown':
      b.cylinder(M(ht0, ht1 - 0.03 * k, ht2), 0.12 * k, 0.12 * k, 0.07 * k, c(0xf2c230), 16);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        b.cylinder(M(ht0 + Math.sin(a) * 0.11 * k, ht1 + 0.04 * k, ht2 + Math.cos(a) * 0.11 * k), 0.002, 0.03 * k, 0.07 * k, c(0xf2c230), 6);
        b.sphere(M(ht0 + Math.sin(a) * 0.12 * k, ht1, ht2 + Math.cos(a) * 0.12 * k), 0.018 * k, 0.018 * k, 0.018 * k, i % 2 ? c(0xff2f5f) : c(0x2fd0ff), 8, 6, 0.4);
      }
      break;
    case 'gl_round':
      for (const sd of [-1, 1]) b.torus(M(ex + sd * s.eyeSpread * 1.1, ey, ez + 0.02, Math.PI / 2, 0, 0), s.eyeR * 1.25, 0.008, c(0x2a2a2a), 18, 6);
      b.box(M(ex, ey + 0.01, ez + 0.03), s.eyeSpread * 0.5, 0.01, 0.01, c(0x2a2a2a));
      break;
    case 'gl_sun':
      for (const sd of [-1, 1]) b.superEllipsoid(M(ex + sd * s.eyeSpread * 1.1, ey, ez + 0.03), s.eyeR * 1.45, s.eyeR * 1.05, 0.012, 0.4, c(0x101418));
      b.box(M(ex, ey + 0.02, ez + 0.035), s.eyeSpread * 2.6, 0.015, 0.012, c(0x101418));
      break;
    case 'gl_goggles':
      for (const sd of [-1, 1]) {
        b.cylinder(M(ex + sd * s.eyeSpread * 1.1, ey, ez - 0.01, Math.PI / 2, 0, 0), s.eyeR * 1.3, s.eyeR * 1.3, 0.05, c(0xffa21a), 14);
        b.cylinder(M(ex + sd * s.eyeSpread * 1.1, ey, ez + 0.04, Math.PI / 2, 0, 0), s.eyeR * 1.05, s.eyeR * 1.05, 0.005, c(0x6fe3ff), 14, true, 0.5);
      }
      b.torus(M(0, ey, ez - hr * 0.75, 0, 0, 0), hr * 0.98, 0.012, c(0x333333), 24, 5);
      break;
    case 'gl_star':
      for (const sd of [-1, 1]) b.cylinder(M(ex + sd * s.eyeSpread * 1.15, ey, ez + 0.02, Math.PI / 2, 0, 0), s.eyeR * 1.6, s.eyeR * 1.6, 0.015, c(0xff4fa8), 5, true, 0.25);
      break;
    case 'out_scarf':
      bone = B.BODY;
      b.torus(M(nx, ny + 0.02, nz - 0.02, Math.PI / 2 - 0.35, 0, 0), Math.max(bw, hr) * 0.72, 0.05, (x) => (Math.sin(x * 60) > 0 ? c(0xff4848) : c(0xffffff)), 22, 8);
      b.box(M(nx + 0.08, ny - 0.15, nz + 0.1, 0.2, 0, 0.2), 0.07, 0.25, 0.03, c(0xff4848));
      break;
    case 'out_vest':
    case 'out_jersey': {
      bone = B.BODY;
      const col = id === 'out_vest' ? c(0xff8a00) : c(0x2f6bff);
      const stripe = id === 'out_vest' ? c(0xf4f4f4) : c(0xffffff);
      b.sphere(M(0, bh * 0.05, bl * 0.12), bw * 1.07, bh * 1.06, bl * 0.55, (_x, _y, z) => (Math.abs(z) < 0.04 ? stripe : col), 20, 12);
      break;
    }
    case 'out_cape':
      bone = B.BODY;
      b.box(M(0, bh * 0.75, -bl * 0.25, 0.25, 0, 0), bw * 2.0, 0.015, bl * 1.3, c(0xd8262f));
      b.box(M(0, bh * 0.77, -bl * 0.25, 0.25, 0, 0), bw * 1.6, 0.016, bl * 1.1, c(0xffd24a));
      break;
    case 'acc_bowtie':
      bone = B.BODY;
      for (const sd of [-1, 1]) b.cylinder(M(nx + sd * 0.06, ny - 0.06, nz + 0.1, 0, 0, -sd * Math.PI / 2), 0.005, 0.045, 0.07, c(0xe02a6a), 8);
      b.sphere(M(nx, ny - 0.06, nz + 0.1), 0.025, 0.025, 0.025, c(0xb01c4a), 8, 6);
      break;
    case 'acc_bell':
      bone = B.BODY;
      b.sphere(M(nx, ny - Math.max(bw, hr) * 0.62, nz + 0.08), 0.06, 0.06, 0.06, c(0xf2c230), 12, 8, 0.15);
      break;
    case 'acc_backpack':
      bone = B.BODY;
      b.roundBox(M(0, bh * 0.95, -bl * 0.1), bw * 1.2, 0.18, bl * 0.6, c(0x2fb36b));
      b.roundBox(M(0, bh * 0.95, -bl * 0.1 + bl * 0.31), bw * 0.9, 0.12, 0.04, c(0x228a51));
      break;
    case 'acc_wings':
      bone = B.BODY;
      for (const sd of [-1, 1]) b.sphere(M(sd * bw * 0.9, bh * 0.75, 0, 0.2, sd * 0.4, sd * -0.6), 0.22, 0.03, 0.12, c(0xffffff), 12, 6, 0.2);
      break;
    default:
      return null;
  }
  return { mesh: b.build(gl), bone };
}
