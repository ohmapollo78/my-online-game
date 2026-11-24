// Debug: evaluate a character GLB's clips and report how far each joint's skin matrix
// (jointWorld * inverseBind) is from identity. Usage: npx tsx glbDebug.ts ../client/public/models/characters/pug.glb
import fs from 'fs';
import { parseGlb, evaluateClip } from '../client/src/engine/gltf';
import { mat4, multiply } from '../client/src/engine/math';

const file = process.argv[2];
const buf = fs.readFileSync(file);
const g = parseGlb(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const skin = g.skin!;
const world: Float32Array[] = [];
const scratch = { t: [] as number[][], r: [] as number[][], s: [] as number[][] };
const dev = (m: Float32Array) => { let d = 0; const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; for (let i = 0; i < 16; i++) d = Math.max(d, Math.abs(m[i] - I[i])); return d; };
for (const name of ['(rest)', ...g.clips.keys()]) {
  const clip = name === '(rest)' ? null : g.clips.get(name)!;
  evaluateClip(g, clip, 0, world, scratch);
  const out: string[] = [];
  skin.joints.forEach((n, j) => {
    const X = multiply(mat4(), world[n], skin.inverseBind[j]);
    out.push(`${g.nodes[n].name}:${dev(X).toFixed(2)}`);
  });
  console.log(name.padEnd(8), out.join(' '));
}
evaluateClip(g, null, 0, world, scratch);
for (const nm of ['body', 'leg_FL_low']) {
  const j = skin.joints.findIndex((n) => g.nodes[n].name === nm);
  const n = skin.joints[j];
  console.log(nm, 'node', n, 'parent', g.nodes[n].parent, g.nodes[g.nodes[n].parent]?.name, 'local t', g.nodes[n].t.map((v) => v.toFixed(3)).join(','));
  console.log('  world', Array.from(world[n]).map((v) => v.toFixed(3)).join(' '));
  console.log('  ibm  ', Array.from(skin.inverseBind[j]).map((v) => v.toFixed(3)).join(' '));
}
g.primitives.forEach((p, i) => {
  if (!p.colors) return;
  const n = p.colors.length / 4;
  const avg = [0, 0, 0, 0];
  for (let k = 0; k < n; k++) for (let c = 0; c < 4; c++) avg[c] += p.colors[k * 4 + c] / n;
  // outward-normal test: normals should point away from the primitive's centroid
  const c = [0, 0, 0];
  for (let k = 0; k < n; k++) for (let a = 0; a < 3; a++) c[a] += p.positions[k * 3 + a] / n;
  let out = 0;
  for (let k = 0; k < n; k++) {
    let d = 0;
    for (let a = 0; a < 3; a++) d += (p.positions[k * 3 + a] - c[a]) * p.normals[k * 3 + a];
    if (d > 0) out++;
  }
  const pct = (out / n) * 100;
  console.log(`prim ${i} ${p.materialName} verts=${n} avgColor=${avg.map((v) => v.toFixed(3)).join(',')} outwardNormals=${pct.toFixed(0)}%${pct < 80 ? '  <-- INWARD?' : ''}`);
});
const run = g.clips.get('Run')!;
for (const ch of run.channels.filter((c) => ['body', 'leg_FL_up'].includes(g.nodes[c.node].name) && c.path === 'rotation')) {
  console.log(g.nodes[ch.node].name, 'rest r', g.nodes[ch.node].r.map((v) => v.toFixed(3)).join(','), 'anim r@0', Array.from(ch.values.slice(0, 4)).map((v) => v.toFixed(3)).join(','), 'keys', ch.times.length, 'dur', run.duration.toFixed(3));
}
