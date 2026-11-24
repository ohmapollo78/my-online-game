// Item boxes, stamina pickups, item entities (bananas, chickens) and item/ability effect meshes.
import { laneX } from '@shared/constants';
import { MeshBuilder, Mesh, M, RGB } from '../engine/mesh';
import { Renderer } from '../engine/renderer';
import { mat4, multiply, compose, hexToRgb } from '../engine/math';
import { TrackScene } from '../tracks/trackScene';
import { questionTexture } from '../engine/textures';

const c = (h: number): RGB => hexToRgb(h);

export interface EntityView { id: number; type: number; s: number; x: number; }

export class ItemMeshes {
  box: Mesh; boxGlow: Mesh; bone: Mesh; banana: Mesh; chickenBody: Mesh; chickenLeg: Mesh;
  shield: Mesh; magnet: Mesh; meat: Mesh; rocket: Mesh; ice: Mesh; ring: Mesh; bomb: Mesh; star: Mesh;
  qTex: WebGLTexture;
  constructor(gl: WebGL2RenderingContext) {
    this.qTex = questionTexture(gl);
    this.box = new MeshBuilder().box(M(0, 0, 0), 0.9, 0.9, 0.9, [1, 1, 1]).build(gl);
    this.boxGlow = new MeshBuilder().sphere(M(0, 0, 0), 0.75, 0.75, 0.75, c(0xffb43a), 14, 10, 1).build(gl);
    const bone = new MeshBuilder();
    bone.capsule(M(0, 0, 0, 0, 0, Math.PI / 2), 0.09, 0.5, c(0x7fd6ff), 10, 0.5);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) bone.sphere(M(sx * 0.33, sz * 0.09, 0), 0.13, 0.13, 0.13, c(0x7fd6ff), 10, 8, 0.5);
    this.bone = bone.build(gl);
    const ban = new MeshBuilder();
    ban.torus(M(0, 0.12, 0, Math.PI / 2, 0, 0), 0.28, 0.09, (x) => (Math.abs(x) > 0.24 ? c(0x6b4a1a) : c(0xffd83a)), 14, 8, Math.PI * 0.9);
    ban.sphere(M(0, 0.04, 0.0), 0.3, 0.04, 0.3, c(0xffe680), 12, 6);
    this.banana = ban.build(gl);
    const ch = new MeshBuilder();
    ch.sphere(M(0, 0.45, 0), 0.26, 0.24, 0.3, c(0xffffff), 14, 10);
    ch.sphere(M(0, 0.72, 0.2), 0.14, 0.15, 0.14, c(0xffffff), 12, 8);
    ch.cylinder(M(0, 0.69, 0.33, Math.PI / 2, 0, 0), 0.0, 0.05, 0.1, c(0xffb21a), 8);
    ch.box(M(0, 0.88, 0.2), 0.04, 0.1, 0.16, c(0xe8262f));
    ch.sphere(M(0, 0.6, 0.31), 0.03, 0.05, 0.03, c(0xe8262f), 6, 4);
    for (const sx of [-1, 1]) {
      ch.sphere(M(sx * 0.07, 0.76, 0.3), 0.025, 0.025, 0.02, c(0x111111), 6, 4);
      ch.sphere(M(sx * 0.24, 0.48, -0.02), 0.06, 0.15, 0.2, c(0xf2f2f2), 8, 6);
    }
    ch.sphere(M(0, 0.55, -0.3), 0.1, 0.16, 0.08, c(0xffffff), 8, 6);
    this.chickenBody = ch.build(gl);
    this.chickenLeg = new MeshBuilder().box(M(0, -0.12, 0), 0.03, 0.24, 0.03, c(0xffa21a)).box(M(0, -0.24, 0.04), 0.1, 0.02, 0.12, c(0xffa21a)).build(gl);
    this.shield = new MeshBuilder().sphere(M(0, 0, 0), 1, 1, 1, c(0x6fe3ff), 20, 14, 0.6).build(gl);
    const mg = new MeshBuilder();
    mg.torus(M(0, 0, 0, Math.PI / 2, 0, Math.PI), 0.22, 0.08, c(0xe8262f), 16, 8, Math.PI);
    for (const sx of [-1, 1]) mg.cylinder(M(sx * 0.22, -0.18, 0), 0.08, 0.08, 0.18, c(0xd8dde6), 10);
    this.magnet = mg.build(gl);
    const meat = new MeshBuilder();
    meat.sphere(M(0, 0, 0.1), 0.26, 0.22, 0.32, c(0xb5542a), 14, 10);
    meat.cylinder(M(0, 0, -0.2, -Math.PI / 2, 0, 0), 0.05, 0.05, 0.35, c(0xfff4e0), 8);
    meat.sphere(M(0.05, 0, -0.56), 0.08, 0.08, 0.08, c(0xfff4e0), 8, 6);
    meat.sphere(M(-0.05, 0, -0.56), 0.08, 0.08, 0.08, c(0xfff4e0), 8, 6);
    this.meat = meat.build(gl);
    const rk = new MeshBuilder();
    rk.cylinder(M(0, 0, -0.35, Math.PI / 2, 0, 0), 0.14, 0.14, 0.6, c(0xe8262f), 12);
    rk.cylinder(M(0, 0, 0.25, Math.PI / 2, 0, 0), 0, 0.14, 0.25, c(0xffffff), 12);
    for (let i = 0; i < 3; i++) rk.box(M(Math.cos(i * 2.1) * 0.16, Math.sin(i * 2.1) * 0.16, -0.3, 0, 0, i * 2.1), 0.03, 0.2, 0.2, c(0xffc21a));
    this.rocket = rk.build(gl);
    const ice = new MeshBuilder();
    for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; ice.cylinder(M(Math.cos(a) * 0.55, 0, Math.sin(a) * 0.55, Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3), 0, 0.14, 0.6 + (i % 3) * 0.2, c(0xbff4ff), 6, true, 0.4); }
    this.ice = ice.build(gl);
    this.ring = new MeshBuilder().torus(M(0, 0, 0), 1, 0.12, [1, 1, 1], 40, 6, Math.PI * 2, 1).build(gl);
    this.bomb = new MeshBuilder().sphere(M(0, 0, 0), 0.35, 0.35, 0.35, c(0x222228), 14, 10).cylinder(M(0, 0.3, 0), 0.05, 0.05, 0.15, c(0xaa8855), 6).build(gl);
    const star = new MeshBuilder();
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; star.cylinder(M(0, 0, 0, 0, 0, a), 0.0, 0.05, 0.16, c(0xffe14a), 4, true, 1); }
    this.star = star.build(gl);
  }
}

export class ItemRenderer {
  readonly meshes: ItemMeshes;
  private m = mat4(); private m2 = mat4(); private m3 = mat4();
  constructor(gl: WebGL2RenderingContext, private scene: TrackScene) { this.meshes = new ItemMeshes(gl); }

  draw(r: Renderer, t: number, sNear: number, boxAvail: (i: number) => boolean, pickAvail: (i: number) => boolean, entities: EntityView[]): void {
    const path = this.scene.path;
    const lapL = path.lapLength;
    const laps = this.scene.def.laps;
    const ls = laps > 1 ? ((sNear % lapL) + lapL) % lapL : sNear;
    const near = (s: number) => {
      let ds = s - ls;
      if (laps > 1) { if (ds < -lapL / 2) ds += lapL; else if (ds > lapL / 2) ds -= lapL; }
      return ds > -30 && ds < 220;
    };
    const { m, m2, m3 } = this;
    const mm = this.meshes;
    this.scene.track.boxes.forEach((b, i) => {
      if (!near(b.s) || !boxAvail(i)) return;
      path.frame(b.s, laneX(b.lane), 1.05 + Math.sin(t * 3 + i) * 0.12, m);
      compose(m2, 0, 0, 0, 0.35, t * 1.8 + i, 0.2);
      multiply(m3, m, m2);
      r.draw(mm.box, m3, { tex: mm.qTex, emissive: 0.55, rim: 0.6 });
      r.draw(mm.boxGlow, m, { alpha: 0.18 + Math.sin(t * 5 + i) * 0.05, emissive: 1, shadow: false });
    });
    this.scene.track.pickups.forEach((p, i) => {
      if (!near(p.s) || !pickAvail(i)) return;
      path.frame(p.s, laneX(p.lane), 0.9 + Math.sin(t * 4 + i) * 0.1, m);
      compose(m2, 0, 0, 0, 0, t * 2.5, 0.3);
      multiply(m3, m, m2);
      r.draw(mm.bone, m3, { emissive: 0.35, rim: 0.8 });
    });
    for (const e of entities) {
      if (e.type === 0) {
        path.frame(e.s, e.x, 0, m);
        r.draw(mm.banana, m);
      } else {
        path.frame(e.s, e.x, Math.abs(Math.sin(t * 18 + e.id)) * 0.12, m);
        r.draw(mm.chickenBody, m);
        for (const sx of [-1, 1]) {
          compose(m2, sx * 0.1, 0.3, 0, Math.sin(t * 25 + e.id + (sx > 0 ? Math.PI : 0)) * 0.9, 0, 0);
          multiply(m3, m, m2);
          r.draw(mm.chickenLeg, m3);
        }
      }
    }
  }
}
