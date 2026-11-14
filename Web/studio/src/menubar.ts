// Application menu bar (File, Edit, View, Run, Help). Menus are built on open so labels and disabled states are current.
import { el, openMenu, rovingToolbar, type MenuItem } from './ui';

export interface MenuDef {
  label: string;
  items: () => MenuItem[];
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
/** "Ctrl+S" on Windows and Linux, "Cmd+S" on macOS. */
export const mod = (keys: string): string => (isMac ? keys.replace(/^Ctrl\+/, 'Cmd+') : keys);

export interface Shortcut {
  /** KeyboardEvent.key, compared lowercase. */
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  /** Runs unless the key was meant for a text field or the script editor. */
  run: () => void;
  /** Still runs while a text field or the script editor has focus (save, run). */
  inText?: boolean;
}

export function matches(s: Shortcut, e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>): boolean {
  return e.key.toLowerCase() === s.key && (e.ctrlKey || e.metaKey) === !!s.ctrl && e.shiftKey === !!s.shift && !e.altKey;
}

const inTextTarget = (t: EventTarget | null) => t instanceof Element && !!t.closest('input, textarea, select, .cm-editor, [contenteditable="true"]');

/** One window listener for the whole table; the editor keeps its own undo, so text-focused keys skip entries without `inText`. */
export function installShortcuts(shortcuts: Shortcut[]): void {
  window.addEventListener('keydown', (e) => {
    const s = shortcuts.find((x) => matches(x, e));
    if (!s || (!s.inText && inTextTarget(e.target))) return;
    e.preventDefault();
    s.run();
  });
}

export function mountMenuBar(bar: HTMLElement, menus: MenuDef[]): void {
  for (const m of menus) {
    const b = el('button', { type: 'button', class: 'om-menubar-item', role: 'menuitem', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, [m.label]) as HTMLButtonElement;
    b.addEventListener('click', () => openMenu(b, m.items()));
    // Alt+Down / Down on a focused title also opens, as native menu bars do.
    b.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      openMenu(b, m.items());
    });
    bar.append(b);
  }
  rovingToolbar(bar);
}
