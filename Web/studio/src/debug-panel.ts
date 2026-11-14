// Debug area: Output (client logs and errors), Server (/debug stream), State (live ctx.state tree), Packets (USIS log with source).
// Each tab is its own dockable panel; they all read from one DebugStore so a re-created panel loses nothing.
import type { DebugEvent } from '@omni/cloud';
import type { UsisPacket } from '@omni/core';
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

const tableRow = (cells: (string | Node)[], cls = '') => el('tr', cls ? { class: cls } : {}, cells.map((c) => el('td', {}, [c])));

function logPanel(label: string, store: DebugStore, topic: 'output' | 'server', head: string[], rows: () => { cells: (string | Node)[]; level: Level }[], bar: () => Node[]): PanelView {
  const root = el('div', { class: 'pn pn-flex', role: 'region', 'aria-label': label, tabindex: -1 });
  const barEl = el('div', { class: 'pn-bar' });
  const scroller = el('div', { class: 'grow om-log-flat', tabindex: 0, role: 'region', 'aria-label': `${label} log` });
  root.append(barEl, scroller);
  const render = () => {
    const stick = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 8;
    barEl.replaceChildren(...bar());
    const items = rows();
    if (!items.length) {
      scroller.replaceChildren(el('div', { class: 'pn-empty' }, [topic === 'output' ? 'No output yet. Run the project to see script logs and errors.' : 'No server events. Use Run on server to open a live session.']));
      return;
    }
    const table = el('table', {}, [
      el('thead', {}, [el('tr', {}, head.map((h) => el('th', {}, [h])))]),
      el('tbody', {}, items.map((r) => tableRow(r.cells, r.level === 'error' ? 'is-error' : r.level === 'warn' ? 'is-warn' : ''))),
    ]);
    for (const td of table.querySelectorAll('td:last-child')) td.classList.add('msg');
    scroller.replaceChildren(table);
    if (stick) scroller.scrollTop = scroller.scrollHeight;
  };
  const off = store.subscribe(topic, render);
  render();
  return { element: root, focus: () => scroller.focus(), dispose: off };
}

export function createOutputPanel(store: DebugStore): PanelView {
  return logPanel('Output', store, 'output', ['Time', 'Level', 'Script', 'Message'],
    () => store.output.map((o) => ({ level: o.level, cells: [clock(o.t), o.level, o.script ?? '', o.text] })),
    () => [button('Clear', () => store.clear('output'), { variant: 'small' }), el('span', { class: 'om-secondary' }, [`${store.output.length} lines`])]);
}

export function createServerPanel(store: DebugStore): PanelView {
  return logPanel('Server', store, 'server', ['Time', 'Event', 'Player', 'Detail'],
    () => store.server.map((s) => ({ level: s.level, cells: [clock(s.t), s.kind, s.player, s.detail] })),
    () => [
      button('Clear', () => store.clear('server'), { variant: 'small' }),
      el('span', { class: 'om-secondary om-num' }, [
        store.serverConnected ? `Connected, version ${store.serverVersion ?? 'none'}, ${store.players.size} ${store.players.size === 1 ? 'player' : 'players'}` : 'Not connected',
      ]),
    ]);
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

export function createStatePanel(store: DebugStore): PanelView {
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
    tree.replaceChildren(empty ? el('div', { class: 'pn-empty' }, ['ctx.state is empty. Run on server and send a remote event to fill it.']) : jsonNode(store, 'ctx.state', state, 'state', 0));
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

export function createPacketsPanel(store: DebugStore): PanelView {
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
