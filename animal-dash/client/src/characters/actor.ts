// AnimalActor: a renderable, animated animal instance (model + cosmetics + animator).
// Two model kinds:
//  * procedural (rigid parts per bone), animated by the procedural Animator;
//  * Blender GLB (skinned). Idle/Run play the baked Blender clips (Run is phase-locked to the
//    distance travelled so paws don't slide); every other state (jump, slide, knockdown,
//    victory…) is driven by the procedural Animator on the same skeleton, with per-joint
//    cross-fades between the two. Blink and tongue always stay procedural.
import { Renderer, DrawOpts } from '../engine/renderer';
import { Mat4, mat4, multiply, compose, identity, invert, damp } from '../engine/math';
import { AnimalModel, buildAnimal, BONE_COUNT, BONE_PARENT, B } from './animalModels';
import { Animator, AnimInput, P } from '../animations/animator';
import { getCosmetic, CosmeticPart } from './cosmetics';
import { Loadout } from '@shared/progression';
import { ANIMALS } from '@shared/animals';
import { RS } from '@shared/constants';
import { glbCharacters, glbOffsets } from './glbCharacters';
import { evaluateClip, GltfClip } from '../engine/gltf';

const modelCache = new Map<string, AnimalModel>();
export function getAnimalModel(gl: WebGL2RenderingContext, animal: number, skin = ''): AnimalModel {
  const key = `${animal}:${skin}`;
  let m = modelCache.get(key);
  if (!m) {
    m = buildAnimal(gl, animal, skin);
    const glb = glbCharacters[animal];
    if (glb) {
      m = {
        ...m, glb, offsets: glbOffsets(glb), rest: Array.from({ length: BONE_COUNT }, () => [0, 0, 0]),
        headTop: glb.headTop, eyeFront: glb.eyeFront,
        // cosmetics read eye spacing/size from the spec; only the copy used by this model is changed
        spec: { ...m.spec, eyeSpread: glb.eyeSpread, eyeR: glb.eyeR },
      };
    }
    modelCache.set(key, m);
  }
  return m;
}

/** Cosmetic skins tint the Blender model (pure visuals). */
const SKIN_TINT: Record<string, number[]> = {
  skin_gold: [1.25, 1.0, 0.42], skin_midnight: [0.42, 0.52, 1.15], skin_candy: [1.2, 0.78, 0.98],
};

const tmp = mat4();
const rootM = mat4();
const tmp2 = mat4();
const PROC_ONLY = new Set<number>([B.EYES, B.TONGUE]);

export class AnimalActor {
  readonly animal: number;
  model: AnimalModel;
  anim: Animator;
  world: Mat4[] = Array.from({ length: BONE_COUNT }, () => mat4());
  cosmetics: CosmeticPart[] = [];
  loadout: Loadout | null = null;
  scaleMul = 1;
  // ---- skinned-model state
  private chain: Mat4[] = Array.from({ length: BONE_COUNT }, () => mat4());
  private procX: Mat4[] = Array.from({ length: BONE_COUNT }, () => mat4());
  private finalX: Mat4[] = Array.from({ length: BONE_COUNT }, () => mat4());
  private nodeWorld: Mat4[] = [];
  private clipScratch = { t: [] as number[][], r: [] as number[][], s: [] as number[][] };
  joints: Float32Array | null = null;
  private clip: GltfClip | null = null;
  private clipWeight = 0;
  private idleTime = 0;
  private lastInput: Omit<AnimInput, 'stride'> | null = null;

  constructor(private gl: WebGL2RenderingContext, animal: number, loadout: Loadout | null = null) {
    this.animal = animal;
    this.model = getAnimalModel(gl, animal, loadout?.skin ?? '');
    this.anim = new Animator(this.model.spec);
    this.setLoadout(loadout);
  }

  setLoadout(l: Loadout | null): void {
    this.loadout = l;
    this.model = getAnimalModel(this.gl, this.animal, l?.skin ?? '');
    if (this.model.glb && !this.joints) this.joints = new Float32Array(this.model.glb.jointBone.length * 16);
    this.cosmetics = [];
    if (!l) return;
    for (const id of [l.hat, l.glasses, l.outfit, l.accessory]) {
      const c = getCosmetic(this.gl, id, this.model, this.animal);
      if (c) this.cosmetics.push(c);
    }
  }

  update(a: Omit<AnimInput, 'stride'>): void {
    this.anim.update({ ...a, stride: ANIMALS[this.animal].stride });
    this.lastInput = a;
    const glb = this.model.glb;
    if (!glb) return;
    // choose the baked clip for this state (null = procedural)
    const runLike = (a.state === RS.RUN || (a.state === RS.FINISHED && !a.victory)) && a.grounded && !a.exhausted && a.landT <= 0.02 && a.speed > 0.5;
    const want = a.state === RS.IDLE ? glb.clips.idle : runLike ? glb.clips.run : null;
    if (want) this.clip = want;
    this.clipWeight = damp(this.clipWeight, want ? 1 : 0, 14, a.dt);
    this.idleTime += a.dt;
  }

  /** base: world transform at the animal's feet (origin on the ground, +z forward). */
  computeBones(base: Mat4): void {
    const r = this.anim.root;
    const s = this.model.spec.scale * this.scaleMul;
    const bodyH = this.model.offsets[B.BODY][1] * s;
    // pivot root rotations around the body centre so rolls/flips look natural
    compose(tmp, 0, r.y * s + bodyH, 0, r.pitch, r.yaw, r.roll, s, s, s);
    multiply(rootM, base, tmp);
    compose(tmp, 0, -this.model.offsets[B.BODY][1], 0, 0, 0, 0);
    multiply(rootM, rootM, tmp);
    const pose = this.anim.pose;
    const off = this.model.offsets, rest = this.model.rest;
    for (let b = 0; b < BONE_COUNT; b++) {
      const o = b * P;
      compose(tmp, off[b][0] + pose[o + 3], off[b][1] + pose[o + 4], off[b][2] + pose[o + 5],
        rest[b][0] + pose[o], rest[b][1] + pose[o + 1], rest[b][2] + pose[o + 2], pose[o + 6], pose[o + 7], pose[o + 8]);
      const parent = BONE_PARENT[b];
      if (parent < 0) this.chain[b].set(tmp); else multiply(this.chain[b], this.chain[parent], tmp);
      multiply(this.world[b], rootM, this.chain[b]);
    }
    if (this.model.glb) this.computeSkin();
  }

  private computeSkin(): void {
    const glb = this.model.glb!;
    const restPos = glb.restPos;
    // procedural skin transform per bone: chain * T(-rest)
    for (let b = 0; b < BONE_COUNT; b++) {
      compose(tmp, -restPos[b][0], -restPos[b][1], -restPos[b][2], 0, 0, 0);
      multiply(this.procX[b], this.chain[b], tmp);
    }
    const w = this.clipWeight;
    if (w > 0.001 && this.clip) {
      const clip = this.clip;
      let t: number;
      if (clip === glb.clips.run) t = (((this.anim.phase / (Math.PI * 2)) % 1) + 1) % 1 * clip.duration;
      else t = this.idleTime;
      evaluateClip(glb.gltf, clip, t, this.nodeWorld, this.clipScratch);
    }
    for (let b = 0; b < BONE_COUNT; b++) {
      const parent = BONE_PARENT[b];
      const X = this.finalX[b];
      if (PROC_ONLY.has(b) && parent >= 0) {
        // keep the procedural local motion (blink / tongue) relative to the blended parent
        invert(tmp, this.procX[parent]);
        multiply(tmp2, tmp, this.procX[b]);
        multiply(X, this.finalX[parent], tmp2);
      } else if (w > 0.001 && this.clip) {
        multiply(tmp, this.nodeWorld[glb.boneNode[b]], glb.ibm[glb.boneJoint[b]]);
        if (w >= 0.999) X.set(tmp); else blendRigid(X, this.procX[b], tmp, w);
      } else X.set(this.procX[b]);
    }
    const J = this.joints!;
    glb.jointBone.forEach((b, j) => {
      if (b >= 0) multiply(tmp, rootM, this.finalX[b]); else tmp.set(rootM);
      J.set(tmp, j * 16);
    });
    // attachment matrices for cosmetics / effects follow the final skin
    for (let b = 0; b < BONE_COUNT; b++) {
      compose(tmp, restPos[b][0], restPos[b][1], restPos[b][2], 0, 0, 0);
      multiply(tmp2, this.finalX[b], tmp);
      multiply(this.world[b], rootM, tmp2);
    }
  }

  draw(r: Renderer, opts: DrawOpts = {}): void {
    const o: DrawOpts = { rim: 0.45, spec: this.model.spec.spec, ...opts };
    const glb = this.model.glb;
    if (glb && this.joints) {
      const skinTint = this.loadout?.skin ? SKIN_TINT[this.loadout.skin] : undefined;
      const tint = o.tint ?? skinTint ?? null;
      for (const p of glb.parts) r.draw(p.mesh, this.world[B.BODY], { ...o, tint, spec: o.spec && o.spec > 1 ? o.spec : p.spec, joints: this.joints });
    } else {
      const meshes = this.model.meshes;
      for (let b = 0; b < BONE_COUNT; b++) {
        const m = meshes[b];
        if (!m) continue;
        if (b === B.TONGUE && this.anim.tongue < 0.05) continue;
        r.draw(m, this.world[b], o);
      }
    }
    for (const c of this.cosmetics) r.draw(c.mesh, this.world[c.bone], { ...o, tint: null, flash: opts.flash, joints: null });
  }

  /** World position of a bone origin (for particle effects, name tags). */
  bonePos(b: number, out: number[]): number[] {
    const w = this.world[b];
    out[0] = w[12]; out[1] = w[13]; out[2] = w[14];
    return out;
  }
}

// ------------------------------------------------------------------ rigid transform blending
const qa = [0, 0, 0, 1], qb = [0, 0, 0, 1];
function matToQuat(m: Mat4, sx: number, sy: number, sz: number, q: number[]): void {
  const m00 = m[0] / sx, m01 = m[4] / sy, m02 = m[8] / sz;
  const m10 = m[1] / sx, m11 = m[5] / sy, m12 = m[9] / sz;
  const m20 = m[2] / sx, m21 = m[6] / sy, m22 = m[10] / sz;
  const tr = m00 + m11 + m22;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q[3] = 0.25 * s; q[0] = (m21 - m12) / s; q[1] = (m02 - m20) / s; q[2] = (m10 - m01) / s; }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; q[3] = (m21 - m12) / s; q[0] = 0.25 * s; q[1] = (m01 + m10) / s; q[2] = (m02 + m20) / s; }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; q[3] = (m02 - m20) / s; q[0] = (m01 + m10) / s; q[1] = 0.25 * s; q[2] = (m12 + m21) / s; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; q[3] = (m10 - m01) / s; q[0] = (m02 + m20) / s; q[1] = (m12 + m21) / s; q[2] = 0.25 * s; }
}
/** out = blend of two TRS matrices (rotation slerp-ish nlerp, linear translation & scale). */
function blendRigid(out: Mat4, a: Mat4, b: Mat4, w: number): void {
  const sa = [Math.hypot(a[0], a[1], a[2]), Math.hypot(a[4], a[5], a[6]), Math.hypot(a[8], a[9], a[10])];
  const sb = [Math.hypot(b[0], b[1], b[2]), Math.hypot(b[4], b[5], b[6]), Math.hypot(b[8], b[9], b[10])];
  matToQuat(a, sa[0], sa[1], sa[2], qa);
  matToQuat(b, sb[0], sb[1], sb[2], qb);
  const d = qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3];
  const sgn = d < 0 ? -1 : 1;
  const q = [0, 0, 0, 0];
  let len = 0;
  for (let i = 0; i < 4; i++) { q[i] = qa[i] * (1 - w) + qb[i] * sgn * w; len += q[i] * q[i]; }
  len = Math.sqrt(len) || 1;
  const [x, y, z, ww] = [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
  const s = [sa[0] + (sb[0] - sa[0]) * w, sa[1] + (sb[1] - sa[1]) * w, sa[2] + (sb[2] - sa[2]) * w];
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = ww * x2, wy = ww * y2, wz = ww * z2;
  out[0] = (1 - (yy + zz)) * s[0]; out[1] = (xy + wz) * s[0]; out[2] = (xz - wy) * s[0]; out[3] = 0;
  out[4] = (xy - wz) * s[1]; out[5] = (1 - (xx + zz)) * s[1]; out[6] = (yz + wx) * s[1]; out[7] = 0;
  out[8] = (xz + wy) * s[2]; out[9] = (yz - wx) * s[2]; out[10] = (1 - (xx + yy)) * s[2]; out[11] = 0;
  out[12] = a[12] + (b[12] - a[12]) * w; out[13] = a[13] + (b[13] - a[13]) * w; out[14] = a[14] + (b[14] - a[14]) * w; out[15] = 1;
}

export { identity };
