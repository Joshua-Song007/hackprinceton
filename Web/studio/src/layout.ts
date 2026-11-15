// Docking layout manager on dockview-core. Panel ids are stable strings, so saved layouts survive upgrades.
// Mouse: drag tabs to dock, split or tab; drag sashes to resize; close with the tab's x.
// Keyboard: F6 / Shift+F6 cycle panels, arrow keys on a focused splitter resize it (Shift = larger step),
// Ctrl+Alt+arrows move the active panel into the neighbour as a tab, Ctrl+Alt+Shift+arrows split it beside the neighbour,
// Alt+PageUp/PageDown switch tabs, Ctrl+Alt+M maximizes, Ctrl+Alt+C collapses or expands the active panel's group.
import { createDockview, type DockviewApi, type DockviewGroupPanel, type IDockviewPanel, type SerializedDockview } from 'dockview-core';
import { announce, openMenu, type MenuItem } from './ui';

export interface PanelView {
  element: HTMLElement;
  /** Move keyboard focus into the panel. Falls back to the first focusable element, then the element itself. */
  focus?(): void;
  dispose?(): void;
}

export interface PanelSpec {
  id: string;
  title: string;
  create(): PanelView;
}

export const PRESETS = [
  { id: 'default', label: 'Default' },
  { id: 'script-focus', label: 'Script focus' },
  { id: 'debug-focus', label: 'Debug focus' },
] as const;
export type PresetId = (typeof PRESETS)[number]['id'];

export interface LayoutHooks {
  /** Desktop shell: open a panel in its own OS window. Absent in the browser, so the menu item is hidden. */
  popOut?(panelId: string): void;
}

const CURRENT_KEY = 'pear.studio.layout.current';
const NAMED_KEY = 'pear.studio.layouts';
/** Panels added after layouts were first saved: each is offered once as a tab beside `beside`, so an old saved layout does not hide it for good. */
const ADDED_PANELS: readonly { id: string; beside: string }[] = [{ id: 'peripherals', beside: 'explorer' }];
const OFFERED_KEY = 'pear.studio.layout.offered';
const SASH_STEP = 16;
const COLLAPSED_SIZE = 28;
type Direction = 'left' | 'right' | 'top' | 'bottom';
const ARROWS: Record<string, Direction> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'top', ArrowDown: 'bottom' };

/** The added panels to offer now: never offered before, not open, registered, and with their neighbour open. */
export function panelsToOffer(
  openIds: readonly string[], offered: readonly string[], specIds: readonly string[], added: readonly { id: string; beside: string }[] = ADDED_PANELS,
): { id: string; beside: string }[] {
  return added.filter((a) => !offered.includes(a.id) && !openIds.includes(a.id) && specIds.includes(a.id) && openIds.includes(a.beside));
}

/** The panel set of the old default layout (3D viewport centre). A saved layout with exactly these is migrated to the new default. */
const LEGACY_DEFAULT = ['console', 'editor', 'explorer', 'inspector', 'peripherals', 'test', 'viewport'];
export const isLegacyDefault = (ids: readonly string[]): boolean => [...ids].sort().join() === LEGACY_DEFAULT.join();

/** True when a screen-mode scene has a visible entity, so the 3D viewport is worth opening by itself. */
export function wants3D(scene: { runMode?: string; entities: { scale: readonly number[]; children: readonly unknown[] }[] }): boolean {
  const hidden = (e: { scale: readonly number[]; children: readonly unknown[] }): boolean => e.scale.every((s) => s === 0) && (e.children as typeof scene.entities).every(hidden);
  return scene.runMode === 'screen' && scene.entities.some((e) => !hidden(e));
}

export class LayoutManager {
  readonly api: DockviewApi;
  private specs = new Map<string, PanelSpec>();
  private views = new Map<string, PanelView>();
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private restoring = false;
  private collapsed = new Map<string, { width: number; height: number; minimumWidth: number; minimumHeight: number }>();

  constructor(
    private host: HTMLElement,
    panels: PanelSpec[],
    private hooks: LayoutHooks = {},
    private storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
  ) {
    for (const p of panels) this.specs.set(p.id, p);
    this.api = createDockview(host, {
      theme: { name: 'pear', className: 'dockview-theme-pear' },
      disableFloatingGroups: true,
      createComponent: ({ id, name }) => {
        const view = this.specs.get(name)!.create();
        this.views.set(id, view);
        return {
          element: view.element,
          init: () => {},
          dispose: () => {
            view.dispose?.();
            this.views.delete(id);
          },
        };
      },
    });
    this.api.onDidAddGroup((group) => this.constrainGroup(group));
    this.api.onDidAddPanel((panel) => this.constrainGroup(panel.group));
    this.api.onDidActivePanelChange((panel) => { if (panel) this.constrainGroup(panel.group); });
    this.api.onDidLayoutChange(() => {
      if (this.restoring) return;
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => this.storage.setItem(CURRENT_KEY, JSON.stringify(this.api.toJSON())), 300);
    });
    document.addEventListener('keydown', (e) => this.onKey(e));
    this.makeSashesKeyboardReachable();
  }

  /** Restores the last layout, or builds the default one. A saved layout naming an unknown panel is discarded. */
  start(): void {
    const saved = this.storage.getItem(CURRENT_KEY);
    if (saved && !this.isLegacySaved(saved) && this.tryLoad(saved)) return void this.offerAddedPanels();
    this.applyPreset('default');
  }

  /** The saved current layout is the untouched old default: drop it so the non-3D default applies (named layouts are never migrated). */
  private isLegacySaved(json: string): boolean {
    try {
      const ids = Object.values((JSON.parse(json) as SerializedDockview).panels ?? {}).map((p) => (p as { contentComponent?: string }).contentComponent ?? '');
      return this.specs.has('livePreview') && isLegacyDefault(ids);
    } catch {
      return false;
    }
  }

  private offered(): string[] {
    try {
      const saved = JSON.parse(this.storage.getItem(OFFERED_KEY) ?? '[]') as unknown;
      return Array.isArray(saved) ? saved.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  private markOffered(ids: readonly string[]): void {
    try {
      this.storage.setItem(OFFERED_KEY, JSON.stringify([...new Set([...this.offered(), ...ids])]));
    } catch { /* not remembered: the panel may be offered again */ }
  }

  /** A restored layout saved before an added panel existed gets that panel once, as an inactive tab. */
  private offerAddedPanels(): void {
    const due = panelsToOffer(this.api.panels.map((p) => p.id), this.offered(), [...this.specs.keys()]);
    this.restoring = true;
    try {
      for (const a of due) this.add(a.id, { referencePanel: a.beside, direction: 'within' }, {}, true);
    } finally {
      this.restoring = false;
    }
    this.markOffered(ADDED_PANELS.map((a) => a.id));
    if (due.length) this.storage.setItem(CURRENT_KEY, JSON.stringify(this.api.toJSON()));
  }

  private tryLoad(json: string): boolean {
    const previous = this.api.toJSON();
    this.restoring = true;
    clearTimeout(this.saveTimer);
    try {
      const data = JSON.parse(json) as SerializedDockview;
      const ids = Object.values(data.panels ?? {}).map((p) => (p as { contentComponent?: string }).contentComponent);
      if (ids.some((id) => !id || !this.specs.has(id))) return false;
      // A layout missing a core panel (e.g. only the viewport left open) strands a creator; start from the default instead.
      if (!ids.length) return false;
      this.api.fromJSON(data);
      this.collapsed.clear();
      return true;
    } catch {
      this.api.fromJSON(previous);
      return false;
    } finally {
      this.restoring = false;
      this.storage.setItem(CURRENT_KEY, JSON.stringify(this.api.toJSON()));
    }
  }

  private constrainGroup(group: DockviewGroupPanel): void {
    if (this.collapsed.has(group.id)) return;
    const ids = group.panels.map((p) => p.id);
    const primary = ids.some((id) => id === 'editor' || id === 'livePreview' || id === 'viewport');
    group.api.setConstraints({ minimumWidth: primary ? 280 : 180, minimumHeight: primary ? 220 : ids.includes('inspector') ? 180 : 100 });
  }

  private add(id: string, position?: { referencePanel?: string; direction?: 'left' | 'right' | 'above' | 'below' | 'within' }, size: { initialWidth?: number; initialHeight?: number } = {}, inactive = false) {
    const spec = this.specs.get(id)!;
    this.api.addPanel({ id, component: id, title: spec.title, inactive, ...(position ? { position: position as never } : {}), ...size });
  }

  applyPreset(preset: PresetId): void {
    this.restoring = true;
    clearTimeout(this.saveTimer);
    this.collapsed.clear();
    this.api.clear();
    this.api.layout(this.host.clientWidth, this.host.clientHeight); // sizes below need a measured dock
    const b = this.add.bind(this);
    let sizes: Record<string, { width?: number; height?: number }> = {};
    if (preset === 'script-focus') {
      b('editor');
      b('explorer', { referencePanel: 'editor', direction: 'left' });
      b('peripherals', { referencePanel: 'explorer', direction: 'within' }, {}, true);
      b('test', { referencePanel: 'explorer', direction: 'within' }, {}, true);
      b('viewport', { referencePanel: 'editor', direction: 'right' });
      b('inspector', { referencePanel: 'viewport', direction: 'below' });
      b('console', { direction: 'below' } as never);
      sizes = { explorer: { width: 200 }, viewport: { width: 360 }, inspector: { height: 200 }, console: { height: 140 } };
    } else if (preset === 'debug-focus') {
      b('viewport');
      b('editor', { referencePanel: 'viewport', direction: 'within' }, {}, true);
      b('explorer', { referencePanel: 'viewport', direction: 'left' });
      b('peripherals', { referencePanel: 'explorer', direction: 'within' }, {}, true);
      b('test', { referencePanel: 'explorer', direction: 'within' }, {}, true);
      b('inspector', { referencePanel: 'viewport', direction: 'right' });
      b('console', { direction: 'below' } as never);
      sizes = { explorer: { width: 200 }, inspector: { width: 240 }, console: { height: 360 } };
    } else {
      // Pear is outdoor mixed reality: Live Preview (device frames + GPS map) is the centre, the 3D viewport is opt-in (View menu).
      b('livePreview');
      b('editor', { referencePanel: 'livePreview', direction: 'within' }, {}, true);
      b('explorer', { referencePanel: 'livePreview', direction: 'left' });
      b('peripherals', { referencePanel: 'explorer', direction: 'within' }, {}, true);
      b('test', { referencePanel: 'explorer', direction: 'within' }, {}, true);
      const compact = this.host.clientHeight < 700 || this.host.clientWidth < 1100;
      b('inspector', { referencePanel: compact ? 'explorer' : 'livePreview', direction: compact ? 'within' : 'below' }, {}, compact);
      b('console', compact ? { referencePanel: 'livePreview', direction: 'within' } : { direction: 'below' }, {}, compact);
      sizes = { explorer: { width: 220 }, inspector: compact ? {} : { height: 220 }, console: compact ? {} : { height: 140 } };
    }
    // The panel that holds the rest keeps its size; sidebars, inspector and debug area get theirs.
    for (const [id, size] of Object.entries(sizes)) this.api.getPanel(id)?.api.setSize(size);
    for (const group of this.api.groups) this.constrainGroup(group);
    if (this.api.getPanel('console')?.group !== this.api.getPanel('livePreview')?.group) this.api.getPanel('console')?.api.setActive();
    this.api.getPanel(preset === 'default' ? 'livePreview' : 'viewport')?.api.setActive();
    this.restoring = false;
    this.markOffered(ADDED_PANELS.map((a) => a.id)); // the presets already include them
    this.storage.setItem(CURRENT_KEY, JSON.stringify(this.api.toJSON()));
  }

  reset(): void {
    this.applyPreset('default');
  }

  // Named layouts
  private named(): Record<string, SerializedDockview> {
    try {
      const saved: unknown = JSON.parse(this.storage.getItem(NAMED_KEY) ?? '{}');
      return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved as Record<string, SerializedDockview> : {};
    } catch {
      return {};
    }
  }

  namedLayouts(): string[] {
    return Object.keys(this.named()).sort();
  }

  saveNamed(name: string): void {
    this.storage.setItem(NAMED_KEY, JSON.stringify({ ...this.named(), [name]: this.api.toJSON() }));
  }

  loadNamed(name: string): boolean {
    const layout = this.named()[name];
    return layout ? this.tryLoad(JSON.stringify(layout)) : false;
  }

  deleteNamed(name: string): void {
    const all = this.named();
    delete all[name];
    this.storage.setItem(NAMED_KEY, JSON.stringify(all));
  }

  // Panels
  panelSpecs(): PanelSpec[] {
    return [...this.specs.values()];
  }

  isOpen(id: string): boolean {
    return !!this.api.getPanel(id);
  }

  /** Adds a panel after construction (plugins). Re-registering an id replaces its spec. */
  register(spec: PanelSpec): void {
    this.specs.set(spec.id, spec);
  }

  /** Closes a registered panel and forgets it, so it leaves the Window menu and saved layouts stop naming it. */
  unregister(id: string): void {
    this.api.getPanel(id)?.api.close();
    this.specs.delete(id);
  }

  /** Shows a panel docked to the right of the viewport (a tab in the active group when there is no viewport). */
  openRight(id: string): void {
    if (!this.isOpen(id)) {
      if (this.api.getPanel('viewport')) this.add(id, { referencePanel: 'viewport', direction: 'right' }, { initialWidth: 360 });
      else this.togglePanel(id);
    }
    this.api.getPanel(id)?.api.setActive();
  }

  /** Shows a closed panel as a tab in the active group, or closes an open one. */
  togglePanel(id: string): void {
    const open = this.api.getPanel(id);
    if (open) return open.api.close();
    const group = this.api.activeGroup;
    this.add(id, group ? ({ referenceGroup: group.id } as never) : undefined);
  }

  /** Shows (opening it if closed) and activates a panel. */
  show(id: string): void {
    if (!this.isOpen(id)) this.togglePanel(id);
    this.api.getPanel(id)?.api.setActive();
  }

  focusPanel(id: string): void {
    this.show(id);
    this.focusInto(id);
  }

  private focusInto(id: string, quiet = false): void {
    const view = this.views.get(id);
    if (!view) return;
    if (view.focus) view.focus();
    else (view.element.querySelector<HTMLElement>('input, button, [tabindex="0"], textarea, select') ?? view.element).focus();
    if (!quiet) announce(`${this.specs.get(id)?.title ?? id} panel`);
  }

  /** F6: next group in reading order (top to bottom, left to right), wrapping. */
  cycleFocus(delta: 1 | -1): void {
    const groups = [...this.api.groups].sort((a, b) => {
      const ra = a.element.getBoundingClientRect();
      const rb = b.element.getBoundingClientRect();
      return Math.round(ra.top / 8) - Math.round(rb.top / 8) || ra.left - rb.left;
    });
    if (!groups.length) return;
    const current = groups.findIndex((g) => g.element.contains(document.activeElement));
    const from = current >= 0 ? current : groups.findIndex((g) => g === this.api.activeGroup);
    const next = groups[(from + delta + groups.length) % groups.length]!;
    const panel = next.activePanel;
    if (!panel) return;
    panel.api.setActive();
    this.focusInto(panel.id);
  }

  private neighbour(from: HTMLElement, direction: Direction): DockviewGroupPanel | undefined {
    const r = from.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let best: { score: number; group: DockviewGroupPanel } | undefined;
    for (const g of this.api.groups) {
      if (g.element === from) continue;
      const o = g.element.getBoundingClientRect();
      const dx = o.left + o.width / 2 - cx;
      const dy = o.top + o.height / 2 - cy;
      const ok = direction === 'left' ? dx < 0 : direction === 'right' ? dx > 0 : direction === 'top' ? dy < 0 : dy > 0;
      const score = Math.hypot(dx, dy);
      if (ok && (!best || score < best.score)) best = { score, group: g };
    }
    return best?.group;
  }

  /** Moves a panel into the neighbouring group in `direction`, or splits it out to that side when there is none. */
  movePanel(panel: IDockviewPanel, direction: Direction, split = false): void {
    const target = this.neighbour(panel.group.element, direction);
    if (target) panel.api.moveTo({ group: target, position: split ? direction : 'center' });
    else if (panel.group.panels.length > 1) panel.api.moveTo({ group: panel.group, position: direction });
    announce(`${panel.title ?? panel.id} moved ${direction}`);
    this.focusInto(panel.id, true); // the move announcement is the one to hear
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'F6') {
      e.preventDefault();
      this.cycleFocus(e.shiftKey ? -1 : 1);
      return;
    }
    const sash = (e.target as HTMLElement).closest?.('.dv-sash');
    if (sash && e.key in ARROWS && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      this.nudgeSash(sash as HTMLElement, ARROWS[e.key]!, e.shiftKey ? SASH_STEP * 4 : SASH_STEP);
      return;
    }
    const tab = (e.target as HTMLElement).closest?.('.dv-tab');
    if (tab && !e.ctrlKey && !e.altKey && !e.metaKey && (e.key === 'Enter' || e.key === ' ' || e.key === 'Delete')) {
      const group = this.api.groups.find((g) => g.element.contains(tab));
      const target = group?.panels[[...group.element.querySelectorAll('.dv-tab')].indexOf(tab)];
      if (!target) return;
      e.preventDefault();
      if (e.key === 'Delete') {
        announce(`Closed ${target.title ?? target.id}`);
        target.api.close();
      } else {
        target.api.setActive();
        this.focusInto(target.id);
      }
      return;
    }
    const panel = this.api.activePanel;
    if (!panel) return;
    if (e.ctrlKey && e.altKey && e.key in ARROWS) {
      e.preventDefault();
      this.movePanel(panel, ARROWS[e.key]!, e.shiftKey);
    } else if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      this.toggleCollapse();
    } else if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'm') {
      e.preventDefault();
      this.toggleMaximize();
    } else if (e.altKey && !e.ctrlKey && (e.key === 'PageUp' || e.key === 'PageDown')) {
      e.preventDefault();
      const tabs = panel.group.panels;
      const next = tabs[(tabs.indexOf(panel) + (e.key === 'PageDown' ? 1 : -1) + tabs.length) % tabs.length];
      next?.api.setActive();
      if (next) this.focusInto(next.id);
    }
  }

  /** Shrinks the active panel's group to its minimum size (dockview clamps it), or restores the size it had. */
  toggleCollapse(): void {
    const group = this.api.activePanel?.group;
    if (!group) return;
    const before = this.collapsed.get(group.id);
    if (before) {
      group.api.setConstraints({ minimumWidth: before.minimumWidth, minimumHeight: before.minimumHeight });
      group.api.setSize(before);
      this.collapsed.delete(group.id);
    } else {
      this.collapsed.set(group.id, { width: group.width, height: group.height, minimumWidth: group.minimumWidth, minimumHeight: group.minimumHeight });
      group.api.setConstraints({ minimumWidth: COLLAPSED_SIZE, minimumHeight: COLLAPSED_SIZE }); // dockview's default minimum is 100px
      group.api.setSize({ width: COLLAPSED_SIZE, height: COLLAPSED_SIZE });
    }
    announce(before ? 'Panel expanded' : 'Panel collapsed');
  }

  toggleMaximize(): void {
    const panel = this.api.activePanel;
    if (this.api.hasMaximizedGroup()) this.api.exitMaximizedGroup();
    else if (panel) this.api.maximizeGroup(panel);
  }

  /** Dockview sashes only take pointer input, so a synthetic drag of `delta` px moves the real splitter. */
  private nudgeSash(sash: HTMLElement, direction: Direction, step: number): void {
    const horizontal = sash.closest('.dv-split-view-container')?.classList.contains('dv-horizontal') ?? true;
    if (horizontal !== (direction === 'left' || direction === 'right')) return;
    const r = sash.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const delta = direction === 'left' || direction === 'top' ? -step : step;
    const init = (cx: number, cy: number) => ({ clientX: cx, clientY: cy, pointerId: 1, bubbles: true, cancelable: true });
    sash.dispatchEvent(new PointerEvent('pointerdown', init(x, y)));
    document.dispatchEvent(new PointerEvent('pointermove', init(horizontal ? x + delta : x, horizontal ? y : y + delta)));
    document.dispatchEvent(new PointerEvent('pointerup', init(x, y)));
  }

  private makeSashesKeyboardReachable(): void {
    const mark = () => {
      this.host.querySelectorAll<HTMLElement>('.dv-tab').forEach((t) => {
        t.setAttribute('role', 'tab');
        t.setAttribute('aria-selected', String(t.classList.contains('dv-active-tab')));
        // The x is mouse-only; Delete on the focused tab closes it, so hide the x from assistive tech.
        t.querySelector('.dv-default-tab-action')?.setAttribute('aria-hidden', 'true');
      });
      this.host.querySelectorAll<HTMLElement>('.dv-sash:not([tabindex])').forEach((s) => {
        const horizontal = s.closest('.dv-split-view-container')?.classList.contains('dv-horizontal') ?? true;
        s.tabIndex = 0;
        s.setAttribute('role', 'separator');
        s.setAttribute('aria-orientation', horizontal ? 'vertical' : 'horizontal');
        s.setAttribute('aria-label', horizontal ? 'Resize panels, use left and right arrow keys' : 'Resize panels, use up and down arrow keys');
      });
    };
    new MutationObserver(mark).observe(this.host, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    mark();
  }

  /** Items for the toolbar's Window menu. */
  menuItems(onSaveAs: () => void, onDelete: (name: string) => void): MenuItem[] {
    const items: MenuItem[] = [{ heading: true, label: 'Panels' }];
    for (const spec of this.specs.values()) items.push({ label: spec.title, checked: this.isOpen(spec.id), run: () => this.togglePanel(spec.id) });
    items.push({ separator: true }, { heading: true, label: 'Layouts' });
    for (const p of PRESETS) items.push({ label: p.label, run: () => this.applyPreset(p.id) });
    for (const name of this.namedLayouts()) items.push({ label: name, run: () => this.loadNamed(name) });
    items.push({ label: 'Save layout as...', run: onSaveAs });
    for (const name of this.namedLayouts()) items.push({ label: `Delete layout ${name}`, run: () => onDelete(name) });
    items.push({ label: 'Reset layout', run: () => this.reset() }, { separator: true });
    const activeGroup = this.api.activePanel?.group;
    items.push({ label: activeGroup && this.collapsed.has(activeGroup.id) ? 'Expand panel (Ctrl+Alt+C)' : 'Collapse panel (Ctrl+Alt+C)', run: () => this.toggleCollapse() });
    items.push({ label: this.api.hasMaximizedGroup() ? 'Restore panel size' : 'Maximize active panel', run: () => this.toggleMaximize() });
    const active = this.api.activePanel;
    if (this.hooks.popOut && active) items.push({ label: `Pop out ${active.title ?? active.id}`, run: () => this.hooks.popOut?.(active.id) });
    return items;
  }

  openMenu(anchor: HTMLElement, onSaveAs: () => void, onDelete: (name: string) => void): void {
    openMenu(anchor, this.menuItems(onSaveAs, onDelete));
  }
}
