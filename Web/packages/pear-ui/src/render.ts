import { evalExpr, interpolate, truthy } from './expr';
import type { Node, OutAction, PearUI, ViewState } from './types';

/** Picks the screen id: first route whose `when` is truthy, else the last (default) entry. */
export function pickScreen(ui: PearUI, state: ViewState): string | undefined {
  for (const r of ui.route) if (r.when === undefined || truthy(evalExpr(state, r.when))) return r.screen;
  return undefined;
}

export interface Hooks {
  /** Called once per mounted sensor node; return a stop function. The host feeds `emit` with readings. */
  sensor?(node: Node, emit: (data: unknown) => void): (() => void) | void;
  /** Called when an effect node's `on` value changes. */
  effect?(node: Node): void;
}

const CSS = `
.pui{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Helvetica Neue",sans-serif;color:#f5f5f7;background:#000;
  height:100%;box-sizing:border-box;display:flex;flex-direction:column;overflow:auto;-webkit-font-smoothing:antialiased}
.pui *{box-sizing:border-box}
.pui-col{display:flex;flex-direction:column;gap:12px}.pui-row{display:flex;flex-direction:row;gap:12px;align-items:center}
.pui-stack{display:grid}.pui-stack>*{grid-area:1/1}
.pui-grow{flex:1 1 auto}.pui-a-start{align-items:flex-start;text-align:left}.pui-a-center{align-items:center;text-align:center;justify-content:center}
.pui-a-end{align-items:flex-end;text-align:right}
.pui-text{margin:0;line-height:1.2}.pui-s{font-size:13px;color:#a1a1a6}.pui-m{font-size:17px}.pui-l{font-size:24px;font-weight:600}
.pui-xl{font-size:36px;font-weight:700}.pui-huge{font-size:72px;font-weight:800;letter-spacing:-.02em}
.pui-btn{font:inherit;font-size:17px;font-weight:600;border:0;border-radius:14px;padding:14px 20px;background:#2c2c2e;color:#f5f5f7;cursor:pointer;min-height:50px}
.pui-btn:active{opacity:.7}
.t-accent{color:#0a84ff}.t-good{color:#30d158}.t-bad{color:#ff453a}.t-warn{color:#ffd60a}
.pui-btn.t-accent{background:#0a84ff;color:#fff}.pui-btn.t-good{background:#30d158;color:#000}.pui-btn.t-bad{background:#ff453a;color:#fff}.pui-btn.t-warn{background:#ffd60a;color:#000}
.pui-gauge{height:10px;border-radius:5px;background:#2c2c2e;overflow:hidden;width:100%}.pui-gauge>div{height:100%;background:#0a84ff}
.pui-list{display:flex;flex-direction:column;gap:8px;list-style:none;margin:0;padding:0}
.pui-map{border-radius:14px;background:#1c1c1e;padding:10px;font-size:13px;min-height:120px}
.pui-img{max-width:100%;border-radius:12px}
`;

let cssInjected = false;
function injectCss(doc: Document) {
  if (cssInjected || !doc.head) return;
  const s = doc.createElement('style');
  s.textContent = CSS;
  doc.head.appendChild(s);
  cssInjected = true;
}

const str = (v: unknown): string => (v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/**
 * Renders `ui` into `el` and re-renders on `update`. Re-render is a full rebuild of the active screen (screens are
 * small); sensors keep running across updates and stop on destroy or when their node disappears.
 * `assetUrl` maps an asset name (image src) to a URL.
 */
export function mount(
  el: HTMLElement,
  ui: PearUI,
  state: ViewState,
  onAction: (a: OutAction) => void,
  hooks: Hooks = {},
  assetUrl: (name: string) => string = (n) => n,
): { update(state: ViewState): void; destroy(): void } {
  const doc = el.ownerDocument;
  injectCss(doc);
  const root = doc.createElement('div');
  root.className = 'pui';
  el.appendChild(root);
  const sensors = new Map<string, () => void>();
  const effects = new Map<string, unknown>();
  const timers: ReturnType<typeof setInterval>[] = [];
  let current = state;

  function cls(n: Node, base: string): string {
    const s = n.style ?? {};
    return [base, s.size ? `pui-${s.size}` : '', s.tone && s.tone !== 'neutral' ? `t-${s.tone}` : '', s.grow ? 'pui-grow' : '', s.align ? `pui-a-${s.align}` : '']
      .filter(Boolean).join(' ');
  }

  function build(n: Node, scope: ViewState, path: string, seen: Set<string>): HTMLElement | null {
    if (n.if !== undefined && !truthy(evalExpr(scope, n.if))) return null;
    const pad = n.style?.pad;
    const box = (tag: string, base: string) => {
      const e = doc.createElement(tag);
      e.className = cls(n, base);
      if (pad) e.style.padding = `${pad * 8}px`;
      return e;
    };
    const kids = (e: HTMLElement) => n.children?.forEach((c, i) => { const k = build(c, scope, `${path}.${i}`, seen); if (k) e.appendChild(k); });
    switch (n.type) {
      case 'column': { const e = box('div', 'pui-col'); kids(e); return e; }
      case 'row': { const e = box('div', 'pui-row'); kids(e); return e; }
      case 'stack': { const e = box('div', 'pui-stack'); kids(e); return e; }
      case 'spacer': { const e = box('div', 'pui-grow'); e.style.flex = '1 1 auto'; return e; }
      case 'text': { const e = box('p', 'pui-text pui-m'); e.textContent = str(interpolate(scope, n.value)); return e; }
      case 'button': {
        const e = box('button', 'pui-btn') as HTMLButtonElement;
        e.type = 'button';
        e.textContent = str(interpolate(scope, n.label));
        e.addEventListener('click', () => {
          const a = n.action;
          if (!a) return;
          if ('send' in a) onAction({ name: a.send, data: interpolate(scope, a.data ?? {}) });
          else onAction({ set: a.set, value: interpolate(scope, a.value) });
        });
        return e;
      }
      case 'image': { const e = box('img', 'pui-img') as HTMLImageElement; e.src = assetUrl(str(interpolate(scope, n.src))); e.alt = ''; return e; }
      case 'gauge': {
        const e = box('div', 'pui-gauge');
        const bar = doc.createElement('div');
        const v = Number(interpolate(scope, n.value)) || 0;
        bar.style.width = `${Math.max(0, Math.min(1, v)) * 100}%`;
        e.appendChild(bar);
        return e;
      }
      case 'timer': {
        const e = box('p', 'pui-text pui-xl');
        const until = Number(interpolate(scope, n.until));
        const tick = () => { e.textContent = Number.isFinite(until) ? String(Math.max(0, Math.ceil((until - Date.now()) / 1000))) : ''; };
        tick();
        timers.push(setInterval(tick, 200));
        return e;
      }
      case 'list': {
        const e = box('ul', 'pui-list');
        const items = interpolate(scope, n.items ? `{{${n.items}}}` : undefined);
        if (Array.isArray(items) && n.item) {
          items.forEach((it, i) => {
            const li = doc.createElement('li');
            const k = build(n.item!, { ...scope, item: it }, `${path}.i${i}`, seen);
            if (k) { li.appendChild(k); e.appendChild(li); }
          });
        }
        return e;
      }
      case 'map': {
        const e = box('div', 'pui-map');
        e.dataset.puiMap = '1';
        const markers = interpolate(scope, n.markers ? `{{${n.markers}}}` : undefined);
        e.textContent = Array.isArray(markers) && markers.length
          ? markers.map((m: any) => `● ${m.label ?? ''} ${Number(m.lat).toFixed(5)}, ${Number(m.lng).toFixed(5)}`).join('\n')
          : 'Map: no markers';
        e.style.whiteSpace = 'pre-line';
        return e;
      }
      case 'sensor': {
        const key = n.id ?? path;
        seen.add(key);
        if (!sensors.has(key) && hooks.sensor && n.event) {
          const event = n.event;
          const stop = hooks.sensor(n, (data) => onAction({ name: event, data }));
          sensors.set(key, stop ?? (() => {}));
        }
        return null;
      }
      case 'effect': {
        const key = n.id ?? path;
        const v = n.on === undefined ? undefined : evalExpr(scope, n.on);
        const prev = effects.get(key);
        if (effects.has(key) && JSON.stringify(prev) !== JSON.stringify(v)) hooks.effect?.(n);
        effects.set(key, v);
        return null;
      }
      default:
        return null; // unknown types render nothing (forward compatible)
    }
  }

  function render() {
    timers.splice(0).forEach(clearInterval);
    root.replaceChildren();
    const id = pickScreen(ui, current);
    const screen = id ? ui.screens[id] : undefined;
    const seen = new Set<string>();
    if (screen) { const e = build(screen, current, id!, seen); if (e) { e.classList.add('pui-grow'); root.appendChild(e); } }
    for (const [k, stop] of sensors) if (!seen.has(k)) { stop(); sensors.delete(k); }
  }

  render();
  return {
    update(s) { current = s; render(); },
    destroy() { timers.forEach(clearInterval); sensors.forEach((stop) => stop()); sensors.clear(); root.remove(); },
  };
}
