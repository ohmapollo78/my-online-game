// Forward WebGL2 renderer: directional sun with PCF shadow map, hemisphere ambient,
// rim light, fog, ACES tonemapping, sky, frustum culling, instancing, particles and speed lines.
import { Program } from './gl';
import { Mesh } from './mesh';
import { Mat4, mat4, multiply, perspective, lookAt, invert, ortho, Frustum, identity } from './math';
import { ParticleSystem } from './particles';
import * as S from './shaders';

export interface DrawOpts {
  tint?: ArrayLike<number> | null;
  emissive?: number;
  alpha?: number;
  tex?: WebGLTexture | null;
  shadow?: boolean;
  rim?: number;
  flash?: ArrayLike<number> | null;
  anim?: number;
  spec?: number;
  cull?: boolean;
  noDepthWrite?: boolean;
  /** world-space skin matrices (16 floats each) for skinned meshes; the model matrix is then only used for culling */
  joints?: Float32Array | null;
}

interface DrawItem {
  mesh: Mesh; model: Float32Array; tint: Float32Array; em: number; alpha: number; tex: WebGLTexture | null;
  cast: boolean; rim: number; flash: Float32Array; anim: number; spec: number; depth: number; noDepthWrite: boolean;
  joints: Float32Array | null;
}

export interface Environment {
  sunDir: number[];
  sunColor: number[];
  sky: number[];
  ground: number[];
  fog: number[];
  fogDensity: number;
  skyTop: number[];
  skyHorizon: number[];
  skyBottom: number[];
  clouds: boolean;
}

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  readonly canvas: HTMLCanvasElement;
  width = 1; height = 1;
  renderScale = 1;
  shadowsEnabled = true;
  time = 0;
  view = mat4(); proj = mat4(); vp = mat4(); invVP = mat4(); lightVP = mat4();
  camPos = new Float32Array(3);
  camRight = new Float32Array(3); camUp = new Float32Array(3);
  frustum = new Frustum();
  env: Environment;
  shadowCenter = [0, 0, 0];
  shadowExtent = 45;
  speedLines = 0;
  speedLineColor = [1, 1, 1];
  stats = { draws: 0, culled: 0, tris: 0 };

  private lit: Program; private litI: Program; private depth: Program; private depthI: Program;
  private litS: Program; private depthS: Program;
  private sky: Program; private part: Program; private lines: Program;
  private items: DrawItem[] = [];
  private itemCount = 0;
  private transparent: DrawItem[] = [];
  private shadowTex: WebGLTexture; private shadowFbo: WebGLFramebuffer; private shadowSize = 2048;
  private emptyVao: WebGLVertexArrayObject;
  private quadVao: WebGLVertexArrayObject; private partBuf: WebGLBuffer;
  private linesVao: WebGLVertexArrayObject;
  private dummyTex: WebGLTexture;
  private tmpLV = mat4(); private tmpLP = mat4(); private tmpEye = [0, 0, 0];

  constructor(canvas: HTMLCanvasElement, antialias = true) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 is not supported by this browser.');
    this.gl = gl;
    this.lit = new Program(gl, S.LIT_VS, S.LIT_FS);
    this.litI = new Program(gl, S.LIT_VS, S.LIT_FS, ['INSTANCED']);
    this.depth = new Program(gl, S.DEPTH_VS, S.DEPTH_FS);
    this.depthI = new Program(gl, S.DEPTH_VS, S.DEPTH_FS, ['INSTANCED']);
    this.litS = new Program(gl, S.LIT_VS, S.LIT_FS, ['SKINNED']);
    this.depthS = new Program(gl, S.DEPTH_VS, S.DEPTH_FS, ['SKINNED']);
    this.sky = new Program(gl, S.SKY_VS, S.SKY_FS);
    this.part = new Program(gl, S.PARTICLE_VS, S.PARTICLE_FS);
    this.lines = new Program(gl, S.LINES_VS, S.LINES_FS);
    this.env = {
      sunDir: norm([0.45, 0.8, 0.35]), sunColor: [1.25, 1.15, 1.0], sky: [0.55, 0.65, 0.85], ground: [0.3, 0.27, 0.22],
      fog: [0.72, 0.84, 0.97], fogDensity: 0.0035, skyTop: [0.22, 0.5, 0.92], skyHorizon: [0.72, 0.86, 1.0], skyBottom: [0.5, 0.6, 0.5], clouds: true,
    };

    // shadow map
    this.shadowTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, this.shadowSize, this.shadowSize);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.shadowFbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.dummyTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.dummyTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));

    this.emptyVao = gl.createVertexArray()!;
    // particle quad
    this.quadVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.quadVao);
    const corners = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.partBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.partBuf);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 0); gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16); gl.vertexAttribDivisor(2, 1);
    // speed lines
    this.linesVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.linesVao);
    const lc = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, lc);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, 0, 1, 0, 1, 1, -1, 0, 1, 1, -1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const seeds = new Float32Array(70 * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    const sb = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, sb);
    gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(1, 1);
    gl.bindVertexArray(null);
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * this.renderScale;
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (w !== this.canvas.width || h !== this.canvas.height) { this.canvas.width = w; this.canvas.height = h; }
    this.width = w; this.height = h;
  }

  setCamera(eye: ArrayLike<number>, target: ArrayLike<number>, fovDeg: number, near = 0.1, far = 900): void {
    perspective(this.proj, (fovDeg * Math.PI) / 180, this.width / this.height, near, far);
    lookAt(this.view, eye as number[], target as number[], [0, 1, 0]);
    multiply(this.vp, this.proj, this.view);
    invert(this.invVP, this.vp);
    this.camPos[0] = eye[0]; this.camPos[1] = eye[1]; this.camPos[2] = eye[2];
    const v = this.view;
    this.camRight[0] = v[0]; this.camRight[1] = v[4]; this.camRight[2] = v[8];
    this.camUp[0] = v[1]; this.camUp[1] = v[5]; this.camUp[2] = v[9];
    this.frustum.update(this.vp);
  }

  begin(): void { this.itemCount = 0; this.transparent.length = 0; this.stats.culled = 0; }

  draw(mesh: Mesh, model: Mat4, o: DrawOpts = {}): void {
    if (o.cull !== false && (!mesh.instanced || mesh.cullInstanced)) {
      const cx = model[0] * mesh.center[0] + model[4] * mesh.center[1] + model[8] * mesh.center[2] + model[12];
      const cy = model[1] * mesh.center[0] + model[5] * mesh.center[1] + model[9] * mesh.center[2] + model[13];
      const cz = model[2] * mesh.center[0] + model[6] * mesh.center[1] + model[10] * mesh.center[2] + model[14];
      const sc = Math.max(Math.hypot(model[0], model[1], model[2]), Math.hypot(model[4], model[5], model[6]), Math.hypot(model[8], model[9], model[10]));
      const r = mesh.radius * sc;
      if (!this.frustum.sphere(cx, cy, cz, r)) {
        // still allow shadow casting from just outside the view
        const dx = cx - this.shadowCenter[0], dz = cz - this.shadowCenter[2];
        if (!(o.shadow !== false && this.shadowsEnabled && Math.hypot(dx, dz) < this.shadowExtent + r)) { this.stats.culled++; return; }
        const it = this.alloc(mesh, model, o);
        it.alpha = -1; // shadow-only
        return;
      }
    }
    const it = this.alloc(mesh, model, o);
    if (it.alpha < 1 || it.noDepthWrite) {
      const dx = model[12] - this.camPos[0], dy = model[13] - this.camPos[1], dz = model[14] - this.camPos[2];
      it.depth = dx * dx + dy * dy + dz * dz;
      this.transparent.push(it);
    }
  }

  private alloc(mesh: Mesh, model: Mat4, o: DrawOpts): DrawItem {
    let it = this.items[this.itemCount];
    if (!it) {
      it = { mesh, model: new Float32Array(16), tint: new Float32Array(4), em: 0, alpha: 1, tex: null, cast: true, rim: 0, flash: new Float32Array(3), anim: 0, spec: 0, depth: 0, noDepthWrite: false, joints: null };
      this.items[this.itemCount] = it;
    }
    this.itemCount++;
    it.mesh = mesh;
    it.model.set(model);
    const t = o.tint;
    it.tint[0] = t ? t[0] : 1; it.tint[1] = t ? t[1] : 1; it.tint[2] = t ? t[2] : 1; it.tint[3] = 1;
    it.em = o.emissive ?? 0;
    it.alpha = o.alpha ?? 1;
    it.tex = o.tex ?? null;
    it.cast = o.shadow !== false && (o.alpha ?? 1) >= 1;
    it.rim = o.rim ?? 0.25;
    const f = o.flash;
    it.flash[0] = f ? f[0] : 0; it.flash[1] = f ? f[1] : 0; it.flash[2] = f ? f[2] : 0;
    it.anim = o.anim ?? 0;
    it.spec = o.spec ?? 0.15;
    it.noDepthWrite = !!o.noDepthWrite;
    it.joints = o.joints ?? null;
    return it;
  }

  render(particles: ParticleSystem | null): void {
    const gl = this.gl;
    this.stats.draws = 0; this.stats.tris = 0;
    const env = this.env;

    // ---------------- shadow pass
    const sd = env.sunDir;
    const c = this.shadowCenter;
    const ext = this.shadowExtent;
    const lv = this.tmpLV, lp = this.tmpLP;
    // snap centre to shadow texels to avoid shimmering
    const texel = (ext * 2) / this.shadowSize;
    const eye = this.tmpEye;
    eye[0] = c[0] + sd[0] * 80; eye[1] = c[1] + sd[1] * 80; eye[2] = c[2] + sd[2] * 80;
    lookAt(lv, eye, c, [0, 1, 0]);
    lv[12] = Math.round(lv[12] / texel) * texel; lv[13] = Math.round(lv[13] / texel) * texel;
    ortho(lp, -ext, ext, -ext, ext, 1, 200);
    multiply(this.lightVP, lp, lv);
    if (this.shadowsEnabled) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
      gl.viewport(0, 0, this.shadowSize, this.shadowSize);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
      gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(2, 4);
      gl.disable(gl.BLEND);
      for (const prog of [this.depth, this.depthI, this.depthS]) {
        prog.use();
        prog.m4('uLightVP', this.lightVP);
        for (let i = 0; i < this.itemCount; i++) {
          const it = this.items[i];
          if (!it.cast || this.depthProgram(it) !== prog) continue;
          prog.m4('uModel', it.model);
          if (it.joints) this.uploadJoints(prog, it.joints);
          it.mesh.draw();
        }
      }
      gl.disable(gl.POLYGON_OFFSET_FILL);
    }

    // ---------------- main pass
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(env.skyHorizon[0], env.skyHorizon[1], env.skyHorizon[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // sky
    gl.depthMask(false);
    gl.disable(gl.DEPTH_TEST);
    this.sky.use();
    this.sky.m4('uInvVP', this.invVP);
    this.sky.v3a('uTop', env.skyTop); this.sky.v3a('uHorizon', env.skyHorizon); this.sky.v3a('uBottom', env.skyBottom);
    this.sky.v3a('uSunDir', env.sunDir); this.sky.f('uTime', this.time); this.sky.f('uClouds', env.clouds ? 1 : 0);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.CULL_FACE);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.dummyTex);
    for (const prog of [this.lit, this.litI, this.litS]) {
      prog.use();
      prog.m4('uVP', this.vp); prog.m4('uLightVP', this.lightVP);
      prog.v3a('uLightDir', env.sunDir); prog.v3a('uLightColor', env.sunColor);
      prog.v3a('uSky', env.sky); prog.v3a('uGround', env.ground); prog.v3a('uFog', env.fog);
      prog.f('uFogDensity', env.fogDensity); prog.v3a('uCam', this.camPos);
      prog.i('uShadow', 0); prog.i('uTex', 1);
      prog.f('uShadowOn', this.shadowsEnabled ? 1 : 0);
      prog.f('uTime', this.time);
    }
    // opaque
    gl.disable(gl.BLEND);
    for (const prog of [this.lit, this.litI, this.litS]) {
      prog.use();
      for (let i = 0; i < this.itemCount; i++) {
        const it = this.items[i];
        if (it.alpha < 1 || it.noDepthWrite || this.litProgram(it) !== prog) continue;
        this.drawItem(prog, it);
      }
    }
    // transparent (back to front)
    this.transparent.sort((a, b) => b.depth - a.depth);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    for (const it of this.transparent) {
      if (it.alpha < 0) continue;
      const prog = this.litProgram(it);
      prog.use();
      this.drawItem(prog, it);
    }

    // particles
    if (particles && (particles.alphaCount || particles.addCount)) {
      this.part.use();
      this.part.m4('uVP', this.vp); this.part.v3a('uRight', this.camRight); this.part.v3a('uUp', this.camUp);
      gl.bindVertexArray(this.quadVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.partBuf);
      if (particles.alphaCount) {
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.bufferData(gl.ARRAY_BUFFER, particles.alphaData.subarray(0, particles.alphaCount * 8), gl.DYNAMIC_DRAW);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, particles.alphaCount);
      }
      if (particles.addCount) {
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.bufferData(gl.ARRAY_BUFFER, particles.addData.subarray(0, particles.addCount * 8), gl.DYNAMIC_DRAW);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, particles.addCount);
      }
    }

    // speed lines (screen space)
    if (this.speedLines > 0.01) {
      gl.disable(gl.DEPTH_TEST);
      gl.blendFunc(gl.ONE, gl.ONE);
      this.lines.use();
      this.lines.f('uTime', this.time); this.lines.f('uAspect', this.width / this.height);
      this.lines.f('uIntensity', this.speedLines);
      this.lines.v3a('uColor', this.speedLineColor);
      gl.bindVertexArray(this.linesVao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, 70);
      gl.enable(gl.DEPTH_TEST);
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  private litProgram(it: DrawItem): Program { return it.joints && it.mesh.skinned ? this.litS : it.mesh.instanced ? this.litI : this.lit; }
  private depthProgram(it: DrawItem): Program { return it.joints && it.mesh.skinned ? this.depthS : it.mesh.instanced ? this.depthI : this.depth; }
  private uploadJoints(prog: Program, joints: Float32Array): void {
    const l = prog.loc('uJoints');
    if (l) this.gl.uniformMatrix4fv(l, false, joints);
  }

  private drawItem(prog: Program, it: DrawItem): void {
    const gl = this.gl;
    prog.m4('uModel', it.model);
    if (it.joints) this.uploadJoints(prog, it.joints);
    prog.v4('uTint', it.tint[0], it.tint[1], it.tint[2], 1);
    prog.f('uEmissive', it.em);
    prog.f('uAlpha', it.alpha);
    prog.f('uRim', it.rim);
    prog.v3a('uFlash', it.flash);
    prog.f('uAnim', it.anim);
    prog.f('uSpec', it.spec);
    if (it.tex) {
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, it.tex);
      prog.f('uUseTex', 1);
    } else prog.f('uUseTex', 0);
    it.mesh.draw();
    if (it.tex) { gl.bindTexture(gl.TEXTURE_2D, this.dummyTex); }
    this.stats.draws++;
    this.stats.tris += (it.mesh.count / 3) * (it.mesh.instanced ? it.mesh.instanceCount : 1);
  }

  /** Project a world point to CSS pixel coordinates; returns false if behind the camera. */
  project(x: number, y: number, z: number, out: number[]): boolean {
    const m = this.vp;
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (cw <= 0.1) return false;
    out[0] = (cx / cw * 0.5 + 0.5) * this.canvas.clientWidth;
    out[1] = (1 - (cy / cw * 0.5 + 0.5)) * this.canvas.clientHeight;
    out[2] = cw;
    return true;
  }

  /** Render the current queue into an offscreen image (used for character portraits). */
  snapshot(w: number, h: number, drawScene: () => void): string {
    const gl = this.gl;
    const fbo = gl.createFramebuffer()!;
    const col = gl.createRenderbuffer()!;
    const dep = gl.createRenderbuffer()!;
    gl.bindRenderbuffer(gl.RENDERBUFFER, col);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, w, h);
    gl.bindRenderbuffer(gl.RENDERBUFFER, dep);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    const ow = this.width, oh = this.height;
    this.width = w; this.height = h;
    drawScene();
    // re-route the final framebuffer bind to our fbo
    const origBind = gl.bindFramebuffer.bind(gl);
    (gl as any).bindFramebuffer = (target: number, fb: WebGLFramebuffer | null) => origBind(target, fb === null ? fbo : fb);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, col);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, dep);
    this.render(null);
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    (gl as any).bindFramebuffer = origBind;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo); gl.deleteRenderbuffer(col); gl.deleteRenderbuffer(dep);
    this.width = ow; this.height = oh;
    const [cv, ctx] = [document.createElement('canvas'), null as CanvasRenderingContext2D | null];
    cv.width = w; cv.height = h;
    const c2 = ctx ?? cv.getContext('2d')!;
    const img = c2.createImageData(w, h);
    for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    c2.putImageData(img, 0, 0);
    return cv.toDataURL('image/png');
  }
}

function norm(v: number[]): number[] { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; }
export { identity };
