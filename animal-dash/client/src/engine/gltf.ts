// Minimal glTF 2.0 binary (.glb) loader for skinned, animated characters.
// Supports: meshes/primitives (POSITION, NORMAL, COLOR_0, JOINTS_0, WEIGHTS_0, indices),
// materials (baseColorFactor, emissive, roughness), one skin, node hierarchy, and
// animations (translation / rotation / scale; LINEAR and STEP). No Draco, no textures.
import { Mat4, mat4, multiply, invert, identity } from './math';

export interface GltfPrimitive {
  positions: Float32Array; normals: Float32Array; colors: Float32Array | null; // rgba linear
  joints: Uint16Array | null; weights: Float32Array | null; indices: Uint32Array;
  baseColor: number[]; emissive: number; roughness: number; materialName: string;
}
export interface GltfNode { name: string; parent: number; t: number[]; r: number[]; s: number[]; matrix: Float32Array | null; }
export interface GltfChannel { node: number; path: 'translation' | 'rotation' | 'scale'; times: Float32Array; values: Float32Array; step: boolean; }
export interface GltfClip { name: string; duration: number; channels: GltfChannel[]; }
export interface GltfSkin { joints: number[]; inverseBind: Mat4[]; }
export interface GltfModel { nodes: GltfNode[]; primitives: GltfPrimitive[]; skin: GltfSkin | null; clips: Map<string, GltfClip>; }

const COMP: Record<number, { size: number; read: (dv: DataView, o: number) => number; norm: number }> = {
  5120: { size: 1, read: (d, o) => d.getInt8(o), norm: 127 },
  5121: { size: 1, read: (d, o) => d.getUint8(o), norm: 255 },
  5122: { size: 2, read: (d, o) => d.getInt16(o, true), norm: 32767 },
  5123: { size: 2, read: (d, o) => d.getUint16(o, true), norm: 65535 },
  5125: { size: 4, read: (d, o) => d.getUint32(o, true), norm: 4294967295 },
  5126: { size: 4, read: (d, o) => d.getFloat32(o, true), norm: 1 },
};
const NCOMP: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

export async function loadGlb(url: string): Promise<GltfModel> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GLB ${url}: HTTP ${res.status}`);
  return parseGlb(await res.arrayBuffer());
}

export function parseGlb(buf: ArrayBuffer): GltfModel {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('Not a GLB file');
  let off = 12;
  let json: any = null;
  let bin: DataView | null = null;
  while (off < buf.byteLength) {
    const len = dv.getUint32(off, true);
    const type = dv.getUint32(off + 4, true);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, off + 8, len)));
    else if (type === 0x004e4942) bin = new DataView(buf, off + 8, len);
    off += 8 + len;
  }
  if (!json || !bin) throw new Error('GLB missing JSON or BIN chunk');
  const B = bin;

  const accessor = (i: number): { data: Float32Array; n: number; comps: number } => {
    const a = json.accessors[i];
    const bv = json.bufferViews[a.bufferView];
    const c = COMP[a.componentType];
    const comps = NCOMP[a.type];
    const stride = bv.byteStride || c.size * comps;
    const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
    const out = new Float32Array(a.count * comps);
    for (let k = 0; k < a.count; k++) {
      for (let j = 0; j < comps; j++) {
        let v = c.read(B, base + k * stride + j * c.size);
        if (a.normalized) v /= c.norm;
        out[k * comps + j] = v;
      }
    }
    return { data: out, n: a.count, comps };
  };

  // nodes + parents
  const nodes: GltfNode[] = (json.nodes ?? []).map((n: any) => ({
    name: n.name ?? '', parent: -1, t: n.translation ?? [0, 0, 0], r: n.rotation ?? [0, 0, 0, 1], s: n.scale ?? [1, 1, 1],
    matrix: n.matrix ? new Float32Array(n.matrix) : null,
  }));
  (json.nodes ?? []).forEach((n: any, i: number) => (n.children ?? []).forEach((c: number) => (nodes[c].parent = i)));

  // primitives (from every mesh node)
  const primitives: GltfPrimitive[] = [];
  for (const mesh of json.meshes ?? []) {
    for (const p of mesh.primitives) {
      const at = p.attributes;
      const pos = accessor(at.POSITION);
      const nrm = at.NORMAL !== undefined ? accessor(at.NORMAL).data : new Float32Array(pos.n * 3);
      let colors: Float32Array | null = null;
      if (at.COLOR_0 !== undefined) {
        const c = accessor(at.COLOR_0);
        colors = new Float32Array(pos.n * 4);
        for (let k = 0; k < pos.n; k++) for (let j = 0; j < 4; j++) colors[k * 4 + j] = j < c.comps ? c.data[k * c.comps + j] : 1;
      }
      const joints = at.JOINTS_0 !== undefined ? Uint16Array.from(accessor(at.JOINTS_0).data) : null;
      const weights = at.WEIGHTS_0 !== undefined ? accessor(at.WEIGHTS_0).data : null;
      const indices = p.indices !== undefined ? Uint32Array.from(accessor(p.indices).data) : Uint32Array.from({ length: pos.n }, (_, k) => k);
      const mat = p.material !== undefined ? json.materials[p.material] : {};
      const pbr = mat.pbrMetallicRoughness ?? {};
      const em = mat.emissiveFactor ? Math.max(...mat.emissiveFactor) : 0;
      primitives.push({
        positions: pos.data, normals: nrm, colors, joints, weights, indices,
        baseColor: pbr.baseColorFactor ?? [1, 1, 1, 1], emissive: em, roughness: pbr.roughnessFactor ?? 1, materialName: mat.name ?? '',
      });
    }
  }

  // skin
  let skin: GltfSkin | null = null;
  if (json.skins?.length) {
    const s = json.skins[0];
    const ibm = s.inverseBindMatrices !== undefined ? accessor(s.inverseBindMatrices).data : null;
    skin = {
      joints: s.joints,
      inverseBind: s.joints.map((_: number, i: number) => (ibm ? new Float32Array(ibm.subarray(i * 16, i * 16 + 16)) : identity(mat4()))),
    };
  }

  // animations
  const clips = new Map<string, GltfClip>();
  for (const a of json.animations ?? []) {
    const channels: GltfChannel[] = [];
    let duration = 0;
    for (const ch of a.channels) {
      const path = ch.target.path;
      if (path !== 'translation' && path !== 'rotation' && path !== 'scale') continue;
      const smp = a.samplers[ch.sampler];
      const times = accessor(smp.input).data;
      const values = accessor(smp.output).data;
      duration = Math.max(duration, times[times.length - 1]);
      channels.push({ node: ch.target.node, path, times, values, step: smp.interpolation === 'STEP' });
    }
    clips.set(a.name ?? `clip${clips.size}`, { name: a.name, duration, channels });
  }
  return { nodes, primitives, skin, clips };
}

// ------------------------------------------------------------------ evaluation helpers
export function trsToMat(o: Mat4, t: ArrayLike<number>, q: ArrayLike<number>, s: ArrayLike<number>): Mat4 {
  const [x, y, z, w] = [q[0], q[1], q[2], q[3]];
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
  o[0] = (1 - (yy + zz)) * s[0]; o[1] = (xy + wz) * s[0]; o[2] = (xz - wy) * s[0]; o[3] = 0;
  o[4] = (xy - wz) * s[1]; o[5] = (1 - (xx + zz)) * s[1]; o[6] = (yz + wx) * s[1]; o[7] = 0;
  o[8] = (xz + wy) * s[2]; o[9] = (yz - wx) * s[2]; o[10] = (1 - (xx + yy)) * s[2]; o[11] = 0;
  o[12] = t[0]; o[13] = t[1]; o[14] = t[2]; o[15] = 1;
  return o;
}

/** Sample a channel at time t into out (3 or 4 components). */
export function sampleChannel(ch: GltfChannel, t: number, out: number[]): void {
  const n = ch.path === 'rotation' ? 4 : 3;
  const times = ch.times;
  const last = times.length - 1;
  if (t <= times[0]) { for (let j = 0; j < n; j++) out[j] = ch.values[j]; return; }
  if (t >= times[last]) { for (let j = 0; j < n; j++) out[j] = ch.values[last * n + j]; return; }
  let lo = 0, hi = last;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (times[m] <= t) lo = m; else hi = m; }
  const k = ch.step ? 0 : (t - times[lo]) / (times[hi] - times[lo]);
  const a = lo * n, b = hi * n;
  if (n === 4) {
    let dot = 0;
    for (let j = 0; j < 4; j++) dot += ch.values[a + j] * ch.values[b + j];
    const sgn = dot < 0 ? -1 : 1;
    let len = 0;
    for (let j = 0; j < 4; j++) { out[j] = ch.values[a + j] + (ch.values[b + j] * sgn - ch.values[a + j]) * k; len += out[j] * out[j]; }
    len = Math.sqrt(len) || 1;
    for (let j = 0; j < 4; j++) out[j] /= len;
  } else for (let j = 0; j < 3; j++) out[j] = ch.values[a + j] + (ch.values[b + j] - ch.values[a + j]) * k;
}

/** World matrices of all nodes for a clip at time t (rest pose for nodes without channels). */
export function evaluateClip(model: GltfModel, clip: GltfClip | null, t: number, out: Mat4[], scratch: { t: number[][]; r: number[][]; s: number[][] }): void {
  const nodes = model.nodes;
  for (let i = 0; i < nodes.length; i++) {
    scratch.t[i] = scratch.t[i] ?? [0, 0, 0]; scratch.r[i] = scratch.r[i] ?? [0, 0, 0, 1]; scratch.s[i] = scratch.s[i] ?? [1, 1, 1];
    const n = nodes[i];
    for (let j = 0; j < 3; j++) { scratch.t[i][j] = n.t[j]; scratch.s[i][j] = n.s[j]; }
    for (let j = 0; j < 4; j++) scratch.r[i][j] = n.r[j];
  }
  if (clip) {
    const time = clip.duration > 0 ? ((t % clip.duration) + clip.duration) % clip.duration : 0;
    for (const ch of clip.channels) {
      const dst = ch.path === 'translation' ? scratch.t[ch.node] : ch.path === 'rotation' ? scratch.r[ch.node] : scratch.s[ch.node];
      sampleChannel(ch, time, dst);
    }
  }
  const local = _local;
  if (_done.length < nodes.length) _done = new Uint8Array(nodes.length * 2);
  const done = _done;
  done.fill(0);
  const visit = (i: number) => {
    if (done[i]) return;
    const n = nodes[i];
    if (!out[i]) out[i] = mat4();
    // resolve the parent first: `local` is a shared scratch matrix and recursion would overwrite it
    if (n.parent >= 0) visit(n.parent);
    if (n.matrix) local.set(n.matrix); else trsToMat(local, scratch.t[i], scratch.r[i], scratch.s[i]);
    if (n.parent >= 0) multiply(out[i], out[n.parent], local); else out[i].set(local);
    done[i] = 1;
  };
  for (let i = 0; i < nodes.length; i++) visit(i);
}

const _local = mat4();
let _done = new Uint8Array(64);

export { invert };
