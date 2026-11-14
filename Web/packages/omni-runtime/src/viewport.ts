// three.js render of a scene: boxes for entities, floor grid, axis gizmo, selection outline, head-pose camera.
// Colors come from the brand-kit CSS custom properties (tokens.css), so theme switches reach the viewport.
import * as THREE from 'three';
import type { Pose } from '@omni/core';
import type { WorldEntity } from './scene';

export interface ViewportColors {
  viewport: string;
  grid: string;
  accent: string;
  text: string;
  axisX: string;
  axisY: string;
  axisZ: string;
}

/** Dark theme values of tokens.css, used when the page has not loaded the tokens. */
export const DARK_VIEWPORT_COLORS: ViewportColors = {
  viewport: '#3d3e43', grid: '#4c4d53', accent: '#4b93f8', text: '#e4e5e7',
  axisX: '#f0716b', axisY: '#7cc96a', axisZ: '#6aa7f0',
};

const TOKENS: Record<keyof ViewportColors, string> = {
  viewport: '--viewport', grid: '--viewport-grid', accent: '--accent', text: '--text',
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

const EDITOR_CAMERA_POSITION = new THREE.Vector3(0, 3, 6);
const EDITOR_CAMERA_TARGET = new THREE.Vector3(0, 1, -5);

export class Viewport {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(70, 1, 0.05, 200);
  private content = new THREE.Group();
  private entities: WorldEntity[] = [];
  private selected: string | null = null;

  constructor(canvas: HTMLCanvasElement, private colors: ViewportColors = readViewportColors()) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.scene.add(this.content);
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

  select(id: string | null): void {
    this.selected = id;
    this.rebuild();
  }

  /** Head pose drives the camera (-Z forward, like the schema). null returns to the fixed editor camera. */
  setHeadPose(pose: Pose | null): void {
    if (pose) {
      this.camera.position.set(...pose.position);
      this.camera.quaternion.set(...pose.orientation);
    } else {
      this.camera.position.copy(EDITOR_CAMERA_POSITION);
      this.camera.lookAt(EDITOR_CAMERA_TARGET);
    }
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
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

    const grid = new THREE.GridHelper(40, 40, c.grid, c.grid);
    this.content.add(grid);
    for (const [dir, color] of [
      [[1, 0, 0], c.axisX], [[0, 1, 0], c.axisY], [[0, 0, 1], c.axisZ],
    ] as const)
      this.content.add(new THREE.ArrowHelper(new THREE.Vector3(...dir), new THREE.Vector3(), 1.5, color, 0.3, 0.15));

    const cube = new THREE.BoxGeometry(1, 1, 1);
    const edges = new THREE.EdgesGeometry(cube);
    for (const e of this.entities) {
      const isSelected = e.id === this.selected;
      const color = isSelected ? c.accent : c.text;
      const group = new THREE.Group();
      group.position.set(...e.position);
      group.quaternion.set(...e.rotation);
      group.scale.set(...e.scale);
      group.add(
        new THREE.Mesh(cube.clone(), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: isSelected ? 0.35 : 0.15 })),
        new THREE.LineSegments(edges.clone(), new THREE.LineBasicMaterial({ color })),
      );
      this.content.add(group);
    }
    cube.dispose();
    edges.dispose();
  }
}
