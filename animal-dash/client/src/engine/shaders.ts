// GLSL ES 3.00 shaders for the raw WebGL2 renderer.

export const LIT_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec4 aColor;
layout(location=3) in vec2 aUV;
#ifdef INSTANCED
layout(location=4) in vec4 iM0;
layout(location=5) in vec4 iM1;
layout(location=6) in vec4 iM2;
layout(location=7) in vec4 iM3;
layout(location=8) in vec4 iColor;
#endif
#ifdef SKINNED
layout(location=9) in vec4 aJoints;
layout(location=10) in vec4 aWeights;
uniform mat4 uJoints[32];
#endif
uniform mat4 uVP;
uniform mat4 uModel;
uniform mat4 uLightVP;
uniform float uTime;
uniform float uAnim; // 1 = crowd bounce, 2 = wind sway
out vec3 vN;
out vec3 vW;
out vec4 vC;
out vec2 vUV;
out vec4 vLS;
void main() {
  vec3 p = aPos;
  vec4 col = aColor;
  mat4 M = uModel;
#ifdef INSTANCED
  M = uModel * mat4(iM0, iM1, iM2, iM3);
  col.rgb *= iColor.rgb;
  float ph = iColor.a * 6.2831;
  if (uAnim > 0.5 && uAnim < 1.5) {
    float cheer = max(0.0, sin(uTime * (4.0 + iColor.a * 5.0) + ph));
    p.y += cheer * 0.25 * step(0.05, aPos.y);
    p.x += sin(uTime * 2.0 + ph) * 0.04 * aPos.y;
  } else if (uAnim > 1.5) {
    p.x += sin(uTime * 1.7 + ph) * 0.06 * aPos.y * aPos.y;
    p.z += cos(uTime * 1.3 + ph) * 0.04 * aPos.y * aPos.y;
  }
#endif
#ifdef SKINNED
  // joint matrices are full world-space skin matrices (uModel is only used for culling)
  M = uJoints[int(aJoints.x)] * aWeights.x + uJoints[int(aJoints.y)] * aWeights.y
    + uJoints[int(aJoints.z)] * aWeights.z + uJoints[int(aJoints.w)] * aWeights.w;
#endif
  vec4 w = M * vec4(p, 1.0);
  vW = w.xyz;
  vN = mat3(M) * aNormal;
  vC = col;
  vUV = aUV;
  vLS = uLightVP * w;
  gl_Position = uVP * w;
}`;

export const LIT_FS = `#version 300 es
precision highp float;
precision highp sampler2DShadow;
in vec3 vN;
in vec3 vW;
in vec4 vC;
in vec2 vUV;
in vec4 vLS;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uSky;
uniform vec3 uGround;
uniform vec3 uFog;
uniform vec3 uCam;
uniform float uFogDensity;
uniform sampler2DShadow uShadow;
uniform float uShadowOn;
uniform vec4 uTint;
uniform float uEmissive;
uniform sampler2D uTex;
uniform float uUseTex;
uniform float uAlpha;
uniform float uRim;
uniform vec3 uFlash;
uniform float uSpec;
out vec4 outColor;

float shadowAt() {
  vec3 p = vLS.xyz / vLS.w * 0.5 + 0.5;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
  vec2 ts = 1.0 / vec2(textureSize(uShadow, 0));
  float s = 0.0;
  for (int x = -1; x <= 1; x++)
    for (int y = -1; y <= 1; y++)
      s += texture(uShadow, vec3(p.xy + vec2(x, y) * ts * 1.2, p.z - 0.0012));
  return s / 9.0;
}
vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
void main() {
  vec3 n = normalize(vN);
  vec3 alb = pow(vC.rgb * uTint.rgb, vec3(2.2));
  float alpha = uAlpha;
  if (uUseTex > 0.5) { vec4 t = texture(uTex, vUV); alb *= pow(t.rgb, vec3(2.2)); alpha *= t.a; if (alpha < 0.05) discard; }
  float sh = uShadowOn > 0.5 ? shadowAt() : 1.0;
  float nl = max(dot(n, uLightDir), 0.0);
  vec3 V = normalize(uCam - vW);
  vec3 H = normalize(uLightDir + V);
  float spec = pow(max(dot(n, H), 0.0), 48.0) * uSpec * sh;
  vec3 hemi = mix(uGround, uSky, n.y * 0.5 + 0.5);
  float rim = pow(1.0 - max(dot(n, V), 0.0), 3.0) * uRim;
  vec3 col = alb * (hemi + uLightColor * nl * sh) + spec * uLightColor + rim * uSky * 0.8;
  float em = max(vC.a, uEmissive);
  col = mix(col, alb * 2.2, em);
  col += uFlash;
  float d = length(uCam - vW);
  float f = 1.0 - exp(-pow(d * uFogDensity, 2.0));
  col = mix(col, pow(uFog, vec3(2.2)), f);
  col = aces(col * 1.05);
  outColor = vec4(pow(col, vec3(1.0 / 2.2)), alpha);
}`;

export const DEPTH_VS = `#version 300 es
layout(location=0) in vec3 aPos;
#ifdef INSTANCED
layout(location=4) in vec4 iM0;
layout(location=5) in vec4 iM1;
layout(location=6) in vec4 iM2;
layout(location=7) in vec4 iM3;
#endif
#ifdef SKINNED
layout(location=9) in vec4 aJoints;
layout(location=10) in vec4 aWeights;
uniform mat4 uJoints[32];
#endif
uniform mat4 uLightVP;
uniform mat4 uModel;
void main() {
  mat4 M = uModel;
#ifdef INSTANCED
  M = uModel * mat4(iM0, iM1, iM2, iM3);
#endif
#ifdef SKINNED
  M = uJoints[int(aJoints.x)] * aWeights.x + uJoints[int(aJoints.y)] * aWeights.y
    + uJoints[int(aJoints.z)] * aWeights.z + uJoints[int(aJoints.w)] * aWeights.w;
#endif
  gl_Position = uLightVP * M * vec4(aPos, 1.0);
}`;

export const DEPTH_FS = `#version 300 es
precision mediump float;
out vec4 o;
void main() { o = vec4(1.0); }`;

export const SKY_VS = `#version 300 es
out vec2 vP;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2) * 2.0 - 1.0;
  vP = p;
  gl_Position = vec4(p, 0.9999, 1.0);
}`;

export const SKY_FS = `#version 300 es
precision highp float;
in vec2 vP;
uniform mat4 uInvVP;
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uBottom;
uniform vec3 uSunDir;
uniform float uTime;
uniform float uClouds;
out vec4 o;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.55; for (int i = 0; i < 3; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
void main() {
  vec4 w = uInvVP * vec4(vP, 1.0, 1.0);
  vec3 d = normalize(w.xyz / w.w);
  float h = d.y;
  vec3 col = h > 0.0 ? mix(uHorizon, uTop, pow(h, 0.55)) : mix(uHorizon, uBottom, pow(-h, 0.4));
  float sd = max(dot(d, uSunDir), 0.0);
  col += vec3(1.0, 0.9, 0.7) * (pow(sd, 600.0) * 2.0 + pow(sd, 12.0) * 0.25);
  if (uClouds > 0.5 && h > 0.0) {
    vec2 uv = d.xz / (h + 0.12) * 1.6 + vec2(uTime * 0.01, 0.0);
    float c = smoothstep(0.52, 0.8, fbm(uv));
    col = mix(col, vec3(1.0), c * smoothstep(0.0, 0.25, h) * 0.9);
  }
  o = vec4(col, 1.0);
}`;

export const PARTICLE_VS = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 iPosSize;
layout(location=2) in vec4 iColor;
uniform mat4 uVP;
uniform vec3 uRight;
uniform vec3 uUp;
out vec2 vUV;
out vec4 vColor;
void main() {
  vec3 p = iPosSize.xyz + (uRight * aCorner.x + uUp * aCorner.y) * iPosSize.w;
  vUV = aCorner;
  vColor = iColor;
  gl_Position = uVP * vec4(p, 1.0);
  // fade particles that pass right in front of the camera (avoids screen-filling blobs)
  vColor.a *= clamp((gl_Position.w - 1.2) / 3.5, 0.0, 1.0);
}`;

export const PARTICLE_FS = `#version 300 es
precision mediump float;
in vec2 vUV;
in vec4 vColor;
out vec4 o;
void main() {
  float r = length(vUV);
  float a = smoothstep(1.0, 0.35, r) * vColor.a;
  if (a < 0.01) discard;
  o = vec4(vColor.rgb * a, a);
}`;

export const LINES_VS = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 iSeed;
uniform float uTime;
uniform float uAspect;
out float vA;
void main() {
  float ang = iSeed.x * 6.2831;
  float speed = 1.6 + iSeed.y * 1.4;
  float t = fract(uTime * speed * 0.5 + iSeed.z);
  float r0 = 0.35 + t * 1.3;
  float len = 0.12 + iSeed.w * 0.25;
  vec2 dir = vec2(cos(ang), sin(ang));
  vec2 perp = vec2(-dir.y, dir.x);
  float r = r0 + aCorner.y * len;
  vec2 p = dir * r + perp * aCorner.x * 0.0035 * (1.0 + t * 2.0);
  p.x /= uAspect;
  vA = (1.0 - abs(aCorner.y * 2.0 - 1.0)) * smoothstep(0.0, 0.3, t) * (1.0 - t);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

export const LINES_FS = `#version 300 es
precision mediump float;
in float vA;
uniform float uIntensity;
uniform vec3 uColor;
out vec4 o;
void main() { float a = vA * uIntensity; o = vec4(uColor * a, a); }`;
