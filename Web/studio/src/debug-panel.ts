// Debug area: Output (client logs and errors), Server (/debug stream), State (live ctx.state tree), Packets (USIS log with source).
// Each tab is its own dockable panel; they all read from one DebugStore so a re-created panel loses nothing.
import type { DebugEvent } from '@pear/cloud';
import type { UsisPacket } from '@pear/core';
import type { PanelView } from './layout';
import { announce, button, clock, el, packetHtml } from './ui';

export type Level = 'log' | 'warn' | 'error';
export interface OutputEntry { t: number; level: Level; text: string; script?: string }
export interface ServerRow { t: number; kind: string; player: string; detail: string; level: Level }
export interface PacketRow { id: number; packet: UsisPacket }
type Topic = 'output' | 'server' | 'state' | 'packets';

const MAX_ROWS = 1000;
const MAX_PACKETS = 500;

const json = (v: unknown): string => {
  try {
    return JSON.stringify(v) ?? 'undefined';
  } catch {
    return String(v);
  }
};

export class DebugStore {
  /** Set to the player name in a test-player tab, which cannot open the owner-only /debug stream. */
  testPlayer: string | null = null;
  output: OutputEntry[] = [];
  server: ServerRow[] = [];
  packets: PacketRow[] = [];
  /** Latest server `ctx.state`; the backend owns it, the Studio only displays it. */
  state: unknown = {};
  players = new Set<string>();
  serverVersion: number | null = null;
  serverConnected = false;
  /** State-tree expansion the user chose, by path; survives re-render. */
  readonly openPaths = new Map<string, boolean>();
  /** Called with each server script error message (the editor marks the script). */
  onServerError: (message: string) => void = () => {};
  private nextPacketId = 1;
  private listeners = new Map<Topic, Set<() => void>>();

  subscribe(topic: Topic, fn: () => void): () => void {
    const set = this.listeners.get(topic) ?? new Set();
    set.add(fn);
    this.listeners.set(topic, set);
    return () => set.delete(fn);
  }

  private emit(topic: Topic): void {
    for (const fn of this.listeners.get(topic) ?? []) fn();
  }

  addOutput(level: Level, text: string, script?: string): void {
    this.output.push({ t: Date.now(), level, text, script });
    if (this.output.length > MAX_ROWS) this.output.shift();
    this.emit('output');
  }

  addPacket(packet: UsisPacket): void {
    this.packets.push({ id: this.nextPacketId++, packet });
    if (this.packets.length > MAX_PACKETS) this.packets.shift();
    this.emit('packets');
  }

  /** The version Run on server just published; the /debug snapshot arrives before it is known. */
  setServerVersion(version: number): void {
    this.serverVersion = version;
    this.emit('server');
  }

  setServerConnected(connected: boolean): void {
    this.serverConnected = connected;
    if (!connected) {
      this.players.clear();
      this.serverVersion = null;
    }
    this.emit('server');
  }

  private addServer(row: ServerRow): void {
    this.server.push(row);
    if (this.server.length > MAX_ROWS) this.server.shift();
  }

  /** One `/debug` message: a snapshot first, then `join | leave | in | out | log | error | state | reload`. */
  handleDebugEvent(ev: DebugEvent): void {
    const t = typeof ev.t === 'number' ? ev.t : Date.now();
    const player = typeof ev.player === 'string' ? ev.player : '';
    const row = (kind: string, detail: string, level: Level = 'log', who = player) => this.addServer({ t, kind, player: who, detail, level });
    switch (ev.kind) {
      case 'snapshot':
        this.players = new Set((ev.players as string[] | undefined) ?? []);
        this.serverVersion = typeof ev.version === 'number' ? ev.version : this.serverVersion; // the backend may not know it yet; keep the published one
        this.state = ev.state ?? {};
        for (const l of (ev.logs as DebugEvent[] | undefined) ?? []) this.handleDebugEvent(l);
        row('snapshot', `version ${this.serverVersion ?? 'none'}, ${this.players.size} players`);
        this.emit('state');
        break;
      case 'join':
        this.players.add(player);
        row('join', 'joined');
        break;
      case 'leave':
        this.players.delete(player);
        row('leave', 'left');
        break;
      case 'in':
        row('in', `${String(ev.name)} ${json(ev.data)}`);
        break;
      case 'out':
        row('out', `${String(ev.name)} ${json(ev.data)}`, 'log', player || 'all players');
        break;
      case 'log':
        row('log', String(ev.msg), ev.level === 'warn' ? 'warn' : ev.level === 'error' ? 'error' : 'log');
        break;
      case 'error':
        row('error', String(ev.msg), 'error');
        this.onServerError(String(ev.msg));
        break;
      case 'state':
        this.state = ev.state ?? {};
        this.emit('state');
        return void this.emit('server');
      case 'reload':
        this.serverVersion = typeof ev.version === 'number' ? ev.version : this.serverVersion;
        this.state = {};
        row('reload', `server scripts restarted on version ${String(ev.version)}, ctx.state reset`);
        this.emit('state');
        break;
      default:
        return;
    }
    this.emit('server');
  }

  clear(topic: 'output' | 'server' | 'packets'): void {
    if (topic === 'output') this.output = [];
    else if (topic === 'server') this.server = [];
    else this.packets = [];
    this.emit(topic);
  }
}

export type ConsoleFilter = 'all' | 'client' | 'server' | 'errors';
export interface ConsoleRow { t: number; source: string; level: Level; text: string }

/** Client output and server rows merged in time order (output first on ties), then filtered. */
export function consoleRows(output: OutputEntry[], server: ServerRow[], filter: ConsoleFilter): ConsoleRow[] {
  const rows: ConsoleRow[] = [];
  if (filter !== 'server') for (const o of output) rows.push({ t: o.t, source: o.script ?? 'client', level: o.level, text: o.text });
  if (filter !== 'client') {
    for (const s of server) {
      const talk = s.kind === 'log' || s.kind === 'error';
      rows.push({ t: s.t, source: talk || !s.player ? 'server' : s.player, level: s.level, text: talk ? s.detail : `${s.kind}: ${s.detail}` });
    }
  }
  const sorted = rows.map((r, i) => [r, i] as const).sort((a, b) => a[0].t - b[0].t || a[1] - b[1]).map(([r]) => r);
  return filter === 'errors' ? sorted.filter((r) => r.level === 'error') : sorted;
}

const tableRow = (cells: (string | Node)[], cls = '') => el('tr', cls ? { class: cls } : {}, cells.map((c) => el('td', {}, [c])));
const STATE_KEY = 'pear.console.state';
const readState = (): boolean => {
  try {
    return localStorage.getItem(STATE_KEY) === '1';
  } catch {
    return false;
  }
};

export function createConsolePanel(store: DebugStore): PanelView {
  let filter: ConsoleFilter = 'all';
  let showState = readState();
  let advanced = false;
  let packets = false;
  const root = el('div', { class: 'pn pn-flex', role: 'region', 'aria-label': 'Console', tabindex: -1 });
  const group = el('div', { role: 'radiogroup', 'aria-label': 'Filter', style: 'display:flex;gap:4px' });
  const filters = (['all', 'client', 'server', 'errors'] as const).map((f) => {
    const b = button(f[0]!.toUpperCase() + f.slice(1), () => ((filter = f), render()), { variant: 'small' });
    b.setAttribute('role', 'radio');
    return [f, b] as const;
  });
  group.append(...filters.map(([, b]) => b));
  const toggle = (label: string, on: () => void) => {
    const b = button(label, on, { variant: 'small' });
    b.setAttribute('aria-pressed', 'false');
    return b;
  };
  const stateBtn = toggle('State', () => {
    showState = !showState;
    try {
      localStorage.setItem(STATE_KEY, showState ? '1' : '0');
    } catch { /* not remembered */ }
    render();
  });
  const packetsBtn = toggle('Packets', () => ((packets = !packets), render()));
  const advBtn = toggle('Advanced', () => ((advanced = !advanced), (packets &&= advanced), render()));
  const clearBtn = button('Clear', () => (packets ? store.clear('packets') : (store.clear('output'), store.clear('server'))), { variant: 'small' });
  const status = el('span', { class: 'om-secondary om-num' });
  root.append(el('div', { class: 'pn-bar' }, [group, stateBtn, advBtn, packetsBtn, clearBtn, status]));

  const scroller = el('div', { class: 'grow om-log-flat', tabindex: 0, role: 'region', 'aria-label': 'Console log' });
  const body = el('div', { class: 'grow', style: 'display:flex;min-height:0' });
  root.append(body);
  let side: PanelView | null = null;
  let pk: PanelView | null = null;

  const renderLog = () => {
    const stick = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 8;
    const items = consoleRows(store.output, store.server, filter);
    status.textContent = store.serverConnected ? `Server connected, version ${store.serverVersion ?? 'none'}, ${store.players.size} ${store.players.size === 1 ? 'player' : 'players'}` : 'Server not connected';
    if (!items.length) {
      scroller.replaceChildren(el('div', { class: 'pn-empty' }, [store.testPlayer ? `Only the game owner sees the server console. This tab is test player ${store.testPlayer}.` : 'Nothing here yet. Run the project to see script logs, errors and server events.']));
      return;
    }
    const table = el('table', {}, [
      el('thead', {}, [el('tr', {}, ['Time', 'Source', 'Level', 'Message'].map((h) => el('th', {}, [h])))]),
      el('tbody', {}, items.map((r) => tableRow([clock(r.t), r.source, r.level, r.text], r.level === 'error' ? 'is-error' : r.level === 'warn' ? 'is-warn' : ''))),
    ]);
    for (const td of table.querySelectorAll('td:last-child')) td.classList.add('msg');
    scroller.replaceChildren(table);
    if (stick) scroller.scrollTop = scroller.scrollHeight;
  };

  const render = () => {
    for (const [f, b] of filters) b.setAttribute('aria-checked', String(f === filter));
    stateBtn.setAttribute('aria-pressed', String(showState));
    advBtn.setAttribute('aria-pressed', String(advanced));
    packetsBtn.setAttribute('aria-pressed', String(packets));
    packetsBtn.hidden = !advanced;
    renderLog();
    if (packets && !pk) pk = packetsView(store);
    if (!packets && pk) (pk.dispose?.(), (pk = null));
    if (showState && !side) side = stateView(store);
    if (!showState && side) (side.dispose?.(), (side = null));
    const main = packets && pk ? pk.element : scroller;
    const wanted = [main, ...(side ? [side.element] : [])];
    if (body.children.length !== wanted.length || wanted.some((n, i) => body.children[i] !== n)) {
      main.style.flex = side ? '3 1 0' : '1 1 0';
      main.style.minWidth = '0';
      if (side) side.element.style.cssText = 'flex:2 1 0;min-width:0';
      body.replaceChildren(...wanted);
    }
  };
  const offs = [store.subscribe('output', renderLog), store.subscribe('server', renderLog)];
  render();
  return {
    element: root,
    focus: () => (packets && pk ? pk.focus?.() : scroller.focus()),
    dispose: () => (offs.forEach((o) => o()), pk?.dispose?.(), side?.dispose?.()),
  };
}


function jsonNode(store: DebugStore, key: string, value: unknown, path: string, depth: number): HTMLElement {
  const label = (k: string) => el('span', { class: 'k' }, [`${k}: `]);
  if (typeof value !== 'object' || value === null) return el('div', { class: 'leaf' }, [label(key), json(value)]);
  const entries = Object.entries(value);
  const details = el('details', {}, [
    el('summary', { 'data-path': path }, [label(key), el('span', { class: 'e' }, [Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`])]),
    ...entries.map(([k, v]) => jsonNode(store, k, v, `${path}.${k}`, depth + 1)),
  ]);
  details.open = store.openPaths.get(path) ?? depth < 2;
  details.addEventListener('toggle', () => store.openPaths.set(path, details.open));
  return details;
}

function stateView(store: DebugStore): PanelView {
  const root = el('div', { class: 'pn pn-flex', role: 'region', 'aria-label': 'State', tabindex: -1 });
  const tree = el('div', { class: 'grow json-tree', role: 'region', 'aria-label': 'ctx.state' });
  root.append(el('div', { class: 'pn-bar' }, [el('span', { class: 'om-secondary' }, ['Server ctx.state, read only'])]), tree);
  let shown = '';
  const render = () => {
    const state = store.state;
    const now = json(state);
    if (now === shown) return; // nothing changed: keep the DOM (and keyboard focus) as is
    shown = now;
    const focused = document.activeElement instanceof HTMLElement && tree.contains(document.activeElement) ? document.activeElement.dataset.path : undefined;
    const empty = typeof state !== 'object' || state === null || Object.keys(state).length === 0;
    tree.replaceChildren(empty ? el('div', { class: 'pn-empty' }, [store.testPlayer ? `Only the game owner sees ctx.state. This tab is test player ${store.testPlayer}.` : 'ctx.state is empty. Run on server and send a remote event to fill it.']) : jsonNode(store, 'ctx.state', state, 'state', 0));
    if (focused) tree.querySelector<HTMLElement>(`summary[data-path="${CSS.escape(focused)}"]`)?.focus();
  };
  const off = store.subscribe('state', render);
  render();
  return { element: root, focus: () => (tree.querySelector<HTMLElement>('summary') ?? root).focus(), dispose: off };
}

/** Keyboard on a packet row: arrows move the focus (roving), Enter and Space select the focused row. */
export function packetRowKey(ids: number[], current: number, key: string): { id: number; select: boolean } | null {
  const i = ids.indexOf(current);
  if (i < 0) return null;
  if (key === 'Enter' || key === ' ') return { id: current, select: true };
  const j = key === 'ArrowDown' ? i + 1 : key === 'ArrowUp' ? i - 1 : key === 'Home' ? 0 : key === 'End' ? ids.length - 1 : i;
  return j === i || j < 0 || j >= ids.length ? null : { id: ids[j]!, select: false };
}

function packetsView(store: DebugStore): PanelView {
  const root = el('div', { class: 'pn pn-flex', role: 'region', 'aria-label': 'Packets', tabindex: -1 });
  const filter = el('input', { placeholder: 'Filter by device or channel', 'aria-label': 'Filter packets' });
  let paused = false;
  let frozen: PacketRow[] = [];
  let selectedId: number | null = null;
  const pause = button('Pause', () => {
    paused = !paused;
    frozen = [...store.packets];
    pause.textContent = paused ? 'Resume' : 'Pause';
    pause.setAttribute('aria-pressed', String(paused));
    render();
  }, { variant: 'small' });
  pause.setAttribute('aria-pressed', 'false');
  const count = el('span', { class: 'om-secondary om-num' });
  root.append(el('div', { class: 'pn-bar' }, [pause, button('Clear', () => store.clear('packets'), { variant: 'small' }), el('label', { class: 'om-field om-filter', style: 'width:200px' }, [filter]), count]));
  const tbody = el('tbody');
  const detail = el('pre');
  const table = el('table', { role: 'grid', 'aria-label': 'Packets' }, [
    el('thead', {}, [el('tr', {}, ['Device time', 'Device', 'Source', 'Slot'].map((h) => el('th', {}, [h])).concat(['Seq', 'Channels', 'Size'].map((h, i) => el('th', i === 1 ? {} : { class: 'r' }, [h]))))]),
    tbody,
  ]);
  const tableScroll = el('div', { class: 'om-log-table' }, [table]);
  root.append(el('div', { class: 'grow om-log' }, [tableScroll, detail]));

  const select = (row: PacketRow | undefined) => {
    selectedId = row?.id ?? null;
    detail.innerHTML = row ? packetHtml(row.packet) : '';
    if (row) announce(`Packet seq ${row.packet.seq} from ${row.packet.deviceId} selected.`);
    tbody.querySelectorAll('tr').forEach((tr) => (tr.getAttribute('data-id') === String(selectedId) ? tr.setAttribute('aria-selected', 'true') : tr.removeAttribute('aria-selected')));
  };
  let source: PacketRow[] = [];
  let rovingId: number | null = null; // the one row in the tab order
  let held: PacketRow[] | null = null; // while a row is focused or selected the view holds, so that row stays in the last-100 window
  const render = () => {
    const active = document.activeElement;
    const refocus = active instanceof HTMLElement && tbody.contains(active) ? active.getAttribute('data-id') : null;
    held = refocus === null && selectedId === null ? null : held ?? [...store.packets];
    const q = filter.value.trim().toLowerCase();
    source = (paused ? frozen : held ?? store.packets).filter((r) => !q || r.packet.deviceId.toLowerCase().includes(q) || Object.keys(r.packet.ch ?? {}).join(' ').toLowerCase().includes(q)).slice(-100);
    count.textContent = `${store.packets.length} packets, ${source.length} shown${held && !paused ? ', held while a row is selected (Escape resumes)' : ''}`;
    if (!source.some((r) => r.id === rovingId)) rovingId = source.find((r) => r.id === selectedId)?.id ?? source[source.length - 1]?.id ?? null;
    tbody.replaceChildren(...source.map((r) => {
      const p = r.packet;
      const tr = el('tr', { tabindex: r.id === rovingId ? 0 : -1, 'data-id': r.id, ...(r.id === selectedId ? { 'aria-selected': 'true' } : {}) }, [
        `${p.t} ms`, p.deviceId, p.source, p.slot, String(p.seq), Object.keys(p.ch ?? {}).join(', '), `${json(p).length} B`,
      ].map((c, i) => el('td', i === 4 || i === 6 ? { class: 'r' } : {}, [c])));
      tr.addEventListener('click', () => select(r));
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          select(undefined);
          filter.focus();
          return render();
        }
        const key = packetRowKey(source.map((s) => s.id), r.id, e.key);
        if (!key) return;
        e.preventDefault();
        const target = source.find((s) => s.id === key.id);
        if (key.select) select(target);
        else {
          rovingId = key.id;
          tbody.querySelectorAll('tr').forEach((t) => (t.tabIndex = t.getAttribute('data-id') === String(rovingId) ? 0 : -1));
          tbody.querySelector<HTMLElement>(`tr[data-id="${key.id}"]`)?.focus();
        }
      });
      return tr;
    }));
    if (refocus) tbody.querySelector<HTMLElement>(`tr[data-id="${refocus}"]`)?.focus();
    if (!paused && !held) tableScroll.scrollTop = tableScroll.scrollHeight; // follow the newest packet until one is selected
  };
  // Packets arrive at 100+ per second; the table refreshes at 4 Hz.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (!paused && timer === undefined) timer = setTimeout(() => ((timer = undefined), render()), 250);
  };
  const off = store.subscribe('packets', schedule);
  filter.addEventListener('input', render);
  render();
  return { element: root, focus: () => filter.focus(), dispose: () => (off(), clearTimeout(timer)) };
}
