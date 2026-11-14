// Per-user settings, persisted in localStorage and applied as CSS variables / attributes on :root.
import { button, el, openSheet } from './ui';

export type Theme = 'dark' | 'light' | 'high-contrast';
export type MotionPreference = 'system' | 'on' | 'off';

export interface Preferences {
  /** 90 to 200 (percent). */
  uiScale: number;
  /** Editor font size in px, 10 to 32. */
  editorFontSize: number;
  theme: Theme;
  reducedMotion: MotionPreference;
  /** Draw the focus ring on every focus, not only keyboard focus. */
  focusRingAlways: boolean;
  /** Empty means same origin as the page. */
  serverUrl: string;
}

export const UI_SCALE_RANGE = [90, 200] as const;
export const EDITOR_FONT_RANGE = [10, 32] as const;
const STORAGE_KEY = 'omni.studio.preferences';

/** True inside the Tauri desktop shell (Windows serves it from http://tauri.localhost, macOS/Linux from tauri:). */
export const inDesktopApp = (): boolean =>
  typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || location.protocol === 'tauri:' || location.hostname === 'tauri.localhost');

/** Vite dev (port 5173) talks to the backend on 8080; the built Studio served by the backend uses its own origin; the desktop app's origin is not the backend. */
export function defaultServerUrl(): string {
  const web = typeof location !== 'undefined' && /^https?:$/.test(location.protocol);
  return web && !import.meta.env.DEV && !inDesktopApp() ? '' : 'http://localhost:8080';
}

export const defaultPreferences = (): Preferences => ({
  uiScale: 100, editorFontSize: 13, theme: 'dark', reducedMotion: 'system', focusRingAlways: false, serverUrl: defaultServerUrl(),
});

const clamp = (n: unknown, [lo, hi]: readonly [number, number], fallback: number): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback;

/** Validates stored JSON; anything unusable falls back to the default for that field. */
export function parsePreferences(raw: unknown): Preferences {
  const d = defaultPreferences();
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    uiScale: clamp(o.uiScale, UI_SCALE_RANGE, d.uiScale),
    editorFontSize: clamp(o.editorFontSize, EDITOR_FONT_RANGE, d.editorFontSize),
    theme: o.theme === 'light' || o.theme === 'high-contrast' || o.theme === 'dark' ? o.theme : d.theme,
    reducedMotion: o.reducedMotion === 'on' || o.reducedMotion === 'off' || o.reducedMotion === 'system' ? o.reducedMotion : d.reducedMotion,
    focusRingAlways: typeof o.focusRingAlways === 'boolean' ? o.focusRingAlways : d.focusRingAlways,
    serverUrl: typeof o.serverUrl === 'string' ? o.serverUrl.trim().replace(/\/+$/, '') : d.serverUrl,
  };
}

export class PreferenceStore {
  private value: Preferences;
  private listeners = new Set<(p: Preferences) => void>();

  constructor(private storage: Pick<Storage, 'getItem' | 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage) {
    let raw: unknown;
    try {
      raw = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null');
    } catch {
      raw = null;
    }
    this.value = parsePreferences(raw);
  }

  get(): Preferences {
    return this.value;
  }

  set(patch: Partial<Preferences>): void {
    this.value = parsePreferences({ ...this.value, ...patch });
    this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.value));
    for (const l of this.listeners) l(this.value);
  }

  onChange(listener: (p: Preferences) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/** Whether motion is reduced after applying the stored choice and the OS setting. */
export function motionReduced(p: Preferences, systemReduced: boolean): boolean {
  return p.reducedMotion === 'on' || (p.reducedMotion === 'system' && systemReduced);
}

export function applyPreferences(p: Preferences, root: HTMLElement = document.documentElement): void {
  root.style.setProperty('--ui-scale', String(p.uiScale / 100));
  root.style.setProperty('--editor-font-size', `${p.editorFontSize}px`);
  root.dataset.theme = p.theme;
  root.dataset.reducedMotion = String(motionReduced(p, window.matchMedia('(prefers-reduced-motion: reduce)').matches));
  root.dataset.focusRing = p.focusRingAlways ? 'always' : 'keyboard';
}

/** Applies now and again on every change and on an OS reduced-motion change. */
export function bindPreferences(store: PreferenceStore): void {
  const apply = () => applyPreferences(store.get());
  apply();
  store.onChange(apply);
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', apply);
}

export function openSettingsSheet(store: PreferenceStore): void {
  openSheet('Settings', (body, close) => {
    const p = store.get();
    const row = (label: string, control: HTMLElement) => el('div', { class: 'om-prop' }, [el('label', {}, [label]), control]);
    const field = (input: HTMLElement) => el('div', { class: 'om-field' }, [input]);
    const scale = el('input', { type: 'number', min: UI_SCALE_RANGE[0], max: UI_SCALE_RANGE[1], step: 10, value: p.uiScale, 'aria-label': 'UI scale percent' });
    const font = el('input', { type: 'number', min: EDITOR_FONT_RANGE[0], max: EDITOR_FONT_RANGE[1], step: 1, value: p.editorFontSize, 'aria-label': 'Editor font size in pixels' });
    const select = (label: string, value: string, options: [string, string][]) => {
      const s = el('select', { 'aria-label': label, class: 'om-select' }, options.map(([v, t]) => el('option', { value: v, selected: v === value }, [t])));
      return s;
    };
    const theme = select('Theme', p.theme, [['dark', 'Dark'], ['light', 'Light'], ['high-contrast', 'High contrast']]);
    const motion = select('Reduced motion', p.reducedMotion, [['system', 'Match system'], ['on', 'On'], ['off', 'Off']]);
    const focus = el('input', { type: 'checkbox', 'aria-label': 'Always show focus ring', checked: p.focusRingAlways });
    const server = el('input', { type: 'text', value: p.serverUrl, placeholder: 'Same origin as this page', 'aria-label': 'Server URL', spellcheck: 'false' });
    body.append(
      row('UI scale (%)', field(scale)), row('Editor font size (px)', field(font)), row('Theme', theme),
      row('Reduced motion', motion), row('Focus ring', el('label', { class: 'om-inline' }, [focus, 'Always show'])), row('Server URL', field(server)),
      el('p', { class: 'sheet-note' }, ['UI scale 90 to 200. Server URL empty uses the page origin. Changes apply immediately and are saved for this browser.']),
    );
    const apply = () => store.set({
      uiScale: Number(scale.value), editorFontSize: Number(font.value), theme: theme.value as Theme,
      reducedMotion: motion.value as MotionPreference, focusRingAlways: focus.checked, serverUrl: server.value,
    });
    for (const c of [scale, font, theme, motion, focus, server]) c.addEventListener('change', apply);
    body.append(el('div', { class: 'sheet-actions' }, [
      button('Reset to defaults', () => {
        store.set({ ...defaultPreferences() });
        close();
      }),
      button('Done', () => {
        apply();
        close();
      }, { variant: 'default' }),
    ]));
    scale.focus();
  });
}
