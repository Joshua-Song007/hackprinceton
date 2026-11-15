// three.js render of a scene: boxes for entities, floor grid, axis gizmo, selection outline, head-pose camera.
// Colors come from the brand-kit CSS custom properties (studio-tokens.css), so theme switches reach the viewport.
import * as THREE from 'three';
import type { Pose } from '@pear/core';
import type { WorldEntity } from './scene';
import { DEFAULT_ORBIT, contentBounds, frameBox, moveBy, orbitBy, orbitPosition, panBy, rayPlaneY, zoomBy, type OrbitState } from './orbit';

export interface ViewportColors {
  viewport: string;
  grid: string;
  accent: string;
  selection: string;
  text: string;
  axisX: string;
  axisY: string;
  axisZ: string;
}

/** Dark theme values of studio-tokens.css, used when the page has not loaded the tokens. */
export const DARK_VIEWPORT_COLORS: ViewportColors = {
  viewport: '#3d3e43', grid: '#4c4d53', accent: '#c2efb3', selection: '#e5b181', text: '#e4e5e7',
  axisX: '#f0716b', axisY: '#7cc96a', axisZ: '#6aa7f0',
};

function labelTexture(text: string, color: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = color;
  g.font = 'bold 48px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 32, 34);
  return new THREE.CanvasTexture(c);
}

const TOKENS: Record<keyof ViewportColors, string> = {
  viewport: '--viewport', grid: '--viewport-grid', accent: '--accent', selection: '--selection', text: '--text',
  axisX: '--axis-x', axisY: '--axis-y', axisZ: '--axis-z',
};

export function readViewportColors(el: Element = document.documentElement): ViewportColors {
  const style = getComputedStyle(el);
  const out = { ...DARK_VIEWPORT_COLORS };
  for (const key of Object.keys(TOKENS) as (keyof ViewportColors)[]) {
    const value = style.getPropertyValue(TOKENS[key]).trim();
    if (value) out[key] = value;
  }
  return out;
}


export class Viewport {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(70, 1, 0.05, 200);
  private content = new THREE.Group();
  private guides = new THREE.Group(); // floor grid and origin axes: editor aids, hidden in previews
  private entities: WorldEntity[] = [];
  private selected: string | null = null;
  private orbit: OrbitState = DEFAULT_ORBIT;
  private headDriven = false;
  private players: { id: string; position: readonly [number, number, number]; self?: boolean }[] = [];
  private gizmoScene = new THREE.Scene();
  private gizmoCamera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  private gizmo = new THREE.Group();

  constructor(canvas: HTMLCanvasElement, private colors: ViewportColors = readViewportColors()) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.scene.add(this.content);
    this.gizmoScene.add(this.gizmo);
    this.rebuild();
    this.setHeadPose(null);
  }

  setColors(colors: ViewportColors): void {
    this.colors = colors;
    this.rebuild();
  }

  setScene(entities: WorldEntity[]): void {
    this.entities = entities;
    this.rebuild();
  }

  /** Small markers for the players in a run (this one highlighted); empty clears them. */
  setPlayers(markers: { id: string; position: readonly [number, number, number]; self?: boolean }[]): void {
    const same = markers.length === this.players.length
      && markers.every((m, i) => { const o = this.players[i]!; return m.id === o.id && !m.self === !o.self && Math.abs(m.position[0] - o.position[0]) < 0.01 && Math.abs(m.position[2] - o.position[2]) < 0.01; });
    if (same) return; // called every frame; rebuild only when a marker moved
    this.players = markers;
    this.rebuild();
  }

  select(id: string | null): void {
    this.selected = id;
    this.rebuild();
  }

  /**
   * Entity id under a canvas point in normalized device coordinates (-1..1, +y up); null on a miss.
   * Boxes are translucent and rooms enclose their contents, so the smallest box on the ray wins, not the nearest.
   */
  pick(ndcX: number, ndcY: number): string | null {
    this.camera.updateMatrixWorld();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    let best: { id: string; volume: number } | null = null;
    this.content.updateMatrixWorld(true); // groups rebuilt since the last render (e.g. by select) have stale matrices
    for (const hit of ray.intersectObjects(this.content.children, true)) {
      if (!(hit.object instanceof THREE.Mesh)) continue; // edge lines match within a 1 m threshold
      const id = hit.object.parent?.userData.entityId;
      const e = typeof id === 'string' ? this.entities.find((x) => x.id === id) : undefined;
      const volume = e ? Math.abs(e.scale[0] * e.scale[1] * e.scale[2]) : Infinity;
      if (e && (!best || volume < best.volume)) best = { id: e.id, volume };
    }
    return best?.id ?? null;
  }

  /** Point under a canvas position (NDC) on the horizontal plane y = planeY, for dragging entities; null when the ray misses it. */
  groundPoint(ndcX: number, ndcY: number, planeY: number): readonly [number, number, number] | null {
    this.camera.updateMatrixWorld();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const { origin, direction: d } = ray.ray;
    return rayPlaneY([origin.x, origin.y, origin.z], [d.x, d.y, d.z], planeY);
  }

  /** Head pose drives the camera (-Z forward, like the schema). null returns to the fixed editor camera. */
  setHeadPose(pose: Pose | null): void {
    this.headDriven = pose !== null;
    if (pose) {
      this.camera.position.set(...pose.position);
      this.camera.quaternion.set(...pose.orientation);
    } else this.applyOrbit();
  }

  /** Editor camera moves (no effect while the head pose drives the camera). */
  orbitBy(dxPx: number, dyPx: number): void {
    this.setOrbit(orbitBy(this.orbit, dxPx, dyPx));
  }

  /** Fly: inputs are -1, 0 or 1 for forward / right / up. */
  fly(forward: number, right: number, up: number, distance: number): void {
    if (forward || right || up) this.setOrbit(moveBy(this.orbit, forward, right, up, distance));
  }

  panBy(dxPx: number, dyPx: number): void {
    this.setOrbit(panBy(this.orbit, dxPx, dyPx));
  }

  zoomBy(wheelDelta: number): void {
    this.setOrbit(zoomBy(this.orbit, wheelDelta));
  }

  resetCamera(): void {
    this.setOrbit(DEFAULT_ORBIT);
  }

  /** Centers the editor camera on the selected entity; returns false when nothing is selected. */
  frameSelected(): boolean {
    const e = this.entities.find((x) => x.id === this.selected);
    if (!e) return false;
    this.setOrbit(frameBox(this.orbit, e.position, e.scale));
    return true;
  }

  private setOrbit(s: OrbitState): void {
    this.orbit = s;
    if (!this.headDriven) this.applyOrbit();
  }

  private applyOrbit(): void {
    this.camera.position.set(...orbitPosition(this.orbit));
    this.camera.lookAt(...this.orbit.target);
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
    this.renderGizmo();
  }

  /**
   * A preview of the current scene as a JPEG data URL (projects screen): resizes the canvas, frames the content from
   * a three-quarter view, draws without the grid and axis arrows and reads the canvas in the same task as the render, so no
   * preserveDrawingBuffer is needed. Meant for a Viewport of its own, not the editor's.
   */
  snapshot(width: number, height: number): string {
    this.resize(width, height);
    const box = contentBounds(this.entities);
    this.setOrbit(box ? frameBox({ ...DEFAULT_ORBIT, yaw: 0.6 }, box.center, box.size, 1.8) : { ...DEFAULT_ORBIT, yaw: 0.6 });
    this.guides.visible = false;
    try {
      this.renderer.render(this.scene, this.camera);
      return this.renderer.domElement.toDataURL('image/jpeg', 0.8);
    } finally {
      this.guides.visible = true;
    }
  }

  /** Axis cube in the top-right corner: the world axes seen from the current camera orientation. */
  private renderGizmo(): void {
    const r = this.renderer;
    const size = r.getSize(new THREE.Vector2());
    const s = Math.round(Math.min(140, Math.min(size.x, size.y) * 0.3));
    if (s < 40) return; // panel too small for a readable gizmo
    const pad = Math.round(s * 0.08);
    this.gizmoCamera.position.set(0, 0, 4.2).applyQuaternion(this.camera.quaternion);
    this.gizmoCamera.quaternion.copy(this.camera.quaternion);
    r.autoClear = false;
    r.clearDepth();
    r.setScissorTest(true);
    r.setViewport(size.x - s - pad, size.y - s - pad, s, s); // origin is bottom-left
    r.setScissor(size.x - s - pad, size.y - s - pad, s, s);
    r.render(this.gizmoScene, this.gizmoCamera);
    r.setScissorTest(false);
    r.setViewport(0, 0, size.x, size.y);
    r.autoClear = true;
  }

  private buildGizmo(): void {
    this.gizmo.traverse((o) => {
      if (o instanceof THREE.Sprite) {
        o.material.map?.dispose();
        o.material.dispose();
      } else if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    this.gizmo.clear();
    const c = this.colors;
    const box = new THREE.BoxGeometry(0.9, 0.9, 0.9);
    this.gizmo.add(
      new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: c.grid, transparent: true, opacity: 0.55 })),
      new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: c.text })),
    );
    const axes: [string, readonly [number, number, number], string][] = [
      ['X', [1, 0, 0], c.axisX], ['Y', [0, 1, 0], c.axisY], ['Z', [0, 0, 1], c.axisZ],
    ];
    for (const [label, dir, color] of axes) {
      const v = new THREE.Vector3(...dir);
      this.gizmo.add(new THREE.ArrowHelper(v, new THREE.Vector3(), 1.35, color, 0.3, 0.18));
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(label, color), depthTest: false }));
      sprite.position.copy(v).multiplyScalar(1.75);
      sprite.scale.setScalar(0.6);
      this.gizmo.add(sprite);
    }
  }

  dispose(): void {
    this.clear();
    this.renderer.dispose();
  }

  private clear(): void {
    this.content.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    this.content.clear();
  }

  private rebuild(): void {
    this.clear();
    const c = this.colors;
    this.scene.background = new THREE.Color(c.viewport);
    this.buildGizmo();

    this.guides = new THREE.Group();
    this.guides.add(new THREE.GridHelper(40, 40, c.grid, c.grid));
    for (const [dir, color] of [
      [[1, 0, 0], c.axisX], [[0, 1, 0], c.axisY], [[0, 0, 1], c.axisZ],
    ] as const)
      this.guides.add(new THREE.ArrowHelper(new THREE.Vector3(...dir), new THREE.Vector3(), 1.5, color, 0.3, 0.15));
    this.content.add(this.guides);

    const cube = new THREE.BoxGeometry(1, 1, 1);
    const ball = new THREE.SphereGeometry(0.5, 20, 14);
    const edgesOf = { box: new THREE.EdgesGeometry(cube), sphere: new THREE.EdgesGeometry(ball, 40) };
    for (const e of this.entities) {
      const isSelected = e.id === this.selected;
      const color = isSelected ? c.selection : (e.color ?? c.text);
      const body = e.shape === 'sphere' ? ball : cube;
      const edges = edgesOf[e.shape === 'sphere' ? 'sphere' : 'box'];
      const group = new THREE.Group();
      group.userData.entityId = e.id;
      group.position.set(...e.position);
      group.quaternion.set(...e.rotation);
      group.scale.set(...e.scale);
      group.add(
        new THREE.Mesh(body.clone(), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: isSelected ? 0.35 : 0.15 })),
        new THREE.LineSegments(edges.clone(), new THREE.LineBasicMaterial({ color })),
      );
      this.content.add(group);
    }
    const pin = new THREE.ConeGeometry(0.15, 0.4, 12);
    for (const p of this.players) {
      const m = new THREE.Mesh(pin.clone(), new THREE.MeshBasicMaterial({ color: p.self ? c.accent : c.axisX }));
      m.position.set(p.position[0], 0.2, p.position[2]);
      this.content.add(m);
    }
    pin.dispose();
    cube.dispose();
    ball.dispose();
    edgesOf.box.dispose();
    edgesOf.sphere.dispose();
  }
}
