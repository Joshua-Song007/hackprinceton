// Developer-uploaded game media: thumbnail + carousel images, each with per-surface crops and a caption.
// Bytes go to the asset store (PUT /api/games/{id}/assets/{name}); the list and crops ride in the next version's `metadata.media`
// and the asset refs in its `assets`. Until the listing fields (#192) exist, that is the only home for crops.
// A draft is kept in localStorage per game so uploads made in About survive until the next publish.
import { ApiError, type CloudClient } from '@pear/cloud';
import { CAROUSEL_MAX, SURFACES, autoCrop, validCrop, type Crop, type Surface } from './mediaCrop';

export interface MediaItem {
  /** Asset name in the version's `assets`. */
  name: string;
  sha256: string;
  size: number;
  content_type: string;
  width: number;
  height: number;
  caption: string;
  crops: Record<Surface, Crop>;
}
export interface MediaDraft {
  thumbnail: MediaItem | null;
  carousel: MediaItem[];
  /** True when the draft has changes the latest published version does not carry. */
  dirty: boolean;
}
export const emptyDraft = (): MediaDraft => ({ thumbnail: null, carousel: [], dirty: false });

export const autoCrops = (w: number, h: number): Record<Surface, Crop> =>
  Object.fromEntries(SURFACES.map((s) => [s.id, autoCrop(w, h, s.aspect)])) as Record<Surface, Crop>;

const storageKey = (gameId: string) => `pear.media.${gameId}`;

/** Sentences naming what is still missing before the game page looks finished; empty when complete. */
export function missingMedia(draft: MediaDraft): string[] {
  const out: string[] = [];
  if (!draft.thumbnail) out.push('No thumbnail.');
  if (!draft.carousel.length) out.push('No carousel images.');
  return out;
}

const isItem = (v: unknown): v is MediaItem => {
  const m = v as MediaItem;
  return !!m && typeof m.name === 'string' && typeof m.sha256 === 'string' && m.width > 0 && m.height > 0 && !!m.crops && SURFACES.every((s) => validCrop(m.crops[s.id]));
};

/** Parses `metadata.media` (or a stored draft), dropping anything malformed. */
export function parseMedia(raw: unknown): MediaDraft {
  const m = (raw ?? {}) as { thumbnail?: unknown; carousel?: unknown };
  return {
    thumbnail: isItem(m.thumbnail) ? m.thumbnail : null,
    carousel: Array.isArray(m.carousel) ? m.carousel.filter(isItem).slice(0, CAROUSEL_MAX) : [],
    dirty: false,
  };
}

/** The `metadata.media` value for a version. */
export const mediaMetadata = (d: MediaDraft) => ({ thumbnail: d.thumbnail, carousel: d.carousel });

/** The `assets` entries the media needs, in the stored `{sha256,size,content_type}` form. */
export function mediaAssets(d: MediaDraft): Record<string, unknown> {
  const items = [...(d.thumbnail ? [d.thumbnail] : []), ...d.carousel];
  return Object.fromEntries(items.map((i) => [i.name, { sha256: i.sha256, size: i.size, content_type: i.content_type }]));
}

/** The saved draft when there is one, else the media the latest version carries, else empty. */
export async function loadDraft(client: CloudClient, gameId: string, storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): Promise<MediaDraft> {
  try {
    const saved = storage?.getItem(storageKey(gameId));
    if (saved) return { ...parseMedia(JSON.parse(saved)), dirty: true };
  } catch { /* unreadable draft: fall through to the published media */ }
  try {
    return parseMedia((await client.fetchVersion(gameId, 'latest')).metadata?.media);
  } catch (e) {
    if (e instanceof ApiError && e.kind === 'notFound') return emptyDraft();
    throw e;
  }
}

export function saveDraft(gameId: string, draft: MediaDraft, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void {
  try { storage?.setItem(storageKey(gameId), JSON.stringify(mediaMetadata(draft))); } catch { /* private mode: the draft lasts until reload */ }
}

/** After a publish carried the draft, it is no longer a draft. */
export function clearDraft(gameId: string, storage: Pick<Storage, 'removeItem'> | undefined = globalThis.localStorage): void {
  try { storage?.removeItem(storageKey(gameId)); } catch { /* nothing to clear */ }
}

/** A unique asset name for a new image, from the file's extension. */
export const assetName = (kind: 'thumb' | 'img', type: string, now = Date.now()): string => `media-${kind}-${now.toString(36)}.${type === 'image/png' ? 'png' : 'jpg'}`;

/** Uploads one image and returns its item with auto-centered crops for every surface. */
export async function uploadMedia(client: CloudClient, gameId: string, file: Blob, width: number, height: number, kind: 'thumb' | 'img'): Promise<MediaItem> {
  const name = assetName(kind, file.type);
  const stored = await client.uploadAsset(gameId, name, file);
  return { name, sha256: stored.sha256, size: stored.size, content_type: stored.content_type, width, height, caption: '', crops: autoCrops(width, height) };
}
