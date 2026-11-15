import { describe, expect, it } from 'vitest';
import { CloudClient, type GameVersion } from '@pear/cloud';
import { MAX_ZOOM, SURFACES, autoCrop, cropRect, cropStyle, mediaProblem, moveCrop, validCrop, zoomCrop, zoomOf } from '../src/mediaCrop';
import { assetName, autoCrops, clearDraft, emptyDraft, loadDraft, mediaAssets, missingMedia, parseMedia, saveDraft, uploadMedia } from '../src/mediaDraft';

const json = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('crop math', () => {
  it('auto crop is the largest centered rectangle of the aspect', () => {
    const c = autoCrop(2000, 1000, 1); // wide image, square surface
    expect(c).toEqual({ x: 0.25, y: 0, w: 0.5, h: 1 });
    const t = autoCrop(1000, 2000, 2); // tall image, 2:1 surface
    expect(t.w).toBe(1);
    expect(t.h).toBeCloseTo(0.25);
    expect(t.y).toBeCloseTo(0.375);
  });
  it('every auto crop has the surface aspect in pixels', () => {
    for (const s of SURFACES) {
      const c = autoCrop(1920, 1080, s.aspect);
      expect((c.w * 1920) / (c.h * 1080)).toBeCloseTo(s.aspect);
      expect(validCrop(c)).toBe(true);
    }
  });
  it('zoom shrinks about the center, clamped to 1..MAX_ZOOM, and zoomOf inverts it', () => {
    const base = autoCrop(1920, 1080, 16 / 9);
    const z = zoomCrop(1920, 1080, 16 / 9, base, 2);
    expect(z.w).toBeCloseTo(0.5);
    expect(zoomOf(1920, 1080, 16 / 9, z)).toBeCloseTo(2);
    expect(cropRect(1920, 1080, 16 / 9, 99).w).toBeCloseTo(1 / MAX_ZOOM);
    expect(cropRect(1920, 1080, 16 / 9, 0.1).w).toBe(1);
  });
  it('moving never leaves the image', () => {
    const c = cropRect(2000, 1000, 1, 2);
    expect(moveCrop(c, -5, -5)).toMatchObject({ x: 0, y: 0 });
    const far = moveCrop(c, 5, 5);
    expect(far.x + far.w).toBeCloseTo(1);
    expect(far.y + far.h).toBeCloseTo(1);
  });
  it('cropStyle maps a crop to percentages', () => {
    expect(cropStyle({ x: 0.25, y: 0, w: 0.5, h: 1 })).toEqual({ width: '200%', left: '-50%', top: '0%' });
  });
  it('validCrop rejects malformed rectangles', () => {
    expect(validCrop({ x: 0.5, y: 0, w: 0.6, h: 1 })).toBe(false);
    expect(validCrop({ x: 0, y: 0, w: 0, h: 1 })).toBe(false);
    expect(validCrop(null)).toBe(false);
  });
});

describe('guidelines', () => {
  it('accepts a big jpeg and names each problem', () => {
    expect(mediaProblem({ type: 'image/jpeg', size: 1000 }, 1920, 1080)).toBeNull();
    expect(mediaProblem({ type: 'image/gif', size: 1000 }, 1920, 1080)).toMatch(/JPEG or PNG/);
    expect(mediaProblem({ type: 'image/png', size: 11 * 1024 * 1024 }, 1920, 1080)).toMatch(/10 MB/);
    expect(mediaProblem({ type: 'image/png', size: 1000 }, 800, 600)).toMatch(/1280 x 720/);
  });
});

describe('media draft', () => {
  const item = (name: string) => ({ name, sha256: 'a'.repeat(64), size: 5, content_type: 'image/png', width: 1920, height: 1080, caption: 'c', crops: autoCrops(1920, 1080) });
  it('reports what is missing', () => {
    expect(missingMedia(emptyDraft())).toEqual(['No thumbnail.', 'No carousel images.']);
    expect(missingMedia({ thumbnail: item('t.png'), carousel: [item('a.png')], dirty: false })).toEqual([]);
  });
  it('parseMedia drops malformed items', () => {
    const d = parseMedia({ thumbnail: { name: 'x' }, carousel: [item('a.png'), { nope: 1 }] });
    expect(d.thumbnail).toBeNull();
    expect(d.carousel.map((i) => i.name)).toEqual(['a.png']);
  });
  it('mediaAssets uses the stored ref form', () => {
    expect(mediaAssets({ thumbnail: item('t.png'), carousel: [], dirty: true })).toEqual({ 't.png': { sha256: 'a'.repeat(64), size: 5, content_type: 'image/png' } });
  });
  it('asset names satisfy the server pattern', () => {
    expect(assetName('thumb', 'image/jpeg', 1234)).toMatch(/^[A-Za-z0-9._-]{1,128}$/);
    expect(assetName('img', 'image/png').endsWith('.png')).toBe(true);
  });
  it('prefers a saved draft, else the latest version, else empty', async () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
    const latest = { metadata: { media: { thumbnail: item('pub.png'), carousel: [] } } } as unknown as GameVersion;
    const client = new CloudClient({ baseUrl: 'http://s', token: 't', fetch: (async (input: string) => (input.endsWith('/versions/latest') ? json(200, latest) : json(404))) as typeof fetch });
    expect((await loadDraft(client, 'g', store)).thumbnail?.name).toBe('pub.png');
    saveDraft('g', { thumbnail: item('mine.png'), carousel: [], dirty: true }, store);
    const d = await loadDraft(client, 'g', store);
    expect(d.thumbnail?.name).toBe('mine.png');
    expect(d.dirty).toBe(true);
    clearDraft('g', store);
    expect((await loadDraft(client, 'g', store)).thumbnail?.name).toBe('pub.png');
    const none = new CloudClient({ baseUrl: 'http://s', token: 't', fetch: (async () => json(404)) as typeof fetch });
    expect(await loadDraft(none, 'g2', store)).toEqual(emptyDraft());
  });
  it('uploadMedia PUTs the raw image and returns an item with auto crops', async () => {
    let seen: { method?: string; path?: string; type?: string } = {};
    const client = new CloudClient({ baseUrl: 'http://s', token: 't', fetch: (async (input: string, init: RequestInit) => {
      seen = { method: init.method, path: new URL(input).pathname, type: (init.headers as Record<string, string>)['Content-Type'] };
      return json(200, { name: 'n', sha256: 'b'.repeat(64), size: 3, content_type: 'image/png' });
    }) as typeof fetch });
    const it = await uploadMedia(client, 'g1', new Blob(['abc'], { type: 'image/png' }), 1920, 1080, 'thumb');
    expect(seen.method).toBe('PUT');
    expect(seen.path).toMatch(/^\/api\/games\/g1\/assets\/media-thumb-.*\.png$/);
    expect(seen.type).toBe('image/png');
    expect(it.sha256).toBe('b'.repeat(64));
    expect(Object.keys(it.crops).sort()).toEqual(SURFACES.map((s) => s.id).sort());
  });
});
