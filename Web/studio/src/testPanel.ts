// Test panel: every player in a running multiplayer test, a top-down map, and controls for the driven player.
import { parseGestures } from '@pear/runtime';
import { SIM_DEVICE_KINDS, accelPulse, parseUsisJsonl, type SimDeviceKind } from '@pear/sim';
import { slotDevice } from './needs';
import { button, el, icon, openMenu } from './ui';
import type { PanelView } from './layout';
import type { Project } from './project';
import { SIM_DEVICE_NAMES, TIME_SCALES, rigWarning, type BotMode, type PlayerSource, type RunController, type TestPlayer } from './run';
import { checkGame, gestureControls, type Check } from './gamePanel';

export const MAP_SIZE = 216;
const MIN_HALF = 8;
const HAPTIC_MS = 400;

/** Half-width in meters of the square map: at least 8 m, and every point plus 2 m of margin fits. */
export function mapHalfExtent(points: readonly { x: number; z: number }[]): number {
  let half = MIN_HALF;
  // Non-finite points are skipped: an infinite extent would make the grid loop in drawMap never end.
  for (const p of points) if (Number.isFinite(p.x) && Number.isFinite(p.z)) half = Math.max(half, Math.abs(p.x) + 2, Math.abs(p.z) + 2);
  return half;
}

/** World (x, z) to canvas px: +X right, -Z up (north up), origin at the center. */
export function worldToMap(x: number, z: number, half: number, size = MAP_SIZE): [number, number] {
  const s = size / (2 * half);
  return [size / 2 + x * s, size / 2 + z * s];
}

export function mapToWorld(px: number, py: number, half: number, size = MAP_SIZE): [number, number] {
  const s = (2 * half) / size;
  return [(px - size / 2) * s, (py - size / 2) * s];
}

export const hapticRecent = (hapticAt: number, now: number): boolean => now - hapticAt < HAPTIC_MS;

const GESTURES = [['Tap (T)', 'tap'], ['Double tap (G)', 'doubleTap'], ['Flick (F)', 'flick'], ['Pinch (P)', 'pinch'], ['Squeeze (H)', 'squeeze']] as const;
const DEVICE_INFO: Record<SimDeviceKind, [string, string]> = { airpods: ['airpods', 'head'], phone: ['phone', 'hand'], watch: ['watch', 'leftWrist'] };
const DEVICE_LABEL: Record<SimDeviceKind, string> = { airpods: 'Virtual AirPods', phone: 'Virtual phone', watch: 'Virtual watch' };

export function createTestPanel(project: Project, run: RunController): PanelView {
  const root = el('div', { class: 'pn', role: 'region', 'aria-label': 'Test', tabindex: -1 });
  const group = (t: string) => el('div', { class: 'pn-group' }, [t]);
  const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || 'currentColor';
  const fmt = (p: readonly number[]) => `x ${p[0]!.toFixed(1)} z ${p[2]!.toFixed(1)}`;

  let key = '';
  let canvas: HTMLCanvasElement | null = null;
  let rows = new Map<string, { sub: HTMLElement; dot: HTMLElement }>();
  let yaw: HTMLInputElement | null = null;
  let pitch: HTMLInputElement | null = null;
  let yawOut: HTMLElement | null = null;
  let pitchOut: HTMLElement | null = null;
  let posOut: HTMLElement | null = null;
  let dragging: string | null = null;
  let moved = 0;
  let start: [number, number] = [0, 0];
  const msg = el('p', { class: 'pn-empty', role: 'status' });
  const structureKey = () => [run.running, run.driven, run.players.map((p) => `${p.id}:${p.wander}:${p.run.recording}:${p.run.replaying}:${p.run.clip?.length ?? 0}:${p.source}:${p.botMode}:${[...p.liveDevices]}`).join(), run.rig.join(), run.relay.status, run.relay.devices.map((d) => d.id).join(), run.timeScale, run.status.kind].join('|');

  const slider = (label: string, input: HTMLElement, out: HTMLElement) =>
    el('div', { style: 'display:grid;grid-template-columns:72px minmax(0,1fr) 52px;align-items:center;gap:8px;font-size:11px;color:var(--text-secondary);min-height:var(--row-height)' }, [label, input, out]);

  const checklist = (): Node => {
    const checks = checkGame(project, run.status.text).checks;
    const todo = checks.filter((c) => !c.ok);
    // The game's declared needs stay visible when met: they answer "what does my game need".
    const needs = checks.find((c) => c.ok && c.label.startsWith('Needs '));
    const fix = (c: Check) => {
      if (!c.fix) return [];
      const f = c.fix;
      return [button(f.label, () => {
        const err = project.setSceneSetting(f.setting, f.value);
        if (err) msg.textContent = err;
      }, { variant: 'small', ariaLabel: `${f.label}: ${c.label}` })];
    };
    const items = [
      ...(needs ? [el('li', {}, [needs.label])] : []),
      ...todo.map((c) => el('li', { style: 'display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px' }, [
        `To do: ${c.label}`, ...(c.hint ? [el('span', { class: 'om-sub' }, [c.hint])] : []), ...fix(c),
      ])),
    ];
    return items.length ? el('ul', { class: 'pn-list' }, items) : el('p', { class: 'pn-empty' }, ['Ready']);
  };

  // shortcut: clips live in memory and in downloaded files, not in the project file; store them there when scenarios need to travel with a game.
  const botControls = (p: TestPlayer): Node => {
    const mode = el('select', { 'aria-label': `Bot behavior for ${p.name}` }, [
      el('option', { value: 'chase' }, ['Chase nearest player']), el('option', { value: 'flee' }, ['Flee nearest player']),
      el('option', { value: 'gestures' }, ['Random gestures']),
    ]);
    mode.value = p.botMode;
    const every = el('input', { type: 'number', min: 0.2, step: 0.5, value: p.botEvery, 'aria-label': `Seconds between gestures for ${p.name}`, style: 'width:56px' });
    const apply = () => run.setBot(p.id, mode.value as BotMode, Number(every.value));
    mode.addEventListener('change', apply);
    every.addEventListener('change', apply);
    return el('span', { style: 'display:flex;align-items:center;gap:4px' }, p.botMode === 'gestures' ? [mode, every, 's'] : [mode]);
  };

  const liveControls = (p: TestPlayer): Node => {
    const r = run.relay;
    if (r.status === 'failed') return el('span', { class: 'om-sub' }, ['Relay not running: npm run relay ', button('Retry', () => r.connect(), { variant: 'small' })]);
    if (!r.devices.length) return el('span', { class: 'om-sub' }, [r.status === 'open' ? 'No devices connected to the relay.' : 'Connecting to the relay.']);
    return el('span', { style: 'display:flex;flex-wrap:wrap;gap:4px 8px' }, r.devices.map((d) => {
      const box = el('input', { type: 'checkbox', 'aria-label': `${d.name} (${d.kind}) feeds ${p.name}` });
      box.checked = p.liveDevices.has(d.id);
      box.addEventListener('change', () => run.setLiveDevice(p.id, d.id, box.checked));
      return el('label', { style: 'display:flex;align-items:center;gap:4px' }, [box, `${d.name} (${d.kind})`]);
    }));
  };

  const timeScaleSection = (): Node[] => {
    const sel = el('select', { 'aria-label': 'Time scale' }, TIME_SCALES.map((n) => el('option', { value: String(n) }, [`${n}x`])));
    sel.value = String(run.timeScale);
    sel.addEventListener('change', () => run.setTimeScale(Number(sel.value)));
    const blocked = run.status.kind === 'server' || run.status.kind === 'join';
    sel.disabled = blocked;
    return [group('Time scale'), el('div', { style: 'padding:4px 12px;display:flex;align-items:center;gap:8px' }, [
      sel, ...(blocked ? [el('span', { class: 'om-sub' }, ['Local Play only: the server keeps its own time.'])] : []),
    ])];
  };

  const clipRow = (p: TestPlayer): Node => {
    const rec = button(p.run.recording ? 'Stop recording' : 'Record', () => run.recordPlayer(p.id), { variant: 'small', ariaLabel: `${p.run.recording ? 'Stop recording' : 'Record'} ${p.name}` });
    rec.setAttribute('aria-pressed', String(p.run.recording));
    const source = el('select', { 'aria-label': `Input source for ${p.name}` }, [
      el('option', { value: 'manual' }, ['Manual']), el('option', { value: 'replay' }, ['Replay']),
      el('option', { value: 'live' }, ['Live']), el('option', { value: 'bot' }, ['Bot']),
    ]);
    source.value = p.source;
    source.addEventListener('change', () => {
      msg.textContent = run.setSource(p.id, source.value as PlayerSource) ?? '';
      source.value = p.source;
    });
    const file = el('input', { type: 'file', accept: '.jsonl,.usis.jsonl', 'aria-label': `Load a .usis.jsonl clip for ${p.name}` });
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      if (f) void f.text().then((t) => (msg.textContent = '', run.loadClip(p.id, parseUsisJsonl(t)))).catch((e) => { msg.textContent = `${f.name}: ${e instanceof Error ? e.message : String(e)}`; });
    });
    const items: Node[] = [rec];
    const clip = p.run.clip;
    if (clip) {
      items.push(button(`Save .usis.jsonl (${clip.length})`, () => {
        const a = el('a', { href: URL.createObjectURL(new Blob([clip.map((x) => JSON.stringify(x)).join('\n') + '\n'], { type: 'application/x-ndjson' })), download: `${p.id}.usis.jsonl` });
        a.click();
        URL.revokeObjectURL(a.href);
      }, { variant: 'small', ariaLabel: `Save ${p.name} clip as .usis.jsonl` }));
    }
    items.push(source, file);
    if (p.source === 'bot') items.push(botControls(p));
    if (p.source === 'live') items.push(liveControls(p));
    return el('span', { style: 'grid-column:1/-1;display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px' }, items);
  };

  const playersSection = (): Node[] => {
    rows = new Map();
    if (!run.running) return [el('p', { class: 'pn-empty' }, ['Press Play (F5). Your player and any you add appear here.'])];
    const list = el('ul', { class: 'om-list', 'aria-label': 'Players' }, run.players.map((p, i) => {
      const sub = el('span', { class: 'om-sub' });
      const dot = el('span', { class: 'om-haptic', role: 'img', 'aria-label': 'Haptic output' }, [icon('phone')]);
      rows.set(p.id, { sub, dot });
      const driven = run.driven === p.id;
      const drive = button(driven ? 'Driving' : 'Drive', () => run.drive(p.id), { variant: 'small', ariaLabel: `Drive ${p.name}` });
      drive.disabled = driven;
      drive.setAttribute('aria-pressed', String(driven));
      const btns: Node[] = [drive];
      if (i > 0) {
        const w = button('Wander', () => run.setWander(p.id, !p.wander), { variant: 'small', ariaLabel: `Wander ${p.name}` });
        w.setAttribute('aria-pressed', String(p.wander));
        btns.push(w, button('Remove', () => run.removePlayer(p.id), { variant: 'small', ariaLabel: `Remove ${p.name}` }));
      }
      return el('li', { style: 'grid-template-columns:minmax(0,1fr) 14px auto;gap:4px 8px' }, [
        el('span', { class: 'om-name' }, [i === 0 ? `${p.name} (you)` : p.name, sub]), dot,
        el('span', { style: 'display:flex;gap:4px' }, btns),
        clipRow(p),
      ]);
    }));
    const add = button('Add player', () => { msg.textContent = ''; run.addPlayer().catch((e) => { msg.textContent = e instanceof Error ? e.message : String(e); }); }, { variant: 'small' });
    return [list, el('div', { style: 'padding:4px 12px' }, [add]), msg];
  };

  const mapSection = (): Node[] => {
    canvas = null;
    if (!run.running) return [];
    const dpr = window.devicePixelRatio || 1;
    canvas = el('canvas', { role: 'img', style: `width:${MAP_SIZE}px;height:${MAP_SIZE}px;margin:4px 12px;touch-action:none;border:1px solid var(--line)` });
    canvas.width = MAP_SIZE * dpr;
    canvas.height = MAP_SIZE * dpr;
    const c = canvas;
    const half = () => mapHalfExtent(points());
    const at = (e: PointerEvent): [number, number] => { const r = c.getBoundingClientRect(); return [((e.clientX - r.left) / (r.width || MAP_SIZE)) * MAP_SIZE, ((e.clientY - r.top) / (r.height || MAP_SIZE)) * MAP_SIZE]; };
    c.addEventListener('pointerdown', (e) => {
      const [px, py] = at(e);
      const h = half();
      let best: { id: string; d: number } | null = null;
      for (const p of run.players) {
        const [sx, sy] = worldToMap(p.run.devices.position[0], p.run.devices.position[2], h);
        const d = Math.hypot(sx - px, sy - py);
        if (d <= 10 && (!best || d < best.d)) best = { id: p.id, d };
      }
      if (!best) return;
      dragging = best.id;
      moved = 0;
      start = [px, py];
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const p = at(e);
      moved = Math.max(moved, Math.hypot(p[0] - start[0], p[1] - start[1]));
      if (moved < 4) return;
      const [x, z] = mapToWorld(...p, half());
      run.movePlayer(dragging, x, z);
      drawMap();
    });
    // A click drives the player; a drag only places it, so moving someone never changes who you control.
    c.addEventListener('pointerup', () => { if (dragging && moved < 4) run.drive(dragging); dragging = null; });
    c.addEventListener('pointercancel', () => { dragging = null; });
    return [group('Map'), c];
  };

  const points = () => [
    ...run.players.map((p) => ({ x: p.run.devices.position[0], z: p.run.devices.position[2] })),
    ...(run.players[0]?.run.entities ?? []).map((e) => ({ x: e.position[0], z: e.position[2] })),
  ];

  const drawMap = () => {
    if (!canvas) return;
    const g = canvas.getContext('2d');
    if (!g) return;
    const dpr = canvas.width / MAP_SIZE;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, MAP_SIZE, MAP_SIZE);
    const half = mapHalfExtent(points());
    g.strokeStyle = css('--line');
    g.lineWidth = 1;
    for (let m = Math.ceil(-half); m <= half; m++) {
      const [gx] = worldToMap(m, 0, half);
      const [, gy] = worldToMap(0, m, half);
      g.beginPath(); g.moveTo(gx, 0); g.lineTo(gx, MAP_SIZE); g.moveTo(0, gy); g.lineTo(MAP_SIZE, gy); g.stroke();
    }
    g.fillStyle = css('--text-secondary');
    for (const e of run.players[0]?.run.entities ?? []) {
      const [sx, sy] = worldToMap(e.position[0], e.position[2], half);
      g.fillRect(sx - 2, sy - 2, 4, 4);
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '9px sans-serif';
    run.players.forEach((p, i) => {
      const d = p.run.devices;
      const [sx, sy] = worldToMap(d.position[0], d.position[2], half);
      const color = css(p.id === run.driven ? '--accent' : '--text');
      g.fillStyle = color;
      g.beginPath(); g.arc(sx, sy, 6, 0, Math.PI * 2); g.fill();
      if (p.id === run.driven) {
        const yawR = d.headLook.yaw;
        g.strokeStyle = color; g.lineWidth = 2;
        g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx - Math.sin(yawR) * 14, sy - Math.cos(yawR) * 14); g.stroke();
      }
      g.fillStyle = css('--bg-panel');
      g.fillText(String(i + 1), sx, sy);
    });
    canvas.setAttribute('aria-label', `Map of ${run.players.length} player${run.players.length === 1 ? '' : 's'}: ${run.players.map((p) => `${p.name} ${fmt(p.run.devices.position)}`).join(', ')}`);
  };

  const controlsSection = (): Node[] => {
    const dp = run.drivenPlayer;
    yaw = pitch = yawOut = pitchOut = posOut = null;
    if (!run.running || !dp) return [];
    const dev = () => run.drivenPlayer?.run.devices;
    const gestures = el('div', { class: 'sw-presets', style: 'display:flex;flex-wrap:wrap;gap:4px;padding-top:4px' });
    for (const [label, type] of GESTURES) {
      const b = button(label, () => dev()?.gesture(type, type === 'flick' ? [1, 0, 0] : undefined), { variant: 'small' });
      b.addEventListener('mousedown', (e) => e.preventDefault()); // a mouse click keeps viewport focus, so WASD keeps walking
      gestures.append(b);
    }
    let custom: ReturnType<typeof parseGestures> = {};
    try { custom = parseGestures(project.scene.gestures); } catch { /* invalid gestures are reported by the Game panel */ }
    for (const [name, def] of Object.entries(custom)) {
      const label = `${name[0]!.toUpperCase()}${name.slice(1)} (motion)`;
      const b = button(label, () => dev()?.playAccel(slotDevice(def.slot), accelPulse(def.axis, def.threshold * 1.4)), { variant: 'small' });
      b.addEventListener('mousedown', (e) => e.preventDefault());
      gestures.append(b);
    }
    yaw = el('input', { type: 'range', min: -180, max: 180, value: 0, 'aria-label': 'Head yaw in degrees' });
    pitch = el('input', { type: 'range', min: -89, max: 89, value: 0, 'aria-label': 'Head pitch in degrees' });
    yawOut = el('output', {}, ['0 deg']);
    pitchOut = el('output', {}, ['0 deg']);
    posOut = el('output', {}, [fmt(dp.run.devices.position)]);
    const y = yaw, p = pitch;
    const look = () => dev()?.setHeadLook((Number(y.value) * Math.PI) / 180, (Number(p.value) * Math.PI) / 180);
    y.addEventListener('input', look);
    p.addEventListener('input', look);
    const bpm = el('input', { type: 'range', min: 40, max: 200, value: run.heartRate, 'aria-label': 'Heart rate in beats per minute' });
    const bpmOut = el('output', {}, [`${run.heartRate} bpm`]);
    bpm.addEventListener('input', () => {
      run.heartRate = Number(bpm.value);
      bpmOut.textContent = `${bpm.value} bpm`;
      dev()?.setHeartRate(run.heartRate);
    });
    const keys = gestureControls(project.clientScripts);
    const gps = el('input', { type: 'range', min: 0, max: 15, step: 1, value: dp.run.devices.gpsAccuracyMeters, 'aria-label': 'GPS accuracy in meters' });
    const gpsOut = el('output', {}, [`${gps.value} m`]);
    gps.addEventListener('input', () => {
      gpsOut.textContent = `${gps.value} m`;
      dev()?.setGpsAccuracy(Number(gps.value));
    });
    return [
      group(`Controls: ${dp.name}`), gestures,
      ...(keys.length ? [el('ul', { class: 'pn-list' }, keys.map((c) => el('li', {}, [`${c.label}: `, el('code', { title: c.where }, [c.line])])))] : []),
      slider('Yaw', y, yawOut), slider('Pitch', p, pitchOut), slider('Position', el('span'), posOut), slider('Heart rate', bpm, bpmOut),
      ...(run.rig.includes('phone') ? [slider('GPS accuracy', gps, gpsOut)] : []),
      el('p', { class: 'pn-empty' }, ['WASD walks the driven player (click the viewport first). Drag in the viewport to look.']),
    ];
  };

  const devicesSection = (): Node[] => {
    const on = run.running;
    const rig = run.rig;
    const addable = SIM_DEVICE_KINDS.filter((k) => !rig.includes(k));
    const addBtn = button('Add device', () => openMenu(addBtn, addable.map((k) => ({ label: DEVICE_LABEL[k], run: () => run.setRig([...rig, k]) }))), { variant: 'small' });
    addBtn.disabled = addable.length === 0;
    const warning = rigWarning(run.sceneTier(), rig);
    return [
      group('Devices each player has'),
      el('ul', { class: 'om-list', 'aria-label': 'Virtual devices' }, rig.length ? rig.map((k) => el('li', { style: 'grid-template-columns:18px minmax(0,1fr) auto auto' }, [
        icon(DEVICE_INFO[k][0]), el('span', { class: 'om-name' }, [DEVICE_LABEL[k], el('span', { class: 'om-sub' }, [DEVICE_INFO[k][1]])]),
        el('span', { class: on ? 'om-state' : 'om-state om-state--stale' }, [on ? '50 Hz' : 'Stopped']),
        button('Remove', () => run.setRig(rig.filter((x) => x !== k)), { variant: 'small', ariaLabel: `Remove ${SIM_DEVICE_NAMES[k]}` }),
      ])) : [el('li', { class: 'om-sub' }, ['No devices: the game receives no input.'])]),
      el('div', { style: 'padding:4px 12px' }, [addBtn]),
      ...(warning ? [el('p', { class: 'pn-empty', role: 'status' }, [warning])] : []),
    ];
  };

  const render = () => {
    key = structureKey();
    root.replaceChildren(
      group('Checklist'), checklist(),
      ...timeScaleSection(),
      group(`Players (${run.players.length})`), ...playersSection(),
      ...mapSection(), ...controlsSection(), ...devicesSection(),
    );
    update();
  };

  // Numbers only: no rebuild, so focus survives while a user tabs through the controls.
  const update = () => {
    const now = Date.now();
    for (const p of run.players) {
      const r = rows.get(p.id);
      if (!r) continue;
      r.sub.textContent = fmt(p.run.devices.position) + (p.lastEvent ? `  last: ${p.lastEvent}` : '');
      r.dot.classList.toggle('is-firing', hapticRecent(p.hapticAt, now));
    }
    const h = run.drivenPlayer?.run.devices;
    if (h && yaw && pitch && document.activeElement !== yaw && document.activeElement !== pitch) {
      yaw.value = String(Math.round((h.headLook.yaw * 180) / Math.PI));
      pitch.value = String(Math.round((h.headLook.pitch * 180) / Math.PI));
    }
    if (yawOut && yaw) yawOut.textContent = `${yaw.value} deg`;
    if (pitchOut && pitch) pitchOut.textContent = `${pitch.value} deg`;
    if (posOut && h) posOut.textContent = fmt(h.position);
  };
  const tick = () => { if (structureKey() !== key) render(); else update(); };

  const timer = setInterval(tick, 200);
  const mapTimer = setInterval(drawMap, 100);
  const offs = [project.onChange(render), run.onChange(tick)];
  render();
  return {
    element: root,
    focus: () => (root.querySelector<HTMLElement>('button:not(:disabled), input') ?? root).focus(),
    dispose: () => { clearInterval(timer); clearInterval(mapTimer); offs.forEach((f) => f()); },
  };
}
