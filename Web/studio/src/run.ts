// Run: Run local (runtime + sandbox + sim devices in this page), Run on server (publish a draft version, join
// /play as player 1), Add test player (another tab), Stop. `LocalRun` has no DOM so the e2e test drives it in Node.
// Simulated USIS packets never leave this page (Network Rule); only remote events reach /play.
import type { DebugEvent, PlayFrame, ReconnectingSocket } from '@omni/cloud';
import { quat, type UsisPacket } from '@omni/core';
import {
  InputBus, SceneEvents, Viewport, readViewportColors, scriptName,
  type SceneDescription, type WorldEntity,
} from '@omni/runtime';
import { ScriptSandbox, type ScriptOutput } from '@omni/script';
import { SimDevices, attachGestureKeys, attachMouseLook, type SimDevicesOptions } from '@omni/sim';
import type { AccountController } from './account';
import { describeError } from './account';
import type { DebugStore } from './debug-panel';
import type { EditorBus } from './editor';
import type { PanelView } from './layout';
import type { Project } from './project';
import { button, el, icon } from './ui';

export type EffectOutput = Exclude<ScriptOutput, { kind: 'log' }>;

export interface LocalRunOptions {
  scene: SceneDescription;
  clientScripts: Record<string, string>;
  sandbox: ScriptSandbox;
  /** Haptic, remote, audio and spawn effects of client handlers. */
  onOutput?(output: EffectOutput, script: string): void;
  /** A client script that failed to load (syntax error, unknown handler). */
  onLoadError?(script: string, message: string): void;
  /** Every USIS packet, `source` included (only the debug panel and Packets tab see it). */
  onPacket?(packet: UsisPacket): void;
  now?: () => number;
  devices?: SimDevicesOptions;
}

/** Simulated devices -> InputBus (source stripped) -> SceneEvents -> client scripts in the sandbox. */
export class LocalRun {
  readonly devices: SimDevices;
  readonly entities: WorldEntity[];
  private bus = new InputBus();
  private events: SceneEvents;
  private now: () => number;
  private headStamps: number[] = [];
  private pendingSince: number | null = null;
  private lastStep: number;
  private busy = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Time from the first packet since the previous step to the last handler returning, for the last step that fired events. */
  latencyMs: number | null = null;

  constructor(private options: LocalRunOptions) {
    this.now = options.now ?? (() => performance.now());
    this.events = new SceneEvents(options.scene);
    this.entities = this.events.entities;
    this.devices = new SimDevices((p) => this.ingest(p), { ...options.devices, now: this.now });
    this.lastStep = this.now();
  }

  /** Loads every client script; a bad one is reported and skipped, the rest still run. */
  async load(): Promise<void> {
    for (const [name, source] of Object.entries(this.options.clientScripts)) {
      try {
        await this.options.sandbox.loadScript(name, source);
      } catch (e) {
        this.options.onLoadError?.(name, e instanceof Error ? e.message : String(e));
      }
    }
  }

  /** Starts the 50 Hz device stream and the 20 ms step loop. */
  start(): void {
    this.devices.start();
    this.lastStep = this.now();
    this.timer = setInterval(() => void this.step(), 20);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.devices.stop();
    this.options.sandbox.dispose();
  }

  ingest(packet: UsisPacket): void {
    const at = this.now();
    this.pendingSince ??= at;
    if (packet.slot === 'head') this.headStamps.push(at);
    this.bus.ingest(packet, at);
    this.options.onPacket?.(packet);
  }

  /** Head packets in the last second. */
  get rateHz(): number {
    const cutoff = this.now() - 1000;
    while (this.headStamps.length && this.headStamps[0]! < cutoff) this.headStamps.shift();
    return this.headStamps.length;
  }

  /** One tick: derive events from the latest input and run the matching client handlers. Skipped while the previous tick is still running. */
  async step(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const at = this.now();
      const dt = at - this.lastStep;
      this.lastStep = at;
      const started = this.pendingSince ?? at;
      this.pendingSince = null;
      const events = this.events.step(this.bus.frame(at), dt);
      for (const ev of events) await this.dispatch(ev.handler, ev.args, ev.entity, ev.intensity);
      if (events.length) this.latencyMs = Math.max(0, Math.round(this.now() - started));
    } finally {
      this.busy = false;
    }
  }

  /** `onRemote` on every scripted entity (a frame from the server). */
  async deliverRemote(name: string, data: unknown): Promise<void> {
    await this.dispatch('onRemote', [name, data]);
  }

  /** Calls `handler` on the scripted entity `entity`, or on every scripted entity when it is undefined. */
  private async dispatch(handler: string, args: unknown[], entity?: string, intensity?: number): Promise<void> {
    for (const e of entity === undefined ? this.entities : this.entities.filter((x) => x.id === entity)) {
      const script = scriptName(e);
      if (!script) continue;
      const result = await this.options.sandbox.call({
        script, handler, args, entity: { id: e.id, name: e.name, position: e.position },
        ...(intensity !== undefined ? { intensity } : {}),
      });
      for (const o of result.outputs) this.options.onOutput?.(o, script);
    }
  }
}

/** The 3D viewport panel's canvas, kept outside the panel so a re-created panel (layout load) reattaches to the same state. */
export class ViewportHost {
  private viewport: Viewport | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private raf = 0;
  private observer: ResizeObserver | null = null;
  private entities: WorldEntity[] = [];
  private selected: string | null = null;
  private running: { devices: SimDevices; origin: readonly [number, number, number] } | null = null;
  private detachInput: (() => void)[] = [];

  /** Returns an error sentence when WebGL is unavailable. */
  attach(canvas: HTMLCanvasElement): string | undefined {
    this.detach();
    try {
      this.viewport = new Viewport(canvas, readViewportColors());
    } catch {
      return 'WebGL is not available, so the viewport cannot draw. Turn on hardware acceleration in your browser and reload.';
    }
    this.canvas = canvas;
    this.viewport.setScene(this.entities);
    this.viewport.select(this.selected);
    this.observer = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      this.viewport?.resize(Math.max(1, canvas.clientWidth * dpr), Math.max(1, canvas.clientHeight * dpr));
    });
    this.observer.observe(canvas);
    this.bindInput();
    const frame = () => {
      if (!this.viewport) return;
      if (this.running) {
        const { yaw, pitch } = this.running.devices.headLook;
        this.viewport.setHeadPose({ position: this.running.origin, orientation: quat.fromYawPitch(yaw, pitch) });
      }
      this.viewport.render();
      this.raf = requestAnimationFrame(frame);
    };
    frame();
    return undefined;
  }

  detach(): void {
    cancelAnimationFrame(this.raf);
    this.observer?.disconnect();
    this.unbindInput();
    this.viewport?.dispose();
    this.viewport = null;
    this.canvas = null;
  }

  setScene(entities: WorldEntity[]): void {
    this.entities = entities;
    this.viewport?.setScene(entities);
  }

  select(id: string | null): void {
    this.selected = id;
    this.viewport?.select(id);
  }

  refreshColors(): void {
    this.viewport?.setColors(readViewportColors());
  }

  /** While running, the camera follows the virtual AirPods and the canvas takes mouse-look and key input. */
  setRunning(devices: SimDevices | null, origin: readonly [number, number, number] = [0, 1.6, 0]): void {
    this.running = devices ? { devices, origin } : null;
    if (!devices) this.viewport?.setHeadPose(null);
    this.bindInput();
  }

  private unbindInput(): void {
    this.detachInput.forEach((d) => d());
    this.detachInput = [];
    this.canvas?.setAttribute('data-running', 'false');
  }

  private bindInput(): void {
    this.unbindInput();
    const canvas = this.canvas;
    const run = this.running;
    if (!canvas || !run) return;
    canvas.setAttribute('data-running', 'true');
    const step = (5 * Math.PI) / 180;
    const onKey = (e: KeyboardEvent) => {
      const { yaw, pitch } = run.devices.headLook;
      const delta: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
      const d = delta[e.key];
      if (!d) return;
      e.preventDefault();
      run.devices.setHeadLook(yaw + d[0], pitch + d[1]);
    };
    canvas.addEventListener('keydown', onKey);
    this.detachInput = [
      attachMouseLook(canvas, run.devices), attachGestureKeys(window, run.devices), () => canvas.removeEventListener('keydown', onKey),
    ];
  }
}

export type RunKind = 'local' | 'server' | 'join';

export interface RunStatus {
  kind: RunKind | null;
  text: string;
  rateHz: number;
  latencyMs: number | null;
  serverLatencyMs: number | null;
  /** null when unknown (a joined test player cannot read the owner-only debug stream). */
  players: number | null;
}

const IDLE: RunStatus = { kind: null, text: 'Stopped', rateHz: 0, latencyMs: null, serverLatencyMs: null, players: 0 };

export interface RunDeps {
  project: Project;
  debug: DebugStore;
  account: AccountController;
  viewport: ViewportHost;
  editor: EditorBus;
  /** A test player's tab is told the server moved to a newer version; it fetches and rejoins it. */
  onReload?(version: number): Promise<void> | void;
  /** Called with the panel to show when a run starts (the viewport). */
  reveal?(panelId: string): void;
}

export class RunController {
  status: RunStatus = IDLE;
  heartRate = 72;
  local: LocalRun | null = null;
  private play: ReconnectingSocket<PlayFrame> | null = null;
  private debugSocket: ReconnectingSocket<DebugEvent> | null = null;
  private statusTimer: ReturnType<typeof setInterval> | null = null;
  private sentAt: number | null = null;
  private testPlayers = 0;
  private listeners = new Set<() => void>();
  private haptic: (() => void)[] = [];

  constructor(private deps: RunDeps) {}

  get running(): boolean {
    return this.local !== null;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Subscribes to haptic effects (the Devices panel flashes its ring). */
  onHaptic(fn: () => void): () => void {
    this.haptic.push(fn);
    return () => (this.haptic = this.haptic.filter((h) => h !== fn));
  }

  private set(patch: Partial<RunStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const l of this.listeners) l();
  }

  private out(level: 'log' | 'warn' | 'error', text: string): void {
    this.deps.debug.addOutput(level, text);
  }

  async runLocal(): Promise<void> {
    await this.begin('local');
  }

  /** Publishes the draft as a new version, then joins /play as player 1 with the debug stream open. */
  async runServer(): Promise<void> {
    const { account, project } = this.deps;
    if (!account.account || !account.gameId) throw new Error('Sign in and pick a game in Account before running on the server.');
    this.stop();
    this.set({ kind: 'server', text: 'Publishing draft version' });
    try {
      const { version, published } = await account.publishIfChanged(project);
      this.out('log', published ? `Published version ${version} of ${account.game?.title ?? 'the game'}.` : `No changes since version ${version}, joining it.`);
      await this.begin('server', account.gameId, version);
    } catch (e) {
      this.stop();
      throw new Error(describeError(e, account.serverUrl));
    }
  }

  /** A test-player tab: join the latest or a pinned version without publishing or reading the debug stream. */
  async join(gameId: string, version: number): Promise<void> {
    await this.begin('join', gameId, version);
  }

  /** Opens another Studio tab that joins the same session as a different dev account. */
  addTestPlayer(): void {
    const { account, project } = this.deps;
    if (!project.gameId || !project.version) throw new Error('Run on server first so there is a published version to join.');
    this.testPlayers++;
    const base = account.account?.display_name || account.account?.subject || 'player';
    const params = new URLSearchParams({ join: project.gameId, version: String(project.version), as: `${base}-test${this.testPlayers}` });
    window.open(`${location.origin}${location.pathname}?${params}`, '_blank');
  }

  private async begin(kind: RunKind, gameId?: string, version?: number): Promise<void> {
    const { project, debug, editor, viewport, account } = this.deps;
    this.stop();
    editor.clearErrors();
    let scene: SceneDescription;
    try {
      scene = project.description();
    } catch (e) {
      this.out('error', `Scene is invalid: ${e instanceof Error ? e.message : String(e)}`);
      throw new Error('The scene is invalid, see Output.');
    }
    const sandbox = new ScriptSandbox({
      onLog: (entry) => {
        debug.addOutput(entry.level, entry.text, entry.script);
        if (entry.level === 'error' && entry.script) editor.reportError({ kind: 'client', name: entry.script }, entry.text);
      },
    });
    const run = new LocalRun({
      scene, sandbox, clientScripts: project.clientScripts,
      onPacket: (p) => debug.addPacket(p),
      onLoadError: (script, message) => {
        this.out('error', `${script}: ${message}`);
        editor.reportError({ kind: 'client', name: script }, message);
      },
      onOutput: (o, script) => this.handleOutput(o, script),
    });
    this.local = run;
    run.devices.setHeartRate(this.heartRate);
    await run.load();
    if (this.local !== run) return; // stopped while scripts were loading
    viewport.setRunning(run.devices, scene.playerOrigin);
    this.deps.reveal?.('viewport');
    run.start();
    this.out('log', `Run ${kind} started: ${Object.keys(project.clientScripts).length} client scripts, simulated AirPods, phone and watch at 50 Hz.`);

    if (kind !== 'local' && gameId) {
      const client = account.client;
      if (kind === 'server') {
        debug.setServerConnected(false);
        if (version !== undefined) debug.setServerVersion(version);
        this.debugSocket = client.openDebug(gameId);
        this.debugSocket.onMessage = (ev) => debug.handleDebugEvent(ev);
        this.debugSocket.onStatus = (s) => {
          debug.setServerConnected(s === 'open');
          if (s === 'open') this.refresh();
        };
      }
      this.play = client.openPlay(gameId, version === undefined ? {} : { version });
      this.play.onMessage = (frame) => void this.onFrame(frame);
      this.play.onStatus = (s) => this.out(s === 'open' ? 'log' : 'warn', s === 'open' ? 'Joined the server session.' : s === 'connecting' ? 'Connecting to the server session.' : 'Left the server session.');
    }
    this.statusTimer = setInterval(() => this.refresh(), 500);
    this.refresh(kind);
  }

  private refresh(kind: RunKind | null = this.status.kind): void {
    const run = this.local;
    if (!run) return;
    this.set({
      kind,
      text: kind === 'local' ? 'Running locally, simulated devices' : kind === 'server' ? 'Running on the server, simulated devices' : 'Joined as a test player, simulated devices',
      rateHz: run.rateHz,
      latencyMs: run.latencyMs,
      players: kind === 'local' ? 1 : kind === 'server' ? this.deps.debug.players.size : null,
    });
  }

  private handleOutput(o: EffectOutput, script: string): void {
    if (o.kind === 'haptic') {
      this.out('log', `haptic ${o.pattern} ${o.intensity}`);
      this.haptic.forEach((h) => h());
    } else if (o.kind === 'audio') this.out('log', `audio ${o.action} ${o.sound ?? ''} on ${o.entity}`.trim());
    else if (o.kind === 'spawn') this.out('log', `spawn ${o.name} (not simulated locally)`);
    else if (this.play) {
      if (this.play.send({ name: o.name, data: o.data })) this.sentAt = performance.now();
      else this.out('warn', `${script}: remote ${o.name} dropped, the server session is not open.`);
    } else this.out('log', `${script}: remote ${o.name} ${JSON.stringify(o.data)} (local run, no server)`);
  }

  private async onFrame(frame: PlayFrame): Promise<void> {
    if (frame.name === '_reload') {
      const version = (frame.data as { version?: number } | undefined)?.version;
      if (typeof version !== 'number') return this.out('log', 'Server scripts restarted on an unknown version. ctx.state was reset.');
      const { account } = this.deps;
      try {
        if (this.deps.onReload) await this.deps.onReload(version);
        else if (this.status.kind === 'server' && account.gameId) await this.begin('server', account.gameId, version); // owner: keep the project's own client scripts
        this.out('log', `Server scripts restarted on version ${version}. Rejoined with its client scripts.`);
      } catch (e) {
        this.out('error', `Could not rejoin version ${version}: ${describeError(e, account.serverUrl)}`);
      }
      return;
    }
    if (this.sentAt !== null) {
      this.set({ serverLatencyMs: Math.round(performance.now() - this.sentAt) });
      this.sentAt = null;
    }
    this.out('log', `received ${frame.name} ${JSON.stringify(frame.data)}`);
    await this.local?.deliverRemote(frame.name, frame.data);
  }

  stop(): void {
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.statusTimer = null;
    this.play?.close();
    this.debugSocket?.close();
    this.play = null;
    this.debugSocket = null;
    this.deps.debug.setServerConnected(false);
    const had = this.local;
    this.local?.stop();
    this.local = null;
    this.sentAt = null;
    this.deps.viewport.setRunning(null);
    this.set({ ...IDLE });
    if (had) this.out('log', 'Run stopped.');
  }
}

export function createViewportPanel(host: ViewportHost, run: RunController): PanelView {
  const root = el('div', { class: 'vp-host', role: 'region', 'aria-label': 'Viewport', tabindex: -1 });
  const canvas = el('canvas', {
    tabindex: 0,
    'aria-label': 'Viewport. While running: drag to look, arrow keys turn the head, and T, F and P send tap, flick and pinch from anywhere outside text fields.',
  });
  const overlay = el('div', { class: 'vp-overlay', 'aria-hidden': 'true' });
  root.append(canvas, overlay);
  const problem = host.attach(canvas);
  if (problem) root.prepend(el('div', { class: 'om-issue', role: 'alert' }, [icon('warn'), el('p', {}, [problem])]));
  const show = () => {
    const look = run.local?.devices.headLook;
    overlay.textContent = look
      ? `Head yaw ${Math.round((look.yaw * 180) / Math.PI)} deg, pitch ${Math.round((look.pitch * 180) / Math.PI)} deg`
      : 'Editor camera';
  };
  const timer = setInterval(show, 100);
  show();
  return { element: root, focus: () => canvas.focus(), dispose: () => (clearInterval(timer), host.detach()) };
}

export function createDevicesPanel(run: RunController): PanelView {
  const root = el('div', { class: 'pn', role: 'region', 'aria-label': 'Devices', tabindex: -1 });
  const devices = () => run.local?.devices;
  const group = (t: string) => el('div', { class: 'pn-group' }, [t]);
  const item = (ic: string, name: string, slot: string, state: string) =>
    el('li', {}, [icon(ic), el('span', { class: 'om-name' }, [name, el('span', { class: 'om-sub' }, [slot])]), el('span', { class: state === 'Stopped' ? 'om-state om-state--stale' : 'om-state' }, [state])]);

  const yaw = el('input', { type: 'range', min: -180, max: 180, value: 0, 'aria-label': 'Head yaw in degrees' });
  const pitch = el('input', { type: 'range', min: -89, max: 89, value: 0, 'aria-label': 'Head pitch in degrees' });
  const yawOut = el('output', {}, ['0 deg']);
  const pitchOut = el('output', {}, ['0 deg']);
  const look = () => devices()?.setHeadLook((Number(yaw.value) * Math.PI) / 180, (Number(pitch.value) * Math.PI) / 180);
  yaw.addEventListener('input', look);
  pitch.addEventListener('input', look);

  const bpm = el('input', { type: 'range', min: 40, max: 200, value: run.heartRate, 'aria-label': 'Heart rate in beats per minute' });
  const bpmOut = el('output', {}, [`${run.heartRate} bpm`]);
  bpm.addEventListener('input', () => {
    run.heartRate = Number(bpm.value);
    bpmOut.textContent = `${bpm.value} bpm`;
    devices()?.setHeartRate(run.heartRate);
  });

  const gestures = el('div', { class: 'sw-presets', style: 'display:flex;flex-wrap:wrap;gap:4px;padding-top:4px' });
  const gestureButtons = ([['Tap (T)', 'tap'], ['Flick (F)', 'flick'], ['Pinch (P)', 'pinch'], ['Double tap', 'doubleTap'], ['Squeeze', 'squeeze']] as const).map(([label, type]) => {
    const b = button(label, () => devices()?.gesture(type, type === 'flick' ? [1, 0, 0] : undefined), { variant: 'small' });
    gestures.append(b);
    return b;
  });

  const haptic = el('div', { class: 'om-haptic', role: 'img', 'aria-label': 'Haptic output' }, [icon('phone')]);
  const row = (label: string, input: HTMLElement, out: HTMLElement) => el('div', { class: 'sw-hr', style: 'display:grid;grid-template-columns:72px minmax(0,1fr) 52px;align-items:center;gap:8px;font-size:11px;color:var(--text-secondary);min-height:var(--row-height)' }, [label, input, out]);
  const note = el('p', { class: 'pn-empty' });

  const render = () => {
    const on = run.running;
    note.textContent = on ? '' : 'Devices are simulated inside this page. Press Run local to start them at 50 Hz.';
    gestureButtons.forEach((b) => (b.disabled = !on));
    yaw.disabled = pitch.disabled = !on;
    const rate = on ? '50 Hz' : 'Stopped';
    root.replaceChildren(
      group('Simulator'),
      el('ul', { class: 'om-list', 'aria-label': 'Virtual devices' }, [
        item('airpods', 'Virtual AirPods', 'head', rate), item('phone', 'Virtual phone', 'hand', on ? 'Keys T, F, P' : 'Stopped'), item('watch', 'Virtual watch', 'leftWrist', on ? '50 Hz' : 'Stopped'),
      ]),
      note,
      el('div', { class: 'om-section-body' }, [
        el('div', { class: 'headline' }, ['Virtual AirPods']), row('Yaw', yaw, yawOut), row('Pitch', pitch, pitchOut),
        el('div', { class: 'headline', style: 'margin-top:8px' }, ['Virtual phone']), gestures,
        el('div', { class: 'headline', style: 'margin-top:8px' }, ['Virtual watch']), row('Heart rate', bpm, bpmOut),
        el('div', { class: 'om-inline', style: 'margin-top:8px' }, [haptic, el('span', { class: 'om-secondary' }, ['Haptic output'])]),
      ]),
    );
  };
  // Mouse-look moves the head too: mirror it into the sliders, and keep the rate readout current.
  const sync = () => {
    const h = devices()?.headLook;
    if (h && document.activeElement !== yaw && document.activeElement !== pitch) {
      yaw.value = String(Math.round((h.yaw * 180) / Math.PI));
      pitch.value = String(Math.round((h.pitch * 180) / Math.PI));
    }
    yawOut.textContent = `${yaw.value} deg`;
    pitchOut.textContent = `${pitch.value} deg`;
  };
  const offHaptic = run.onHaptic(() => {
    haptic.classList.remove('is-firing');
    void haptic.offsetWidth;
    haptic.classList.add('is-firing');
  });
  let wasRunning = run.running;
  const offRun = run.onChange(() => {
    if (wasRunning !== run.running) {
      wasRunning = run.running;
      render();
    }
  });
  const timer = setInterval(sync, 200);
  render();
  return { element: root, focus: () => (root.querySelector<HTMLElement>('input, button:not(:disabled)') ?? root).focus(), dispose: () => (clearInterval(timer), offHaptic(), offRun()) };
}
