import { mount, pickScreen } from '@pear/ui';
import { button, el } from '../ui';
import { BrowserSensors } from './browserSensors';
import { parsePhysicalJoin } from './physical';
import { bindPointerPad } from './pointer';
import { DeviceSession } from './session';
import './player.css';

const root = document.getElementById('player')!;
const parsedJoin = parsePhysicalJoin(location.search);
if (!parsedJoin) {
  root.append(el('section', { class: 'player-welcome' }, [el('h1', {}, ['Open a Live Preview link']), el('p', {}, ['In Pear Studio, open Live Preview, choose Browser device for a slot, then scan its QR code. A game, exact lobby, device kind and role are required.'])]));
} else {
  const join = parsedJoin;
  const sensors = new BrowserSensors();
  const name = el('input', { value: join.kind === 'ipad' ? 'My iPad' : 'My phone', maxlength: 40, 'aria-label': 'Player name', autocomplete: 'nickname' });
  const status = el('p', { role: 'status' }, ['Not joined. Your device will become a real participant in this lobby.']);
  const evidence = el('output', { 'aria-label': 'Last input sent', class: 'player-evidence' }, ['No input sent yet.']);
  const screen = el('section', { class: 'player-screen', 'aria-label': 'Game screen' });
  const sensorStatus = el('p', { role: 'status' }, ['Sensors off. Game buttons work without sensor access.']);
  const pad = el('div', { class: 'player-pad', 'aria-label': 'Touch and Pencil input pad' }, ['Draw here with a finger or Pencil']);
  pad.hidden = true;
  let stopPad: (() => void) | null = null;
  let session: DeviceSession | null = null;
  let handle: ReturnType<typeof mount> | null = null;
  let uiRef: unknown;
  let raf = 0;
  let leaving = false;
  const online = () => session?.status === 'open';
  const showError = (e: unknown) => { sensorStatus.textContent = e instanceof Error ? e.message : String(e); };
  const motion = button('Enable motion', () => {
    motion.disabled = true;
    sensorStatus.textContent = 'Waiting for motion permission…';
    void sensors.enableMotion().then((enabled) => {
      if (!enabled) return;
      sensorStatus.textContent = 'Motion enabled. Readings are sent only when this game requests a motion sensor. Tilt the device and check input below.';
      motion.textContent = 'Motion enabled';
    }).catch(showError).finally(() => { motion.disabled = !online(); });
  });
  const gps = button('Enable location', () => {
    try { sensors.enableLocation(); sensorStatus.textContent = 'Location requested. GPS is sent only when this game requests a location sensor.'; } catch (e) { showError(e); }
  });
  function stopInputs(): void {
    stopPad?.(); stopPad = null; pad.hidden = true;
    sensors.stop();
    motion.textContent = 'Enable motion';
    pointer.textContent = 'Enable Touch / Pencil pad';
    sensorStatus.textContent = 'Sensors and input pad off.';
  }
  const stop = button('Stop sharing inputs', stopInputs);
  const pointer = button('Enable Touch / Pencil pad', () => {
    if (stopPad) { stopPad(); stopPad = null; pad.hidden = true; pointer.textContent = 'Enable Touch / Pencil pad'; return; }
    if (!globalThis.PointerEvent) return showError('This browser has no Pointer Events support. Use an up-to-date Safari or Chrome.');
    pad.hidden = false;
    stopPad = bindPointerPad(pad, (data) => {
      if (session?.send('pointer', data)) {
        evidence.textContent = `pointer: ${JSON.stringify(data)}`;
        pad.textContent = `${data.pointerType} · pressure ${data.pressure.toFixed(2)} · ${data.phase}`;
      }
    });
    pointer.textContent = 'Disable Touch / Pencil pad';
  });
  sensors.onError = showError;
  const inputControls = [motion, gps, pointer, stop];
  const joinButton = button('Join lobby', () => {
    if (session) return;
    leaving = false;
    const s = new DeviceSession({ name: name.value.trim() || 'Player', kind: join.kind, role: join.role, gameId: join.gameId, lobby: join.lobby, baseUrl: location.origin, run: `physical-${crypto.randomUUID()}` });
    session = s;
    s.onLog = (row) => {
      if (row.dir === 'out' && row.name !== 'role') evidence.textContent = `${row.name}: ${row.text}`;
      if (row.level === 'error') status.textContent = row.text;
    };
    s.onChange = () => { if (!raf) raf = requestAnimationFrame(render); };
    render();
    void s.start();
  });
  const leave = button('Leave lobby', () => {
    leaving = true;
    stopInputs();
    session?.dispose(); session = null;
    handle?.destroy(); handle = null; uiRef = null;
    screen.replaceChildren();
    render();
  });
  function render(): void {
    raf = 0;
    const s = session;
    const open = online();
    joinButton.disabled = !!s;
    name.disabled = !!s;
    leave.disabled = !s;
    inputControls.forEach((b) => { b.disabled = !open; });
    if (!open) stopInputs();
    status.textContent = !s ? (leaving ? 'You left the lobby. Inputs stopped.' : 'Not joined. Tap Join lobby to participate.')
      : s.status === 'open' ? `Connected · ${s.state.me?.name ?? name.value} · lobby ${s.state.me?.lobby ?? join.lobby} · ${join.role}`
      : s.status === 'failed' ? 'Could not sign in. The host must enable preview sign-in (PEAR_DEV_SIGNIN=1). Leave and retry, or ask the game owner.'
      : `Connecting to lobby ${join.lobby} (${s.status})…`;
    if (!s) return;
    if (s.uiState.kind !== 'ready') {
      handle?.destroy(); handle = null; uiRef = null;
      screen.textContent = s.uiState.kind === 'loading' ? 'Loading game screen…' : `${s.uiState.reason} Ask the owner to publish a ui.json. The optional input pad can still send pointer events.`;
      return;
    }
    if (!pickScreen(s.uiState.ui, s.state)) {
      handle?.destroy(); handle = null; uiRef = null;
      screen.textContent = 'Waiting for a matching game screen…';
      return;
    }
    if (uiRef !== s.uiState.ui) {
      handle?.destroy(); screen.replaceChildren();
      handle = mount(screen, s.uiState.ui, s.state, (a) => { if (online()) s.act(a); }, sensors.hooks, s.assetUrl);
      uiRef = s.uiState.ui;
    } else handle?.update(s.state);
  }
  const details = el('details', {}, [
    el('summary', {}, ['Touch / Apple Pencil input for game authors']),
    el('p', {}, ['Game buttons accept finger or Pencil taps. The optional pad shares browser pointer data with this game, not native Pencil telemetry. Pressure and tilt depend on your Pencil, iPad and Safari version; hover, squeeze, double-tap and native roll are not provided. No readings are invented.']),
    el('p', {}, ['Your server script must handle the “pointer” event. x/y and pressure are 0–1; tiltX/tiltY are degrees; phases are down, move, up, cancel; pointerType is pen, touch or mouse. Moves are capped at 30 Hz. Existing games do not automatically use this event.']),
    el('p', {}, ['Validate all remote input on the server. This example broadcasts a validated stroke; your game must also render or otherwise consume the stroke event. It does not draw automatically.']),
    el('pre', {}, ['export default serverScript({\n  onRemote(ctx, player, name, data) {\n    if (name !== "pointer" || !data) return;\n    const { phase, pointerType, x, y, pressure, tiltX, tiltY, buttons } = data;\n    if (!["down", "move", "up", "cancel"].includes(phase) ||\n        !["pen", "touch", "mouse"].includes(pointerType)) return;\n    if (![x, y, pressure, tiltX, tiltY, buttons].every(Number.isFinite) ||\n        [x, y, pressure].some(v => v < 0 || v > 1) ||\n        Math.abs(tiltX) > 90 || Math.abs(tiltY) > 90 ||\n        !Number.isInteger(buttons) || buttons < 0) return;\n    ctx.remote.fireAll("stroke", { from: player.id, phase, pointerType, x, y, pressure, tiltX, tiltY, buttons });\n  }\n});']),
  ]);
  root.append(
    el('header', { class: 'player-header' }, [el('img', { src: '/pear-mark.svg', alt: 'Pear', width: 28, height: 28 }), el('strong', {}, ['Live Preview']), el('span', {}, [`Lobby ${join.lobby} · ${join.kind} · ${join.role}`])]),
    el('section', { class: 'player-welcome' }, [el('h1', {}, ['Play on this device']), el('p', {}, ['Join the same lobby as Studio. Touch controls work immediately; motion, location and the input pad stay private until you enable them.']), el('div', { class: 'player-actions' }, [name, joinButton, leave]), status]),
    screen,
    el('section', { class: 'player-inputs' }, [el('h2', {}, ['Device inputs']), el('p', {}, ['Enabling an input sends its readings to the game’s cloud server. Stop sharing or leave at any time. HTTPS and browser permissions are required for motion and GPS.']), el('div', { class: 'player-actions' }, inputControls), sensorStatus, pad, evidence, details]),
  );
  const cleanup = () => {
    stopInputs(); session?.dispose(); session = null;
    handle?.destroy(); handle = null; uiRef = null;
    screen.replaceChildren();
    if (raf) cancelAnimationFrame(raf);
    render();
  };
  addEventListener('pagehide', cleanup);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopInputs(); });
  render();
}
