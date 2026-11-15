// Live Preview panel: an iPhone and an iPad frame for the open cloud game (each its own dev device in one lobby), a GPS map of the
// devices and a terminal of /debug plus per-device frames. Menu: View > Live Preview.
import type { DebugEvent, ReconnectingSocket } from '@pear/cloud';
import { mount, pickScreen, validate, type Hooks, type Node, type PearUI } from '@pear/ui';
import type { AccountController } from '../account';
import type { PanelSpec, PanelView } from '../layout';
import { button, el } from '../ui';
import { RelayClient } from '../relay';
import { qrDataUrl } from '../publishView';
import { companionMotion, needsPreviewSession, phoneReachable, physicalPlayerUrl, type PreviewSource } from './physical';
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
  sensors: Set<{ node: Node; emit: (data: unknown) => void; last: number }>;
}

export const livePreviewPanel = (account: AccountController, openHostedGame?: () => void): PanelSpec => ({ id: 'livePreview', title: 'Live Preview', create: () => createLivePreviewPanel(account, openHostedGame) });

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

export function createLivePreviewPanel(account: AccountController, openHostedGame?: () => void): PanelView {
  const root = el('div', { class: 'lp-root' });
  const terminal = new PreviewTerminal();
  terminalSink = (row) => terminal.add(row);
  buffered.splice(0).forEach((row) => terminal.add(row));
  const map = new PreviewMap((id, at) => {
    const d = devices.find((x) => x.spec.id === id);
    if (d && sources[d.spec.id] === 'simulator') d.session.send(d.locEvent ?? 'location', { lat: at.lat, lng: at.lng, acc: 5 });
  });
  DEVICES.forEach((s) => map.addDevice(s.id, s.label, s.color, { lat: DEFAULT_CENTER.lat + s.offset.lat, lng: DEFAULT_CENTER.lng + s.offset.lng }));

  const takePending = () => {
    const l = pendingLobby && normalizeLobby(pendingLobby);
    pendingLobby = null;
    if (l) lobbyInput.value = l;
  };
  const lobbyInput = el('input', { type: 'text', class: 'lp-lobby', value: randomLobby(), maxlength: 12, 'aria-label': 'Lobby code', spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const statusEl = el('span', { class: 'lp-status', role: 'status' });
  const sources: Record<string, PreviewSource> = { iphone: 'simulator', ipad: 'simulator' };
  const connectBtn = button('Apply lobby / reconnect', () => connect());
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
  const toolbar = el('div', { class: 'lp-toolbar' }, [...(openHostedGame ? [button('Open hosted game…', openHostedGame, { variant: 'small' })] : []), el('label', { class: 'lp-lobby-label' }, ['Lobby ', lobbyInput]), newCode, connectBtn, localBtn, filePick, statusEl]);
  const devicesEl = el('div', { class: 'lp-devices' });
  const side = el('div', { class: 'lp-side' }, [el('div', { class: 'lp-map-wrap' }, [map.element]), terminal.element]);
  const body = el('div', { class: 'lp-body' }, [devicesEl, side]);
  const relay = new RelayClient();
  const assignments = new Map<string, string>();
  const relayStatus = el('p', { role: 'status' });
  const relayDevices = el('ul', { class: 'lp-relay-devices' });
  const consent = el('input', { type: 'checkbox' });
  consent.addEventListener('change', () => {
    if (!consent.checked) assignments.clear();
    renderRelay();
  });
  const relayConnect = button('Connect local relay', () => relay.connect(), { variant: 'small' });
  const relayDisconnect = button('Disconnect relay', () => { relay.close(); renderRelay(); }, { variant: 'small' });
  function renderRelay(): void {
    const liveIds = new Set(relay.devices.map((d) => d.id));
    for (const [slot, id] of assignments) if (!liveIds.has(id)) assignments.delete(slot);
    if (relay.status !== 'open') { assignments.clear(); consent.checked = false; }
    relayStatus.textContent = relay.status === 'open'
      ? `Local relay open · ${relay.devices.length} companion device(s). Choose a bridge slot below to forward motion.`
      : relay.status === 'connecting' ? 'Connecting to local device relay…'
      : relay.status === 'failed' ? 'Local relay unavailable. Browser pairing above works without it. Companion relay is not bundled or started by this app.' : 'Local relay disconnected.';
    relayConnect.disabled = relay.status === 'open' || relay.status === 'connecting';
    relayDisconnect.disabled = relay.status === 'idle';
    relayDevices.replaceChildren(...relay.devices.map((device) => {
      const select = el('select', { 'aria-label': `Assign ${device.name} to preview slot` }, [el('option', { value: '' }, ['Not forwarding']),
        ...DEVICES.filter((s) => sources[s.id] === 'companion').map((s) => el('option', { value: s.id }, [`${s.label} bridge`])),
      ]);
      select.disabled = !consent.checked;
      select.value = [...assignments].find(([, id]) => id === device.id)?.[0] ?? '';
      select.addEventListener('change', () => {
        for (const [slot, id] of assignments) if (id === device.id) assignments.delete(slot);
        if (select.value && consent.checked) assignments.set(select.value, device.id);
        renderRelay();
      });
      return el('li', {}, [el('span', {}, [`${device.name} (${device.kind})`]), select]);
    }));
  }
  relay.onChange = renderRelay;
  const pairingLinks = el('div', { class: 'lp-pair-links' });
  const pairingSummary = el('p', { role: 'status' });
  function renderPairing(gameId: string | null, lobby: string): void {
    pairingSummary.textContent = gameId ? `Pair to lobby ${lobby}. Choose Browser device before scanning: its simulator leaves, keeping the role free. Each physical browser joins as its own player.` : 'Open a cloud game to create pairing links.';
    pairingLinks.replaceChildren(...(gameId ? DEVICES.map((spec) => {
      const role = spec.kind === 'ipad' ? 'referee' : 'phone';
      let url = '';
      try { url = physicalPlayerUrl(base(), { gameId, lobby, kind: spec.kind, role }); } catch { /* The visible server warning below is the recovery. */ }
      const source = el('select', { 'aria-label': `${spec.label} input source` }, [
        el('option', { value: 'simulator' }, ['Simulator']), el('option', { value: 'browser' }, ['Browser device']), el('option', { value: 'companion' }, ['Companion motion bridge']),
      ]);
      source.value = sources[spec.id];
      source.addEventListener('change', () => { sources[spec.id] = source.value as PreviewSource; connect(); });
      const reachable = phoneReachable(url);
      const row = el('section', { class: 'lp-pair-row' }, [
        el('div', { class: 'lp-pair-heading' }, [el('strong', {}, [`${spec.label} · ${role}`]), source]),
        el('p', {}, [sources[spec.id] === 'browser' ? 'Slot reserved for a real browser. Studio does not assert connection; check the device screen and server frames in the terminal.' : sources[spec.id] === 'companion' ? 'A cloud preview participant receives assigned companion motion only. Sliders and simulated GPS are off.' : 'Simulator occupies this role. Switch to Browser device to make room for a real participant.']),
      ]);
      if (url) row.append(el('div', { class: 'lp-pair-link' }, [
        ...(reachable ? [el('img', { src: qrDataUrl(url), alt: `Scan to join ${spec.label} in lobby ${lobby}`, width: 112, height: 112 })] : []),
        el('div', {}, [el('a', { href: url, target: '_blank', rel: 'noreferrer' }, ['Open player']), button('Copy link', () => {
          void navigator.clipboard.writeText(url).then(() => { pairingSummary.textContent = `Copied ${spec.label} link · lobby ${lobby}`; }).catch(() => { pairingSummary.textContent = `Clipboard unavailable. Copy this link: ${url}`; });
        }, { variant: 'small' }), el('code', {}, [url])]),
      ]));
      if (!reachable) row.append(el('p', { role: 'alert' }, ['Phones need a reachable HTTPS server. Set the server URL in Account and publishing; localhost, HTTP and the desktop app origin cannot be scanned.']));
      return row;
    }) : []));
  }
  const pairing = el('details', { class: 'lp-pairing', open: true }, [
    el('summary', {}, ['Pair a phone or iPad']), pairingSummary, pairingLinks,
    el('p', {}, ['The game server must deploy this Studio build, including player.html, and allow preview sign-in (PEAR_DEV_SIGNIN=1). A missing player page may open Studio instead; ask the host to deploy the player entry. Local ui.json previews are not shared with browsers: publish the UI first. Map markers are Studio simulator positions, not paired-browser tracking.']),
    el('p', {}, ['On the device, tap Join lobby, then enable only the inputs you want to share. Touch and Pencil taps work on game buttons. The optional Touch / Pencil pad sends pointer events only to games scripted for them; pressure/tilt vary by browser and hardware. No native Pencil hover, roll, squeeze or double-tap is claimed. For two phone players, open the phone link on two different phones.']),
    el('details', { class: 'lp-companion' }, [el('summary', {}, ['Optional: companion motion bridge']),
      el('p', {}, ['For an already running local relay: choose Companion motion bridge for a slot, connect, opt in below, then assign a device. Companion motion is converted from USIS orientation to pitch/roll/yaw in degrees for the game’s active motion nodes. Native touch/Pencil, watch and AirPods channels are not forwarded; USIS positions are metres, not GPS.']),
      el('p', {}, ['Relay setup is separate and currently not included in packaged Studio. Developers can run npm run relay in Web/studio; the Pear companion discovers “Pear relay” on the same Wi-Fi (Bonjour _pear._tcp, TCP 7777). Allow Local Network access. Browser pairing above needs no relay or terminal.']),
      relayConnect, relayDisconnect, relayStatus, el('label', { class: 'lp-relay-consent' }, [consent, ' I allow assigned local companion motion to be sent to this game’s cloud server.']), relayDevices,
    ]),
  ]);
  relay.onPacket = (id, packet) => {
    if (!consent.checked || relay.status !== 'open') return;
    const data = companionMotion(id, packet);
    if (!data) return;
    for (const d of devices) {
      if (sources[d.spec.id] !== 'companion' || assignments.get(d.spec.id) !== id || d.session.status !== 'open') continue;
      const now = performance.now();
      for (const sensor of d.sensors) {
        if (sensor.node.kind !== 'motion' || now - sensor.last < 1000 / sensorHz(sensor.node)) continue;
        sensor.last = now;
        sensor.emit(data);
      }
    }
  };
  renderRelay();
  root.append(toolbar, pairing, body);

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
    statusEl.textContent = `${gameTitle()} · ${open}/${devices.length} Studio cloud sessions open · not physical devices`;
  }

  function emptyState(text: string, detail?: string): HTMLElement {
    return el('div', { class: 'lp-empty-ui' }, [el('strong', {}, [text]), ...(detail ? [el('p', {}, [detail])] : [])]);
  }

  function renderDevice(d: Device): void {
    const s = d.session;
    d.status.textContent = s.status === 'open' ? (sources[d.spec.id] === 'companion' ? 'Companion bridge online' : 'Simulator online') : s.status === 'failed' ? 'Sign-in failed' : s.status === 'idle' ? 'Idle' : 'Connecting…';
    d.status.dataset.state = s.status;
    d.slider.disabled = d.motion === 0;
    const ui = s.uiState;
    if (ui.kind === 'ready' && !pickScreen(ui.ui, s.state)) {
      d.handle?.destroy();
      d.handle = null;
      d.uiRef = null;
      d.screen.replaceChildren(emptyState('Waiting for a game screen', 'The published UI has no matching route for the current game state. Check the frames in the terminal or load a local ui.json.'));
    } else if (ui.kind === 'ready') {
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
        if (sources[d.spec.id] === 'companion') {
          const sensor = { node, emit, last: -Infinity };
          d.sensors.add(sensor);
          return () => { d.sensors.delete(sensor); };
        }
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
    const d: Device = { spec, session, screen, status, slider, sliderValue, handle: null, uiRef: null, pitch: 0, motion: 0, locEvent: null, raf: 0, sensors: new Set() };
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
    const lobby = normalizeLobby(lobbyInput.value) || randomLobby();
    lobbyInput.value = lobby;
    renderPairing(gameId, lobby);
    renderRelay();
    if (!gameId) {
      devicesEl.append(emptyState('Open a cloud game first', 'Pick or create a game in File > Account and publishing, then come back to Live Preview.'));
      return setStatus();
    }
    const run = crypto.randomUUID();
    devices = DEVICES.filter((spec) => needsPreviewSession(sources[spec.id])).map((spec) => {
      const session = new DeviceSession({ name: spec.name, kind: spec.kind, baseUrl: base(), gameId, lobby, run });
      return deviceEl(spec, session);
    });
    devices.forEach((d) => {
      d.session.localUi = localUi;
      renderDevice(d);
      void d.session.start();
    });
    setStatus();
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
      relay.close();
      ro?.disconnect();
      teardown();
      map.dispose();
    },
  };
}
