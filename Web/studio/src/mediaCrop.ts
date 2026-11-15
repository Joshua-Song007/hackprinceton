// Game media guidelines and pure crop math (no DOM). A crop is a rectangle in image space, every field a 0..1 fraction of the image.
export interface Crop { x: number; y: number; w: number; h: number }
export type Surface = 'card' | 'hero' | 'carousel' | 'web';

/** Where each image shows up and the aspect ratio (width / height) it is cropped to. */
export const SURFACES: { id: Surface; label: string; aspect: number }[] = [
  { id: 'card', label: 'Home card', aspect: 4 / 3 },
  { id: 'hero', label: 'Hero banner', aspect: 21 / 9 },
  { id: 'carousel', label: 'Detail carousel', aspect: 16 / 9 },
  { id: 'web', label: 'Web page', aspect: 3 / 2 },
];

export const MEDIA_TYPES = ['image/jpeg', 'image/png'];
export const MEDIA_MAX_BYTES = 10 * 1024 * 1024; // the server's per-asset limit
export const MEDIA_MIN_W = 1280;
export const MEDIA_MIN_H = 720;
export const CAROUSEL_MAX = 8;
/** Fraction of each edge that may be cut by a platform overlay; keep text and faces inside. */
export const SAFE_INSET = 0.05;
export const MAX_ZOOM = 4;

export const GUIDELINES = [
  'Photos of people playing, concept art or rules explainers; not in-game screenshots.',
  `JPEG or PNG, up to ${MEDIA_MAX_BYTES / 1024 / 1024} MB, at least ${MEDIA_MIN_W} x ${MEDIA_MIN_H} px.`,
  `Keep text and faces inside the dashed safe area (${SAFE_INSET * 100}% in from each edge); crops differ per surface.`,
  `One thumbnail plus up to ${CAROUSEL_MAX} carousel images.`,
];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Why an image cannot be used, or null when it can. */
export function mediaProblem(file: { type: string; size: number }, width: number, height: number): string | null {
  if (!MEDIA_TYPES.includes(file.type)) return 'Images must be JPEG or PNG.';
  if (file.size > MEDIA_MAX_BYTES) return `Images must be ${MEDIA_MAX_BYTES / 1024 / 1024} MB or smaller.`;
  if (width < MEDIA_MIN_W || height < MEDIA_MIN_H) return `Images must be at least ${MEDIA_MIN_W} x ${MEDIA_MIN_H} px (this one is ${width} x ${height}).`;
  return null;
}

/** The crop of the given aspect centered on (cx, cy), `zoom` (1..MAX_ZOOM) times tighter than the largest one that fits. */
export function cropRect(imgW: number, imgH: number, aspect: number, zoom = 1, cx = 0.5, cy = 0.5): Crop {
  const z = clamp(zoom, 1, MAX_ZOOM);
  const fullW = imgW / imgH > aspect ? (imgH * aspect) / imgW : 1;
  const fullH = imgW / imgH > aspect ? 1 : imgW / aspect / imgH;
  const w = fullW / z;
  const h = fullH / z;
  return { x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h), w, h };
}

/** Largest centered crop: what a surface gets until the developer adjusts it. */
export const autoCrop = (imgW: number, imgH: number, aspect: number): Crop => cropRect(imgW, imgH, aspect);

/** Zoom factor of a crop relative to the largest crop of that aspect. */
export function zoomOf(imgW: number, imgH: number, aspect: number, crop: Crop): number {
  return autoCrop(imgW, imgH, aspect).w / crop.w;
}

/** Moves a crop by a fraction of the image, staying inside it. */
export function moveCrop(crop: Crop, dx: number, dy: number): Crop {
  return { ...crop, x: clamp(crop.x + dx, 0, 1 - crop.w), y: clamp(crop.y + dy, 0, 1 - crop.h) };
}

/** Same center, new zoom. */
export function zoomCrop(imgW: number, imgH: number, aspect: number, crop: Crop, zoom: number): Crop {
  return cropRect(imgW, imgH, aspect, zoom, crop.x + crop.w / 2, crop.y + crop.h / 2);
}

/** CSS (percentages) that makes an <img> fill a box of the crop's aspect showing only the crop. The box needs overflow hidden and position relative. */
export function cropStyle(crop: Crop): { width: string; left: string; top: string } {
  return { width: `${100 / crop.w}%`, left: `${(-crop.x / crop.w) * 100}%`, top: `${(-crop.y / crop.h) * 100}%` };
}

/** Whether a stored crop is a usable rectangle inside the image. */
export const validCrop = (c: unknown): c is Crop => {
  const k = c as Crop;
  return !!k && [k.x, k.y, k.w, k.h].every((n) => typeof n === 'number' && Number.isFinite(n)) && k.w > 0 && k.h > 0 && k.x >= 0 && k.y >= 0 && k.x + k.w <= 1 + 1e-9 && k.y + k.h <= 1 + 1e-9;
};
