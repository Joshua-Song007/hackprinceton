// Media section of the Game About sheet: guidelines, thumbnail + carousel upload, captions, per-surface crop previews with drag and zoom.
import type { CloudClient } from '@pear/cloud';
import { CAROUSEL_MAX, GUIDELINES, MAX_ZOOM, SAFE_INSET, SURFACES, autoCrop, cropStyle, mediaProblem, moveCrop, zoomCrop, zoomOf, type Surface } from './mediaCrop';
import { loadDraft, saveDraft, uploadMedia, type MediaDraft, type MediaItem } from './mediaDraft';
import { announce, button, el } from './ui';

/** A box of `aspect` showing only the item's crop for `surface`; `safe` overlays the dashed safe area. */
function cropBox(client: CloudClient, item: MediaItem, surface: Surface, width: string, safe = false): HTMLElement {
  const aspect = SURFACES.find((s) => s.id === surface)!.aspect;
  const img = el('img', { src: client.assetUrl(item.sha256), alt: '', draggable: 'false' });
  const s = cropStyle(item.crops[surface]);
  img.style.cssText = `position:absolute;display:block;max-width:none;width:${s.width};left:${s.left};top:${s.top}`;
  const box = el('div', { class: 'media-crop', style: `position:relative;overflow:hidden;width:${width};aspect-ratio:${aspect};background:var(--viewport);border:1px solid var(--line);border-radius:var(--radius-control)` }, [img]);
  if (safe) box.append(el('div', { style: `position:absolute;inset:${SAFE_INSET * 100}%;border:1px dashed #fff;pointer-events:none;mix-blend-mode:difference` }));
  return box;
}

export async function mountMediaEditor(parent: HTMLElement, client: CloudClient, gameId: string, onError: (e: unknown) => void, onStatus: (s: string) => void): Promise<void> {
  const root = el('div', { class: 'om-prop om-prop--vec' });
  parent.append(root);
  let draft: MediaDraft;
  try { draft = await loadDraft(client, gameId); } catch (e) { onError(e); return; }
  let selected: { item: MediaItem; surface: Surface } | null = null;

  const changed = () => { draft.dirty = true; saveDraft(gameId, draft); render(); };
  const pick = async (kind: 'thumb' | 'img') => {
    const input = el('input', { type: 'file', accept: 'image/jpeg,image/png' });
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const bmp = await createImageBitmap(f);
        const problem = mediaProblem(f, bmp.width, bmp.height);
        if (problem) { onError(new Error(problem)); announce(problem); return; }
        const item = await uploadMedia(client, gameId, f, bmp.width, bmp.height, kind);
        if (kind === 'thumb') draft.thumbnail = item; else draft.carousel.push(item);
        selected = { item, surface: 'card' };
        onStatus('Image uploaded. It is published with the next version.');
        changed();
      } catch (e) { onError(e); }
    });
    input.click();
  };

  const editor = (item: MediaItem, surface: Surface) => {
    const aspect = SURFACES.find((s) => s.id === surface)!.aspect;
    const main = cropBox(client, item, surface, '100%', true);
    main.style.cursor = 'grab';
    main.style.touchAction = 'none';
    let last: { x: number; y: number } | null = null;
    main.addEventListener('pointerdown', (e) => { last = { x: e.clientX, y: e.clientY }; main.setPointerCapture(e.pointerId); });
    main.addEventListener('pointerup', () => { last = null; changed(); });
    main.addEventListener('pointermove', (e) => {
      if (!last) return;
      const r = main.getBoundingClientRect();
      const c = item.crops[surface];
      // dragging the picture right moves the window left; a pixel of the box is c.w / r.width of the image
      item.crops[surface] = moveCrop(c, (-(e.clientX - last.x) / r.width) * c.w, (-(e.clientY - last.y) / r.height) * c.h);
      last = { x: e.clientX, y: e.clientY };
      const img = main.querySelector('img')!;
      const s = cropStyle(item.crops[surface]);
      img.style.left = s.left; img.style.top = s.top;
    });
    const zoom = el('input', { type: 'range', min: '1', max: String(MAX_ZOOM), step: '0.05', value: String(zoomOf(item.width, item.height, aspect, item.crops[surface])), 'aria-label': `Zoom for ${surface} crop` });
    zoom.addEventListener('input', () => { item.crops[surface] = zoomCrop(item.width, item.height, aspect, item.crops[surface], Number(zoom.value)); changed(); });
    const reset = button('Reset to auto', () => { item.crops[surface] = autoCrop(item.width, item.height, aspect); changed(); }, { variant: 'small' });
    return el('div', { style: 'display:grid;gap:6px;max-width:420px' }, [main, el('label', {}, ['Zoom ', zoom]), reset, el('span', { class: 'om-secondary' }, ['Drag the picture to reposition. Dashed line = safe area.'])]);
  };

  const row = (item: MediaItem, label: string, remove: () => void) => {
    const caption = el('input', { type: 'text', value: item.caption, 'aria-label': `Caption for ${label}`, placeholder: 'Caption (optional)', maxlength: '140' });
    caption.addEventListener('change', () => { item.caption = caption.value; changed(); });
    const previews = SURFACES.map((s) => {
      const b = el('button', { type: 'button', class: 'om-btn om-btn--borderless', 'aria-label': `Edit ${s.label} crop of ${label}`, 'aria-pressed': String(selected?.item === item && selected.surface === s.id), style: 'display:grid;gap:2px;justify-items:center;padding:2px' }, [cropBox(client, item, s.id, '96px'), el('span', { class: 'om-secondary' }, [s.label])]);
      b.addEventListener('click', () => { selected = { item, surface: s.id }; render(); });
      return b;
    });
    return el('div', { class: 'om-prop om-prop--vec', 'data-media': item.name }, [
      el('strong', {}, [label]),
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, previews),
      ...(selected?.item === item ? [editor(item, selected.surface)] : []),
      caption,
      button('Remove', remove, { variant: 'small', danger: true }),
    ]);
  };

  function render() {
    root.replaceChildren(
      el('span', {}, ['Game media']),
      el('ul', { class: 'pn-list', 'aria-label': 'Media guidelines' }, GUIDELINES.map((g) => el('li', {}, [g]))),
      ...(draft.thumbnail ? [row(draft.thumbnail, 'Thumbnail', () => { draft.thumbnail = null; selected = null; changed(); })] : []),
      button(draft.thumbnail ? 'Replace thumbnail' : 'Add thumbnail', () => void pick('thumb'), { variant: 'small' }),
      ...draft.carousel.map((it, i) => row(it, `Carousel image ${i + 1}`, () => { draft.carousel.splice(i, 1); selected = null; changed(); })),
      ...(draft.carousel.length < CAROUSEL_MAX ? [button('Add carousel image', () => void pick('img'), { variant: 'small' })] : []),
    );
  }
  render();
}

