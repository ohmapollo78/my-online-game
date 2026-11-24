// Blender-made GLB characters (Stage 1+). Each GLB has a 17-joint skin named like the game's
// skeleton plus baked "Idle" and "Run" clips. Primitives are merged into two GPU meshes
// (matte fur + glossy eyes/nose) so a character costs two draw calls.
import { Mesh } from '../engine/mesh';
import { Mat4, mat4, invert } from '../engine/math';
import { GltfModel, GltfClip, loadGlb } from '../engine/gltf';
import { ANIMALS } from '@shared/animals';
import { B, BONE_COUNT, BONE_PARENT } from './animalModels';

/** Animals that have a Blender GLB (others keep the procedural model). */
export const GLB_ANIMALS = ['pug'];

const NAME_TO_BONE: Record<string, number> = {
  body: B.BODY, head: B.HEAD, ear_L: B.EAR_L, ear_R: B.EAR_R, eyes: B.EYES, tongue: B.TONGUE,
  tail0: B.TAIL0, tail1: B.TAIL1, tail2: B.TAIL2,
  leg_FL_up: B.FLU, leg_FL_low: B.FLL, leg_FR_up: B.FRU, leg_FR_low: B.FRL,
  leg_BL_up: B.BLU, leg_BL_low: B.BLL, leg_BR_up: B.BRU, leg_BR_low: B.BRL,
};

export interface GlbCharacter {
  gltf: GltfModel;
  parts: { mesh: Mesh; spec: number }[];
  /** skin joint index -> game bone index */
  jointBone: number[];
  /** game bone -> skin joint index (or -1) */
  boneJoint: number[];
  /** game bone -> glTF node index (or -1) */
  boneNode: number[];
  /** model-space rest position of each game bone */
  restPos: number[][];
  ibm: Mat4[];
  clips: { idle: GltfClip | null; run: GltfClip | null };
  /** top of the head relative to the head bone (for hats) */
  headTop: number[];
  /** glasses anchor relative to the head bone, eye spacing and eye radius (cosmetics are built from these) */
  eyeFront: number[];
  eyeSpread: number;
  eyeR: number;
  triangles: number;
}

export const glbCharacters: (GlbCharacter | null)[] = ANIMALS.map(() => null);

const toSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

function build(gl: WebGL2RenderingContext, g: GltfModel): GlbCharacter {
  if (!g.skin) throw new Error('character GLB has no skin');
  const skin = g.skin;
  const jointBone = skin.joints.map((n) => NAME_TO_BONE[g.nodes[n].name] ?? -1);
  const boneJoint = new Array(BONE_COUNT).fill(-1);
  const boneNode = new Array(BONE_COUNT).fill(-1);
  jointBone.forEach((b, j) => { if (b >= 0) { boneJoint[b] = j; boneNode[b] = skin.joints[j]; } });
  const missing = Object.keys(NAME_TO_BONE).filter((n) => boneJoint[NAME_TO_BONE[n]] < 0);
  if (missing.length) throw new Error(`character GLB is missing joints: ${missing.join(', ')}`);
  const restPos: number[][] = [];
  const inv = mat4();
  for (let b = 0; b < BONE_COUNT; b++) {
    invert(inv, skin.inverseBind[boneJoint[b]]);
    restPos[b] = [inv[12], inv[13], inv[14]];
  }

  // merge primitives into matte / glossy groups
  const groups = { matte: { v: [] as number[], s: [] as number[], i: [] as number[] }, gloss: { v: [] as number[], s: [] as number[], i: [] as number[] } };
  let headTopY = -Infinity;
  let triangles = 0;
  // right-eye extents (vertices bound to the eyes joint) -> glasses anchor, spacing and size
  let eMinX = Infinity, eMaxX = -Infinity, eMaxZ = -Infinity;
  for (const p of g.primitives) {
    const grp = p.roughness < 0.4 ? groups.gloss : groups.matte;
    const base = grp.v.length / 12;
    const n = p.positions.length / 3;
    const em = p.emissive > 0.01 ? 1 : 0;
    for (let k = 0; k < n; k++) {
      const c = p.colors;
      const r = toSrgb((c ? c[k * 4] : 1) * p.baseColor[0]);
      const gg = toSrgb((c ? c[k * 4 + 1] : 1) * p.baseColor[1]);
      const bb = toSrgb((c ? c[k * 4 + 2] : 1) * p.baseColor[2]);
      grp.v.push(p.positions[k * 3], p.positions[k * 3 + 1], p.positions[k * 3 + 2],
        p.normals[k * 3], p.normals[k * 3 + 1], p.normals[k * 3 + 2], r, gg, bb, em, 0, 0);
      const j = p.joints, w = p.weights;
      grp.s.push(j ? j[k * 4] : 0, j ? j[k * 4 + 1] : 0, j ? j[k * 4 + 2] : 0, j ? j[k * 4 + 3] : 0,
        w ? w[k * 4] : 1, w ? w[k * 4 + 1] : 0, w ? w[k * 4 + 2] : 0, w ? w[k * 4 + 3] : 0);
      // vertices bound mostly to the head joint define the head top (hat anchor)
      if (j && w && jointBone[j[k * 4]] === B.HEAD && w[k * 4] > 0.6 && p.materialName === 'Fur') headTopY = Math.max(headTopY, p.positions[k * 3 + 1]);
      if (j && w && jointBone[j[k * 4]] === B.EYES && w[k * 4] > 0.6 && p.positions[k * 3] > 0) {
        eMinX = Math.min(eMinX, p.positions[k * 3]); eMaxX = Math.max(eMaxX, p.positions[k * 3]);
        eMaxZ = Math.max(eMaxZ, p.positions[k * 3 + 2]);
      }
    }
    for (const ix of p.indices) grp.i.push(base + ix);
    triangles += p.indices.length / 3;
  }
  const parts = [] as { mesh: Mesh; spec: number }[];
  if (groups.matte.i.length) parts.push({ mesh: new Mesh(gl, new Float32Array(groups.matte.v), new Uint32Array(groups.matte.i), false, new Float32Array(groups.matte.s)), spec: 0.12 });
  if (groups.gloss.i.length) parts.push({ mesh: new Mesh(gl, new Float32Array(groups.gloss.v), new Uint32Array(groups.gloss.i), false, new Float32Array(groups.gloss.s)), spec: 1.1 });
  const head = restPos[B.HEAD];
  const eyes = restPos[B.EYES];
  const hasEyes = Number.isFinite(eMinX);
  return {
    gltf: g, parts, jointBone, boneJoint, boneNode, restPos, ibm: skin.inverseBind,
    clips: { idle: g.clips.get('Idle') ?? null, run: g.clips.get('Run') ?? null },
    headTop: [0, Number.isFinite(headTopY) ? headTopY - head[1] - 0.015 : 0.2, 0],
    eyeFront: [0, eyes[1] - head[1], hasEyes ? eMaxZ - head[2] - 0.01 : eyes[2] - head[2] + 0.06],
    eyeSpread: hasEyes ? (eMinX + eMaxX) / 2 / 1.1 : 0.1,
    eyeR: hasEyes ? (eMaxX - eMinX) / 2 / 1.15 : 0.06,
    triangles,
  };
}

/** Load every available character GLB. Failures fall back to the procedural model. */
export async function loadCharacterGlbs(gl: WebGL2RenderingContext): Promise<string[]> {
  const report: string[] = [];
  // ?glb=0 disables Blender models (A/B performance testing, emergency fallback)
  if (new URLSearchParams(location.search).get('glb') === '0') return ['GLB characters disabled by ?glb=0'];
  const base = import.meta.env.BASE_URL ?? '/';
  await Promise.all(GLB_ANIMALS.map(async (id) => {
    const idx = ANIMALS.findIndex((a) => a.id === id);
    if (idx < 0) return;
    try {
      const g = await loadGlb(`${base}models/characters/${id}.glb`);
      glbCharacters[idx] = build(gl, g);
      report.push(`${id}: GLB ok (${glbCharacters[idx]!.triangles} tris, ${g.clips.size} clips)`);
    } catch (e) {
      console.warn(`[characters] ${id}.glb failed, using procedural model:`, e);
      report.push(`${id}: GLB failed (${String(e)}), procedural fallback`);
    }
  }));
  return report;
}

/** Offsets (bone rest translation relative to parent) derived from the GLB joints. */
export function glbOffsets(c: GlbCharacter): number[][] {
  return c.restPos.map((p, b) => {
    const parent = BONE_PARENT[b];
    if (parent < 0) return [p[0], p[1], p[2]];
    const q = c.restPos[parent];
    return [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
  });
}
