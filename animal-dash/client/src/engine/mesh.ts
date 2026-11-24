// Procedural geometry: a MeshBuilder that emits interleaved vertices
// (position, normal, rgba[a = emissive], uv) and GPU Mesh objects (VAO, optional instancing).
import { Mat4, mat4, compose, transformPoint, transformDir } from './math';

export type RGB = [number, number, number];
export type ColorSpec = RGB | ((x: number, y: number, z: number) => RGB);

const FLOATS = 12;
const tmpP = [0, 0, 0];
const tmpN = [0, 0, 0];
const ID = mat4();

export class MeshBuilder {
  v: number[] = [];
  idx: number[] = [];
  get vertexCount() { return this.v.length / FLOATS; }

  vertex(m: Mat4, x: number, y: number, z: number, nx: number, ny: number, nz: number, c: RGB, em: number, u = 0, w = 0): number {
    transformPoint(m, x, y, z, tmpP);
    transformDir(m, nx, ny, nz, tmpN);
    const l = Math.hypot(tmpN[0], tmpN[1], tmpN[2]) || 1;
    this.v.push(tmpP[0], tmpP[1], tmpP[2], tmpN[0] / l, tmpN[1] / l, tmpN[2] / l, c[0], c[1], c[2], em, u, w);
    return this.vertexCount - 1;
  }
  tri(a: number, b: number, c: number) { this.idx.push(a, b, c); }
  quad(a: number, b: number, c: number, d: number) { this.idx.push(a, b, c, a, c, d); }

  private col(spec: ColorSpec, x: number, y: number, z: number): RGB { return typeof spec === 'function' ? spec(x, y, z) : spec; }

  /** Axis-aligned box centred on origin (in m-space). Flat shaded. */
  box(m: Mat4, w: number, h: number, d: number, color: ColorSpec, em = 0, uvScale = 0): this {
    const hx = w / 2, hy = h / 2, hz = d / 2;
    const faces: [number, number, number, number[][]][] = [
      [1, 0, 0, [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]]],
      [-1, 0, 0, [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]]],
      [0, 1, 0, [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]]],
      [0, -1, 0, [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]]],
      [0, 0, 1, [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]]],
      [0, 0, -1, [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]]],
    ];
    const uvs = [[0, 1], [1, 1], [1, 0], [0, 0]]; // v=0 at the top (canvas textures are not flipped)
    for (const [nx, ny, nz, pts] of faces) {
      const ids = pts.map((p, i) => this.vertex(m, p[0], p[1], p[2], nx, ny, nz, this.col(color, p[0], p[1], p[2]), em,
        uvScale ? uvs[i][0] * uvScale : uvs[i][0], uvScale ? uvs[i][1] * uvScale : uvs[i][1]));
      this.quad(ids[0], ids[1], ids[2], ids[3]);
    }
    return this;
  }

  /** Box with rounded (bevelled) look via a squashed sphere — used for soft foam blocks. */
  roundBox(m: Mat4, w: number, h: number, d: number, color: ColorSpec, em = 0): this {
    return this.superEllipsoid(m, w / 2, h / 2, d / 2, 0.25, color, em);
  }

  /** Ellipsoid. colour callback receives the local surface point. */
  sphere(m: Mat4, rx: number, ry: number, rz: number, color: ColorSpec, seg = 18, rings = 12, em = 0): this {
    const base = this.vertexCount;
    for (let i = 0; i <= rings; i++) {
      const th = (i / rings) * Math.PI;
      const st = Math.sin(th), ct = Math.cos(th);
      for (let j = 0; j <= seg; j++) {
        const ph = (j / seg) * Math.PI * 2;
        const ux = st * Math.sin(ph), uy = ct, uz = st * Math.cos(ph);
        const x = ux * rx, y = uy * ry, z = uz * rz;
        this.vertex(m, x, y, z, ux / rx, uy / ry, uz / rz, this.col(color, x, y, z), em, j / seg, i / rings);
      }
    }
    for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
      const a = base + i * (seg + 1) + j, b = a + seg + 1;
      this.quad(a, b, b + 1, a + 1);
    }
    return this;
  }

  /** Superellipsoid with exponent e (<1 = boxy). */
  superEllipsoid(m: Mat4, rx: number, ry: number, rz: number, e: number, color: ColorSpec, em = 0, seg = 16, rings = 12): this {
    const base = this.vertexCount;
    const sp = (w: number, p: number) => Math.sign(w) * Math.pow(Math.abs(w), p);
    for (let i = 0; i <= rings; i++) {
      const th = (i / rings) * Math.PI - Math.PI / 2;
      for (let j = 0; j <= seg; j++) {
        const ph = (j / seg) * Math.PI * 2 - Math.PI;
        const x = rx * sp(Math.cos(th), e) * sp(Math.cos(ph), e);
        const y = ry * sp(Math.sin(th), e);
        const z = rz * sp(Math.cos(th), e) * sp(Math.sin(ph), e);
        const nx = sp(Math.cos(th), 2 - e) * sp(Math.cos(ph), 2 - e) / rx;
        const ny = sp(Math.sin(th), 2 - e) / ry;
        const nz = sp(Math.cos(th), 2 - e) * sp(Math.sin(ph), 2 - e) / rz;
        this.vertex(m, x, y, z, nx, ny, nz, this.col(color, x, y, z), em, j / seg, i / rings);
      }
    }
    for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
      const a = base + i * (seg + 1) + j, b = a + seg + 1;
      this.quad(a, a + 1, b + 1, b);
    }
    return this;
  }

  /** Cylinder / cone / frustum along +y from y=0 to y=h. */
  cylinder(m: Mat4, rTop: number, rBot: number, h: number, color: ColorSpec, seg = 14, caps = true, em = 0): this {
    const base = this.vertexCount;
    const slope = (rBot - rTop) / h;
    for (let i = 0; i <= 1; i++) {
      const y = i * h, r = i ? rTop : rBot;
      for (let j = 0; j <= seg; j++) {
        const a = (j / seg) * Math.PI * 2;
        const cx = Math.sin(a), cz = Math.cos(a);
        this.vertex(m, cx * r, y, cz * r, cx, slope, cz, this.col(color, cx * r, y, cz * r), em, j / seg, i);
      }
    }
    for (let j = 0; j < seg; j++) this.quad(base + j, base + j + 1, base + seg + 2 + j, base + seg + 1 + j);
    if (caps) {
      for (const top of [0, 1]) {
        const r = top ? rTop : rBot;
        if (r <= 0.0001) continue;
        const y = top ? h : 0, ny = top ? 1 : -1;
        const c = this.vertex(m, 0, y, 0, 0, ny, 0, this.col(color, 0, y, 0), em, 0.5, 0.5);
        const ring: number[] = [];
        for (let j = 0; j <= seg; j++) {
          const a = (j / seg) * Math.PI * 2;
          ring.push(this.vertex(m, Math.sin(a) * r, y, Math.cos(a) * r, 0, ny, 0, this.col(color, Math.sin(a) * r, y, Math.cos(a) * r), em));
        }
        for (let j = 0; j < seg; j++) top ? this.tri(c, ring[j], ring[j + 1]) : this.tri(c, ring[j + 1], ring[j]);
      }
    }
    return this;
  }

  /** Capsule along +y centred on origin: total length h + 2r. */
  capsule(m: Mat4, r: number, h: number, color: ColorSpec, seg = 12, em = 0): this {
    const base = this.vertexCount;
    const rings = 10;
    for (let i = 0; i <= rings; i++) {
      const th = (i / rings) * Math.PI;
      const st = Math.sin(th), ct = Math.cos(th);
      const yoff = i <= rings / 2 ? h / 2 : -h / 2;
      for (let j = 0; j <= seg; j++) {
        const ph = (j / seg) * Math.PI * 2;
        const ux = st * Math.sin(ph), uy = ct, uz = st * Math.cos(ph);
        const x = ux * r, y = uy * r + yoff, z = uz * r;
        this.vertex(m, x, y, z, ux, uy, uz, this.col(color, x, y, z), em);
      }
      if (i === rings / 2) {
        // duplicate ring for the cylindrical section
        for (let j = 0; j <= seg; j++) {
          const ph = (j / seg) * Math.PI * 2;
          const x = Math.sin(ph) * r, z = Math.cos(ph) * r;
          this.vertex(m, x, -h / 2, z, Math.sin(ph), 0, Math.cos(ph), this.col(color, x, -h / 2, z), em);
        }
      }
    }
    const total = rings + 1;
    for (let i = 0; i < total; i++) for (let j = 0; j < seg; j++) {
      const a = base + i * (seg + 1) + j, b = a + seg + 1;
      this.quad(a, b, b + 1, a + 1);
    }
    return this;
  }

  torus(m: Mat4, R: number, r: number, color: ColorSpec, seg = 20, tube = 8, arc = Math.PI * 2, em = 0): this {
    const base = this.vertexCount;
    for (let i = 0; i <= seg; i++) {
      const u = (i / seg) * arc;
      const cu = Math.cos(u), su = Math.sin(u);
      for (let j = 0; j <= tube; j++) {
        const v = (j / tube) * Math.PI * 2;
        const cv = Math.cos(v), sv = Math.sin(v);
        const x = (R + r * cv) * cu, y = r * sv, z = (R + r * cv) * su;
        this.vertex(m, x, y, z, cv * cu, sv, cv * su, this.col(color, x, y, z), em, i / seg, j / tube);
      }
    }
    for (let i = 0; i < seg; i++) for (let j = 0; j < tube; j++) {
      const a = base + i * (tube + 1) + j, b = a + tube + 1;
      this.quad(a, a + 1, b + 1, b);
    }
    return this;
  }

  /** Flat quad on the XZ plane facing +y (or use matrix to orient). */
  plane(m: Mat4, w: number, d: number, color: ColorSpec, em = 0, u0 = 0, v0 = 0, u1 = 1, v1 = 1): this {
    const hx = w / 2, hz = d / 2;
    const a = this.vertex(m, -hx, 0, hz, 0, 1, 0, this.col(color, -hx, 0, hz), em, u0, v0);
    const b = this.vertex(m, hx, 0, hz, 0, 1, 0, this.col(color, hx, 0, hz), em, u1, v0);
    const c = this.vertex(m, hx, 0, -hz, 0, 1, 0, this.col(color, hx, 0, -hz), em, u1, v1);
    const d2 = this.vertex(m, -hx, 0, -hz, 0, 1, 0, this.col(color, -hx, 0, -hz), em, u0, v1);
    this.quad(a, b, c, d2);
    return this;
  }

  /** Triangular prism (wedge / ramp) rising toward +z. */
  wedge(m: Mat4, w: number, h: number, d: number, color: ColorSpec, em = 0): this {
    const hx = w / 2, hz = d / 2;
    const p = [[-hx, 0, -hz], [hx, 0, -hz], [hx, 0, hz], [-hx, 0, hz], [-hx, h, hz], [hx, h, hz]];
    const slopeN = [0, d, -h];
    const sl = Math.hypot(slopeN[1], slopeN[2]);
    const face = (ids: number[], n: number[], uvs?: number[][]) => {
      const vs = ids.map((i, k) => this.vertex(m, p[i][0], p[i][1], p[i][2], n[0], n[1], n[2], this.col(color, p[i][0], p[i][1], p[i][2]), em, uvs ? uvs[k][0] : 0, uvs ? uvs[k][1] : 0));
      if (vs.length === 4) this.quad(vs[0], vs[1], vs[2], vs[3]); else this.tri(vs[0], vs[1], vs[2]);
    };
    face([0, 1, 5, 4], [0, slopeN[1] / sl, slopeN[2] / sl], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    face([3, 2, 1, 0], [0, -1, 0]);
    face([2, 3, 4, 5], [0, 0, 1]);
    face([0, 4, 3], [-1, 0, 0]);
    face([1, 2, 5], [1, 0, 0]);
    return this;
  }

  append(o: MeshBuilder): this {
    const off = this.vertexCount;
    for (const x of o.v) this.v.push(x);
    for (const i of o.idx) this.idx.push(i + off);
    return this;
  }

  build(gl: WebGL2RenderingContext, instanced = false): Mesh { return new Mesh(gl, new Float32Array(this.v), new Uint32Array(this.idx), instanced); }
}

export const M = (px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0, s = 1, sy = s, sz = s): Mat4 => compose(mat4(), px, py, pz, rx, ry, rz, s, sy, sz);
export const IDENTITY = ID;

export class Mesh {
  vao: WebGLVertexArrayObject;
  count: number;
  center = [0, 0, 0];
  radius = 1;
  instanced: boolean;
  instanceBuffer: WebGLBuffer | null = null;
  instanceCount = 0;
  /** instanced meshes whose center/radius were set to the bounds of all instances can be frustum culled */
  cullInstanced = false;
  private gl: WebGL2RenderingContext;
  private vbo: WebGLBuffer;
  private ibo: WebGLBuffer;
  private skinBuffer: WebGLBuffer | null = null;

  /** true when the mesh carries joint indices/weights (attributes 9 and 10) */
  skinned = false;

  constructor(gl: WebGL2RenderingContext, verts: Float32Array, idx: Uint32Array, instanced = false, skin: Float32Array | null = null) {
    this.gl = gl;
    this.instanced = instanced;
    this.count = idx.length;
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    this.vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    const stride = FLOATS * 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 24);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 2, gl.FLOAT, false, stride, 40);
    if (instanced) {
      this.instanceBuffer = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
      const is = 20 * 4;
      for (let i = 0; i < 5; i++) {
        gl.enableVertexAttribArray(4 + i);
        gl.vertexAttribPointer(4 + i, 4, gl.FLOAT, false, is, i * 16);
        gl.vertexAttribDivisor(4 + i, 1);
      }
    }
    if (skin) {
      // 8 floats per vertex: joint indices (4, as floats) + weights (4)
      this.skinned = true;
      this.skinBuffer = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.skinBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, skin, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(9); gl.vertexAttribPointer(9, 4, gl.FLOAT, false, 32, 0);
      gl.enableVertexAttribArray(10); gl.vertexAttribPointer(10, 4, gl.FLOAT, false, 32, 16);
    }
    this.ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    // bounds
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < verts.length; i += FLOATS) {
      const x = verts[i], y = verts[i + 1], z = verts[i + 2];
      if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z;
      if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z;
    }
    if (verts.length) {
      this.center = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
      this.radius = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2;
    }
  }

  /** data: n * 20 floats (mat4 column-major + rgba). */
  setInstances(data: Float32Array, count: number, dynamic = false): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * 20), dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
    this.instanceCount = count;
  }

  draw(): void {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    if (this.instanced) gl.drawElementsInstanced(gl.TRIANGLES, this.count, gl.UNSIGNED_INT, 0, this.instanceCount);
    else gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_INT, 0);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteBuffer(this.vbo); gl.deleteBuffer(this.ibo);
    if (this.instanceBuffer) gl.deleteBuffer(this.instanceBuffer);
    if (this.skinBuffer) gl.deleteBuffer(this.skinBuffer);
    gl.deleteVertexArray(this.vao);
  }
}

/** Helper to write one instance (matrix + colour) into an instance array. */
export function writeInstance(arr: Float32Array, i: number, m: Mat4, r: number, g: number, b: number, a: number): void {
  arr.set(m, i * 20);
  arr[i * 20 + 16] = r; arr[i * 20 + 17] = g; arr[i * 20 + 18] = b; arr[i * 20 + 19] = a;
}
