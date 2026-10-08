// 3D and elevation views rendered with three.js. Model millimetres map to
// metres; plan (x, y) maps to three.js (x, -z) and elevation to +y.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { getType, getLevel, getElement, sortedLevels, openingExtents } from '../core/model.js';
import { wallFootprints, wallPieces } from '../core/wallgeom.js';
import { pitchedRoofFaces } from '../core/roofgeom.js';

const M = 0.001;
const ELEVATIONS = {
  north: { label: 'North', dir: new THREE.Vector3(0, 0, -1) },
  south: { label: 'South', dir: new THREE.Vector3(0, 0, 1) },
  east: { label: 'East', dir: new THREE.Vector3(1, 0, 0) },
  west: { label: 'West', dir: new THREE.Vector3(-1, 0, 0) },
};

export class View3D {
  constructor(app, mode = '3d') {
    this.app = app;
    this.mode = mode;
    this.kind = mode === '3d' ? '3d' : 'elevation';
    this.builtRev = -1;
    this.builtDoc = null;
    this.materials = new Map();
    this.fitted = false;
  }

  get doc() {
    return this.app.model.doc;
  }

  title() {
    return this.mode === '3d' ? '{3D}' : `Elevation: ${ELEVATIONS[this.mode].label}`;
  }

  key() {
    return this.mode === '3d' ? '3d' : `elev:${this.mode}`;
  }

  settings() {
    return this.doc.viewSettings[this.key()] || {};
  }

  init() {
    if (this.renderer) return;
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    } catch {
      throw new Error('3D graphics (WebGL) are not available on this computer.');
    }
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.canvas = this.renderer.domElement;
    this.canvas.tabIndex = 0;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(this.kind === '3d' ? 0xdfe7ef : 0xffffff);
    if (this.kind === '3d') {
      this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 5000);
    } else {
      this.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, -5000, 5000);
    }
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x9aa3ad, this.kind === '3d' ? 1.6 : 2.4);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, this.kind === '3d' ? 2.2 : 0.8);
    this.sun.castShadow = this.kind === '3d';
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target);

    this.modelGroup = new THREE.Group();
    this.scene.add(this.modelGroup);
    this.annoGroup = new THREE.Group();
    this.scene.add(this.annoGroup);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.screenSpacePanning = true;
    if (this.kind === 'elevation') {
      this.controls.enableRotate = false;
      this.controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    }
    this.controls.addEventListener('change', () => this.invalidate());

    this.raycaster = new THREE.Raycaster();
    let down = null;
    this.canvas.addEventListener('pointerdown', (e) => {
      this.canvas.focus();
      down = { x: e.clientX, y: e.clientY };
    });
    this.canvas.addEventListener('pointerup', (e) => {
      if (!down || e.button !== 0) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4;
      down = null;
      if (moved) return;
      const id = this.pick(e);
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        if (id) this.app.toggleSelect(id);
      } else this.app.select(id ? [id] : []);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      const r = this.canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      if (this.kind === 'elevation') {
        const p = new THREE.Vector3(ndc.x, ndc.y, 0).unproject(this.camera);
        this.app.setCoords(null, `Elev ${Math.round(p.y / M)} mm`);
      }
    });
  }

  mount(host) {
    this.init();
    this.host = host;
    host.append(this.canvas);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    this.refresh();
    if (!this.fitted) {
      this.zoomToFit();
      this.fitted = true;
    }
  }

  unmount() {
    this.resizeObserver?.disconnect();
    this.canvas?.remove();
  }

  dispose() {
    this.unmount();
    if (!this.renderer) return;
    this.clearGroup(this.modelGroup);
    this.clearGroup(this.annoGroup);
    for (const m of this.materials.values()) m.dispose();
    this.controls?.dispose();
    this.renderer?.dispose();
    this.renderer = null;
  }

  resize() {
    if (!this.host || !this.renderer) return;
    const r = this.host.getBoundingClientRect();
    this.width = Math.max(1, r.width);
    this.height = Math.max(1, r.height);
    this.renderer.setSize(this.width, this.height, false);
    this.updateProjection();
    this.invalidate(true);
  }

  updateProjection() {
    const aspect = this.width / this.height;
    if (this.camera.isPerspectiveCamera) {
      this.camera.aspect = aspect;
    } else {
      const h = this.orthoHeight || 20;
      this.camera.left = (-h * aspect) / 2;
      this.camera.right = (h * aspect) / 2;
      this.camera.top = h / 2;
      this.camera.bottom = -h / 2;
    }
    this.camera.updateProjectionMatrix();
  }

  invalidate(now = false) {
    if (!this.renderer) return;
    if (now) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      if (this.renderer) this.renderer.render(this.scene, this.camera);
    });
  }

  /** Rebuild geometry when the model changed; always refresh selection colours. */
  refresh() {
    if (!this.renderer) return;
    if (this.builtRev !== this.app.model.rev || this.builtDoc !== this.doc || this.builtSettings !== JSON.stringify(this.settings())) this.rebuild();
    this.updateSelection();
    this.invalidate();
  }

  material(color, opts = {}) {
    const key = `${color}|${JSON.stringify(opts)}`;
    if (!this.materials.has(key)) {
      this.materials.set(key, new THREE.MeshStandardMaterial({
        color: new THREE.Color(color), roughness: 0.85, metalness: 0.0, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, ...opts,
      }));
    }
    return this.materials.get(key);
  }

  clearGroup(group) {
    for (const child of [...group.children]) {
      child.traverse((o) => {
        o.geometry?.dispose();
        if (o.material?.map) o.material.map.dispose();
        if (o.isSprite) o.material.dispose();
      });
      group.remove(child);
    }
  }

  addMesh(geometry, material, id, group = this.modelGroup) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { id, baseMaterial: material };
    group.add(mesh);
    if (this.settings().edges !== false) {
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 25), this.edgeMaterial);
      edges.raycast = () => {};
      group.add(edges);
    }
    return mesh;
  }

  prism(poly, z0, z1) {
    const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p.x * M, p.y * M)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: Math.max(1e-4, (z1 - z0) * M), bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, z0 * M, 0);
    return geo;
  }

  box(w, h, d) {
    return new THREE.BoxGeometry(Math.max(1e-4, w * M), Math.max(1e-4, h * M), Math.max(1e-4, d * M));
  }

  rebuild() {
    const doc = this.doc;
    this.builtRev = this.app.model.rev;
    this.builtDoc = doc;
    this.builtSettings = JSON.stringify(this.settings());
    this.clearGroup(this.modelGroup);
    this.clearGroup(this.annoGroup);
    this.edgeMaterial ??= new THREE.LineBasicMaterial({ color: 0x2a2f36, transparent: true, opacity: 0.55 });
    const hidden = new Set(this.settings().hidden || []);
    const show = (cat) => !hidden.has(cat);

    for (const level of sortedLevels(doc)) {
      const footprints = wallFootprints(doc, level.id);
      for (const wall of doc.elements.filter((e) => e.category === 'wall' && e.levelId === level.id)) {
        if (!show('wall')) break;
        const fp = footprints.get(wall.id);
        if (!fp) continue;
        const type = getType(doc, 'wall', wall.typeId);
        const base = level.elevation + (wall.baseOffset || 0);
        for (const piece of wallPieces(doc, wall, fp)) {
          this.addMesh(this.prism(piece.poly, base + piece.z0, base + piece.z1), this.material(type.color), wall.id);
        }
        for (const el of doc.elements.filter((e) => e.hostId === wall.id)) {
          if (show(el.category)) this.buildOpening(el, wall, fp.frame, base);
        }
      }
    }

    for (const el of doc.elements) {
      if (!show(el.category)) continue;
      const level = getLevel(doc, el.levelId);
      if (!level) continue;
      if (el.category === 'floor') {
        const type = getType(doc, 'floor', el.typeId);
        const top = level.elevation + (el.offset || 0);
        this.addMesh(this.prism(el.points, top - type.thickness, top), this.material(type.color), el.id);
      } else if (el.category === 'roof') {
        const type = getType(doc, 'roof', el.typeId);
        const base = level.elevation + (el.baseOffset || 0);
        if (!el.shape || el.shape === 'flat') {
          this.addMesh(this.prism(el.points, base, base + type.thickness), this.material(type.color), el.id);
        } else {
          const faces = pitchedRoofFaces(el.points, el.shape, el.slope ?? 30);
          const pos = [];
          for (const f of faces) {
            for (let i = 1; i < f.length - 1; i++) {
              for (const p of [f[0], f[i], f[i + 1]]) pos.push(p.x * M, (base + p.z) * M, -p.y * M);
            }
          }
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
          geo.computeVertexNormals();
          this.addMesh(geo, this.material(type.color), el.id);
        }
      }
    }

    // Ground and lighting fitted to the model.
    const box = new THREE.Box3().setFromObject(this.modelGroup);
    const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
    const size = box.isEmpty() ? 20 : Math.max(10, box.getSize(new THREE.Vector3()).length());
    const minY = box.isEmpty() ? 0 : Math.min(box.min.y, (sortedLevels(doc)[0]?.elevation ?? 0) * M);
    if (this.kind === '3d') {
      const ground = new THREE.Mesh(new THREE.CircleGeometry(size * 3, 64), new THREE.MeshStandardMaterial({ color: 0xc9d1c3, roughness: 1 }));
      ground.rotation.x = -Math.PI / 2;
      ground.position.set(center.x, minY - 0.005, center.z);
      ground.receiveShadow = true;
      ground.raycast = () => {};
      this.annoGroup.add(ground);
      this.sun.position.set(center.x - size * 0.6, center.y + size * 1.2, center.z + size * 0.9);
      this.sun.target.position.copy(center);
      const cam = this.sun.shadow.camera;
      cam.left = -size;
      cam.right = size;
      cam.top = size;
      cam.bottom = -size;
      cam.near = 0.1;
      cam.far = size * 4;
      cam.updateProjectionMatrix();
      this.sun.castShadow = this.settings().shadows !== false;
    } else {
      this.sun.position.copy(center).add(ELEVATIONS[this.mode].dir.clone().multiplyScalar(size)).add(new THREE.Vector3(0, size, 0));
      this.sun.target.position.copy(center);
      this.buildLevelMarkers(box);
    }
    this.modelBox = box;
  }

  buildOpening(el, wall, frame, base) {
    const ex = openingExtents(this.doc, el);
    if (!ex) return;
    const type = getType(this.doc, el.category, el.typeId);
    const group = new THREE.Group();
    const { d, t } = frame;
    const fw = el.category === 'door' ? 50 : 60;
    const depth = el.category === 'door' ? t : Math.min(t, 120);
    const frameMat = this.material(el.category === 'door' ? '#e9e5dc' : type.color);
    const part = (geo, mat, x, y, z = 0) => {
      geo.translate(x * M, y * M, z * M);
      const mesh = this.addMesh(geo, mat, el.id, group);
      return mesh;
    };
    const W = ex.width;
    const H = ex.height;
    // Frame: two jambs and a head (and a sill for windows).
    part(this.box(fw, H, depth), frameMat, fw / 2, H / 2);
    part(this.box(fw, H, depth), frameMat, W - fw / 2, H / 2);
    part(this.box(W, fw, depth), frameMat, W / 2, H - fw / 2);
    if (el.category === 'window') {
      part(this.box(W, fw, depth + 40), frameMat, W / 2, fw / 2);
      const glass = this.material('#9cc3e6', { transparent: true, opacity: 0.35, roughness: 0.1, metalness: 0.2, depthWrite: false });
      const g = part(this.box(W - 2 * fw, H - 2 * fw, 12), glass, W / 2, H / 2);
      g.castShadow = false;
      if (W > 1200) part(this.box(fw * 0.8, H - 2 * fw, depth * 0.8), frameMat, W / 2, H / 2);
    } else {
      const leafMat = this.material(type.color);
      const leaves = type.leaves === '2' ? 2 : 1;
      const lw = (W - 2 * fw) / leaves;
      for (let i = 0; i < leaves; i++) part(this.box(lw - 4, H - fw - 10, 40), leafMat, fw + lw * i + lw / 2, (H - fw - 10) / 2);
    }
    // Place the opening in the wall: local X along the wall from u0, Y up.
    const start = { x: wall.a.x + d.x * ex.u0, y: wall.a.y + d.y * ex.u0 };
    group.position.set(start.x * M, (base + ex.z0) * M, -start.y * M);
    group.rotation.y = Math.atan2(d.y, d.x);
    this.modelGroup.add(group);
  }

  buildLevelMarkers(box) {
    if (box.isEmpty()) return;
    const dir = ELEVATIONS[this.mode].dir;
    const across = new THREE.Vector3(-dir.z, 0, dir.x); // screen-right for this elevation
    const corners = [];
    for (const x of [box.min.x, box.max.x]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, 0, z).dot(across));
    const lo = Math.min(...corners) - 1.5;
    const hi = Math.max(...corners) + 5;
    const front = box.getCenter(new THREE.Vector3()).add(dir.clone().multiplyScalar(box.getSize(new THREE.Vector3()).length()));
    const mat = new THREE.LineDashedMaterial({ color: 0x4f6275, dashSize: 0.4, gapSize: 0.15 });
    for (const level of sortedLevels(this.doc)) {
      const y = level.elevation * M;
      const base = new THREE.Vector3(front.x, y, front.z).sub(across.clone().multiplyScalar(front.clone().dot(across)));
      const a = base.clone().add(across.clone().multiplyScalar(lo));
      const b = base.clone().add(across.clone().multiplyScalar(hi));
      const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
      const line = new THREE.Line(geo, mat);
      line.computeLineDistances();
      this.annoGroup.add(line);
      const label = this.textSprite(`${level.name}  ${(level.elevation / 1000).toFixed(3)}`);
      label.position.copy(b).sub(across.clone().multiplyScalar(label.scale.x / 2)).add(new THREE.Vector3(0, 0.3, 0));
      this.annoGroup.add(label);
    }
  }

  textSprite(text) {
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    ctx.font = '600 40px -apple-system, BlinkMacSystemFont, sans-serif';
    const w = Math.ceil(ctx.measureText(text).width) + 20;
    c.width = w;
    c.height = 56;
    ctx.font = '600 40px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillStyle = '#4f6275';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 10, 28);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
    const hgt = 0.45;
    sprite.scale.set((hgt * w) / 56, hgt, 1);
    sprite.raycast = () => {};
    return sprite;
  }

  updateSelection() {
    this.selMaterial ??= new THREE.MeshStandardMaterial({ color: 0x1a73e8, roughness: 0.6, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
    const sel = this.app.selection;
    this.modelGroup.traverse((o) => {
      if (!o.isMesh || !o.userData.baseMaterial) return;
      o.material = sel.has(o.userData.id) ? this.selMaterial : o.userData.baseMaterial;
    });
  }

  pick(e) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.modelGroup.children, true);
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData?.id) o = o.parent;
      if (o?.userData?.id && getElement(this.doc, o.userData.id)) return o.userData.id;
    }
    return null;
  }

  zoomToFit() {
    if (!this.renderer) return;
    if (this.builtRev !== this.app.model.rev) this.rebuild();
    const box = this.modelBox && !this.modelBox.isEmpty() ? this.modelBox : new THREE.Box3(new THREE.Vector3(-5, 0, -5), new THREE.Vector3(5, 3, 5));
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(2, size.length() / 2);
    if (this.kind === '3d') {
      const dir = new THREE.Vector3(1, 0.75, 1.15).normalize();
      const dist = radius / Math.sin((this.camera.fov * Math.PI) / 360) * 1.05;
      this.camera.position.copy(center).add(dir.multiplyScalar(dist));
      this.camera.near = Math.max(0.05, dist / 500);
      this.camera.far = dist * 20;
    } else {
      const dir = ELEVATIONS[this.mode].dir;
      this.camera.position.copy(center).add(dir.clone().multiplyScalar(radius * 4));
      const aspect = this.width / this.height;
      const horiz = Math.abs(dir.x) > 0 ? size.z : size.x;
      this.orthoHeight = Math.max(size.y * 1.4, (horiz * 1.25 + 12) / aspect, 6);
      this.camera.zoom = 1;
    }
    this.controls.target.copy(center);
    this.camera.lookAt(center);
    this.updateProjection();
    this.controls.update();
    this.invalidate();
  }

  toDataURL() {
    if (!this.renderer) return null;
    this.renderer.render(this.scene, this.camera);
    return this.canvas.toDataURL('image/png');
  }
}

export { ELEVATIONS };
