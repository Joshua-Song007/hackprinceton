// Live Preview panel: an iPhone and an iPad frame for the open cloud game (each its own dev device in one lobby), a GPS map of the
// devices and a terminal of /debug plus per-device frames. Menu: View > Live Preview.
import type { DebugEvent, ReconnectingSocket } from '@pear/cloud';
import { mount, validate, type Hooks, type Node, type PearUI } from '@pear/ui';
import type { AccountController } from '../account';
import type { PanelSpec, PanelView } from '../layout';
import { button, el } from '../ui';
import { debugRow, normalizeLobby, randomLobby, sensorHz, sysRow, type LogRow, type PreviewKind } from './helpers';
import { DEFAULT_CENTER, PreviewMap, type LatLng } from './map';
import { DeviceSession } from './session';
import { PreviewTerminal } from './terminal';
import './livePreview.css';

interface DeviceSpec { id: string; name: string; kind: PreviewKind; label: string; color: string; offset: LatLng }
const DEVICES: DeviceSpec[] = [
  { id: 'iphone', name: 'Preview iPhone', kind: 'phone', label: 'iPhone', color: '#0a84ff', offset: { lat: 0.0002, lng: -0.0002 } },
  { id: 'ipad', name: 'Preview iPad', kind: 'ipad', label: 'iPad', color: '#ff9f0a', offset: { lat: -0.0002, lng: 0.0002 } },
];

interface Device {
  spec: DeviceSpec;
  session: DeviceSession;
  screen: HTMLElement;
  status: HTMLElement;
  slider: HTMLInputElement;
  sliderValue: HTMLElement;
  handle: ReturnType<typeof mount> | null;
  uiRef: unknown;
  pitch: number;
  motion: number;
  locEvent: string | null;
  raf: number;
}

export const livePreviewPanel = (account: AccountController): PanelSpec => ({ id: 'livePreview', title: 'Live Preview', create: () => createLivePreviewPanel(account) });

/** Lobby hand-off from the Lobbies panel: picks the game, then the panel (open or about to open) connects to this lobby. */
let pendingLobby: string | null = null;
let handoff: (() => void) | null = null;
export function openInLivePreview(account: AccountController, gameId: string, lobby: string): void {
  pendingLobby = lobby;
  if (account.gameId !== gameId) account.select(gameId);
  else handoff?.();
}

/** Rows from outside the panel (the New game from prompt agent stream): buffered until a panel is open, then shown in its terminal. */
let terminalSink: ((row: Omit<LogRow, 'id'>) => void) | null = null;
const buffered: Omit<LogRow, 'id'>[] = [];
export function logToLivePreview(row: Omit<LogRow, 'id'>): void {
  if (terminalSink) terminalSink(row);
  else buffered.push(row);
}

export function createLivePreviewPanel(account: AccountController): PanelView {
  const root = el('div', { class: 'lp-root' });
  const terminal = new PreviewTerminal();
  terminalSink = (row) => terminal.add(row);
  buffered.splice(0).forEach((row) => terminal.add(row));
  const map = new PreviewMap((id, at) => {
    const d = devices.find((x) => x.spec.id === id);
    d?.session.send(d.locEvent ?? 'location', { lat: at.lat, lng: at.lng, acc: 5 });
  });
  DEVICES.forEach((s) => map.addDevice(s.id, s.label, s.color, { lat: DEFAULT_CENTER.lat + s.offset.lat, lng: DEFAULT_CENTER.lng + s.offset.lng }));

  const takePending = () => {
    const l = pendingLobby && normalizeLobby(pendingLobby);
    pendingLobby = null;
    if (l) lobbyInput.value = l;
  };
  const lobbyInput = el('input', { type: 'text', class: 'lp-lobby', value: randomLobby(), maxlength: 12, 'aria-label': 'Lobby code', spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const statusEl = el('span', { class: 'lp-status', role: 'status' });
  const connectBtn = button('Connect', () => connect());
  const newCode = button('New code', () => {
    lobbyInput.value = randomLobby();
    connect();
  }, { variant: 'small' });
  lobbyInput.addEventListener('keydown', (e) => e.key === 'Enter' && connect());
  // A ui.json from disk previews an unpublished UI (versions are published by the orchestrator, not from here).
  const filePick = el('input', { type: 'file', accept: '.json,application/json', hidden: true, 'aria-label': 'Choose a local ui.json' }) as HTMLInputElement;
  const localBtn = button('Local ui.json…', () => (localUi ? useLocal(null) : filePick.click()), { variant: 'small' });
  filePick.addEventListener('change', async () => {
    const f = filePick.files?.[0];
    filePick.value = '';
    if (!f) return;
    try {
      const ui = JSON.parse(await f.text()) as unknown;
      const problems = validate(ui);
      if (problems.length) throw new Error(problems[0]);
      useLocal(ui as PearUI);
    } catch (e) {
      terminal.add(sysRow('preview', `${f.name} is not a valid ui.json: ${e instanceof Error ? e.message : String(e)}`, 'error'));
    }
  });
  function useLocal(ui: PearUI | null): void {
    localUi = ui;
    localBtn.textContent = ui ? 'Use hosted ui.json' : 'Local ui.json…';
    devices.forEach((d) => {
      d.session.localUi = ui;
      void d.session.loadUi();
    });
  }
  const toolbar = el('div', { class: 'lp-toolbar' }, [el('label', { class: 'lp-lobby-label' }, ['Lobby ', lobbyInput]), newCode, connectBtn, localBtn, filePick, statusEl]);
  const devicesEl = el('div', { class: 'lp-devices' });
  const side = el('div', { class: 'lp-side' }, [el('div', { class: 'lp-map-wrap' }, [map.element]), terminal.element]);
  const body = el('div', { class: 'lp-body' }, [devicesEl, side]);
  root.append(toolbar, body);

  let devices: Device[] = [];
  let localUi: PearUI | null = null;
  let debugSocket: ReconnectingSocket<DebugEvent> | null = null;
  let debugTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const base = () => account.serverUrl || globalThis.location?.origin || '';
  const gameTitle = () => account.game?.title ?? account.gameId ?? '';

  function teardown(): void {
    for (const d of devices) {
      cancelAnimationFrame(d.raf);
      d.handle?.destroy();
      d.session.dispose();
    }
    devices = [];
    devicesEl.replaceChildren();
    debugSocket?.close();
    debugSocket = null;
    if (debugTimer) clearTimeout(debugTimer);
  }

  function setStatus(): void {
    if (!account.gameId) return void (statusEl.textContent = 'No cloud game open.');
    const open = devices.filter((d) => d.session.status === 'open').length;
    statusEl.textContent = `${gameTitle()} · ${open}/${devices.length} devices connected`;
  }

  function emptyState(text: string, detail?: string): HTMLElement {
    return el('div', { class: 'lp-empty-ui' }, [el('strong', {}, [text]), ...(detail ? [el('p', {}, [detail])] : [])]);
  }

  function renderDevice(d: Device): void {
    const s = d.session;
    d.status.textContent = s.status === 'open' ? 'Connected' : s.status === 'failed' ? 'Sign-in failed' : s.status === 'idle' ? 'Idle' : 'Connecting…';
    d.status.dataset.state = s.status;
    d.slider.disabled = d.motion === 0;
    const ui = s.uiState;
    if (ui.kind === 'ready') {
      if (d.uiRef !== ui.ui) {
        d.handle?.destroy();
        d.screen.replaceChildren();
        d.motion = 0;
        d.locEvent = null;
        d.handle = mount(d.screen, ui.ui, s.state, (a) => s.act(a), hooksFor(d), s.assetUrl);
        d.uiRef = ui.ui;
      } else d.handle?.update(s.state);
    } else if (d.uiRef !== ui.kind) {
      d.handle?.destroy();
      d.handle = null;
      d.motion = 0;
      d.locEvent = null;
      d.uiRef = ui.kind;
      d.screen.replaceChildren(ui.kind === 'loading'
        ? emptyState('Loading the game UI…')
        : emptyState('No ui.json for this game yet', `${ui.reason} Publish a version with one and press Connect, or try a file with Local ui.json….`));
    }
    if (s.position) map.setPosition(d.spec.id, s.position);
    setStatus();
  }

  const schedule = (d: Device) => {
    if (d.raf) return;
    d.raf = requestAnimationFrame(() => {
      d.raf = 0;
      if (!disposed) renderDevice(d);
    });
  };

  /** Motion streams the slider's pitch at the node's hz; location streams the device's map marker (1 Hz unless the node says). */
  function hooksFor(d: Device): Hooks {
    return {
      sensor(node: Node, emit) {
        if (node.kind === 'motion') {
          d.motion++;
          d.slider.disabled = false;
          const t = setInterval(() => emit({ pitch: d.pitch, roll: 0, yaw: 0 }), 1000 / sensorHz(node));
          return () => {
            clearInterval(t);
            d.motion = Math.max(0, d.motion - 1);
            d.slider.disabled = d.motion === 0;
          };
        }
        if (node.kind === 'location') {
          d.locEvent = node.event ?? 'location';
          const t = setInterval(() => {
            const p = map.position(d.spec.id);
            if (p) emit({ lat: p.lat, lng: p.lng, acc: 5 });
          }, 1000 / sensorHz(node, 1));
          return () => clearInterval(t);
        }
      },
    };
  }

  function deviceEl(spec: DeviceSpec, session: DeviceSession): Device {
    // The UI lays out at the device's logical size (iPhone 393x852, iPad landscape 1180x820) and is scaled down into the bezel by CSS.
    const screen = el('div', { class: 'lp-canvas' });
    const clip = el('div', { class: 'lp-screen' }, [screen]);
    const status = el('span', { class: 'lp-dev-status' });
    const sliderValue = el('output', { class: 'lp-pitch-value' }, ['0°']);
    const slider = el('input', { type: 'range', min: -90, max: 90, step: 1, value: 0, class: 'lp-pitch', 'aria-label': `${spec.label} pitch`, disabled: true }) as HTMLInputElement;
    const d: Device = { spec, session, screen, status, slider, sliderValue, handle: null, uiRef: null, pitch: 0, motion: 0, locEvent: null, raf: 0 };
    slider.addEventListener('input', () => {
      d.pitch = Number(slider.value);
      sliderValue.textContent = `${d.pitch}°`;
    });
    const bezel = el('div', { class: `lp-bezel lp-${spec.kind}` }, [spec.kind === 'phone' ? el('i', { class: 'lp-island', 'aria-hidden': 'true' }) : el('i', { class: 'lp-camera', 'aria-hidden': 'true' }), clip]);
    devicesEl.append(el('figure', { class: 'lp-device' }, [
      el('figcaption', {}, [el('strong', {}, [spec.label]), status]),
      bezel,
      el('label', { class: 'lp-pitch-row' }, ['Pitch ', slider, sliderValue]),
    ]));
    session.onChange = () => schedule(d);
    session.onLog = (row) => terminal.add(row);
    return d;
  }

  function connect(): void {
    teardown();
    const gameId = account.gameId;
    if (!gameId) {
      devicesEl.append(emptyState('Open a cloud game first', 'Pick or create a game in File > Account and publishing, then come back to Live Preview.'));
      return setStatus();
    }
    const lobby = normalizeLobby(lobbyInput.value) || randomLobby();
    lobbyInput.value = lobby;
    const run = Date.now().toString(36);
    devices = DEVICES.map((spec) => {
      const session = new DeviceSession({ name: spec.name, kind: spec.kind, baseUrl: base(), gameId, lobby, run });
      return deviceEl(spec, session);
    });
    devices.forEach((d) => {
      d.session.localUi = localUi;
      renderDevice(d);
      void d.session.start();
    });
    terminal.add(sysRow('preview', `connecting ${gameTitle()} lobby ${lobby} on ${base() || 'this origin'}`));
    openDebug(gameId);
  }

  function openDebug(gameId: string): void {
    if (!account.account || !account.client.token) return void terminal.add(sysRow('server', 'Debug stream skipped: sign in as the game owner or a developer to see server logs.', 'warn'));
    let opened = false;
    debugSocket = account.client.openDebug(gameId);
    debugSocket.onMessage = (ev) => debugRow(ev).forEach((r) => terminal.add(r));
    debugSocket.onStatus = (s) => {
      if (s === 'open') {
        opened = true;
        terminal.add(sysRow('server', 'debug stream open'));
      }
    };
    debugTimer = setTimeout(() => {
      if (!opened) terminal.add(sysRow('server', 'Debug stream not open: only the game owner or a developer account can read it. Frames from the devices still show.', 'warn'));
    }, 6000);
  }

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => map.resize()) : null;
  ro?.observe(side);
  const unsub = account.onChange(() => {
    // Game switched while the panel is open: reconnect to the new game; a re-sign-in alone is not a reason to drop the lobby.
    if (account.gameId !== currentGame) {
      currentGame = account.gameId;
      takePending();
      connect();
    } else setStatus();
  });
  let currentGame = account.gameId;
  handoff = () => {
    takePending();
    connect();
  };
  takePending();
  connect();

  return {
    element: root,
    focus: () => lobbyInput.focus(),
    dispose() {
      disposed = true;
      handoff = null;
      terminalSink = null;
      unsub();
      ro?.disconnect();
      teardown();
      map.dispose();
    },
  };
}
