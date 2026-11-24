// Thin WebGL2 helpers: shader programs with cached uniform locations, textures.

export class Program {
  readonly prog: WebGLProgram;
  private locs = new Map<string, WebGLUniformLocation | null>();
  constructor(private gl: WebGL2RenderingContext, vs: string, fs: string, defines: string[] = []) {
    const header = defines.map((d) => `#define ${d}\n`).join('');
    const inject = (src: string) => src.replace('#version 300 es\n', `#version 300 es\n${header}`);
    const v = compile(gl, gl.VERTEX_SHADER, inject(vs));
    const f = compile(gl, gl.FRAGMENT_SHADER, inject(fs));
    const p = gl.createProgram()!;
    gl.attachShader(p, v); gl.attachShader(p, f);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Program link failed: ' + gl.getProgramInfoLog(p));
    gl.deleteShader(v); gl.deleteShader(f);
    this.prog = p;
  }
  use(): void { this.gl.useProgram(this.prog); }
  loc(name: string): WebGLUniformLocation | null {
    let l = this.locs.get(name);
    if (l === undefined) { l = this.gl.getUniformLocation(this.prog, name); this.locs.set(name, l); }
    return l;
  }
  m4(name: string, m: Float32Array) { const l = this.loc(name); if (l) this.gl.uniformMatrix4fv(l, false, m); }
  v3(name: string, x: number, y: number, z: number) { const l = this.loc(name); if (l) this.gl.uniform3f(l, x, y, z); }
  v3a(name: string, v: ArrayLike<number>) { const l = this.loc(name); if (l) this.gl.uniform3f(l, v[0], v[1], v[2]); }
  v4(name: string, x: number, y: number, z: number, w: number) { const l = this.loc(name); if (l) this.gl.uniform4f(l, x, y, z, w); }
  f(name: string, x: number) { const l = this.loc(name); if (l) this.gl.uniform1f(l, x); }
  i(name: string, x: number) { const l = this.loc(name); if (l) this.gl.uniform1i(l, x); }
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    console.error(src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n'));
    throw new Error('Shader compile failed: ' + log);
  }
  return s;
}

export function textureFromCanvas(gl: WebGL2RenderingContext, canvas: HTMLCanvasElement | OffscreenCanvas, repeat = false): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas as TexImageSource);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  const ext = gl.getExtension('EXT_texture_filter_anisotropic');
  if (ext) gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, 8);
  return t;
}

export function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!];
}
