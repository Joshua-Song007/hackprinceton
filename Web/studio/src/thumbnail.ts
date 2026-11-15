// Project previews for the projects screen: one shared offscreen Viewport renders a scene to a small JPEG.
// Browsers cap live WebGL contexts, so there is never one per card; renders are queued one at a time.
import { Viewport, flattenScene, parseScene, readViewportColors } from '@pear/runtime';
import type { SceneJson } from './project';

export const THUMB_WIDTH = 480;
export const THUMB_HEIGHT = 300;

let shared: Viewport | undefined;
let unavailable = false;

/** A JPEG data URL of the scene, or undefined when it does not parse or WebGL (or a DOM) is missing. */
export function renderThumbnail(scene: SceneJson): string | undefined {
  if (unavailable) return undefined;
  try {
    const entities = flattenScene(parseScene(scene));
    try {
      shared ??= new Viewport(document.createElement('canvas'));
    } catch {
      unavailable = true; // no WebGL: stop retrying on every card
      return undefined;
    }
    shared.setColors(readViewportColors());
    shared.setScene(entities);
    return shared.snapshot(THUMB_WIDTH, THUMB_HEIGHT);
  } catch {
    return undefined;
  }
}

/** Runs async work one task at a time; `cancel()` drops everything not yet finished (the screen was redrawn). */
export class ThumbnailQueue {
  private chain: Promise<void> = Promise.resolve();
  private generation = 0;

  cancel(): void {
    this.generation++;
  }

  add<T>(work: () => Promise<T>, done: (value: T) => void): void {
    const mine = this.generation;
    this.chain = this.chain.then(async () => {
      if (mine !== this.generation) return;
      try {
        const value = await work();
        if (mine === this.generation) done(value);
      } catch { /* the placeholder stays: never published, offline, or no WebGL */ }
    });
  }
}
