// Run: Run local (runtime + sandbox + sim devices in this page), Run on server (publish a draft version, join
// /play as player 1), Add test player (another tab), Stop. `LocalRun` has no DOM so the e2e test drives it in Node.
// Simulated USIS packets never leave this page (Network Rule); only remote events reach /play.
import { CloudClient, type DebugEvent, type PlayFrame, type ReconnectingSocket } from '@pear/cloud';
import { quat, type UsisPacket } from '@pear/core';
import {
  InputBus, SceneEvents, Viewport, readViewportColors, scriptName,
  type SceneDescription, type WorldEntity,
} from '@pear/runtime';
import { LocalServer, ScriptSandbox, type ScriptOutput } from '@pear/script';
import prelude from '../../../Packages/PearScript/Sources/PearScript/Resources/prelude.js?raw';
import { SIM_DEVICE_KINDS, SimDevices, UsisPlayer, attachGestureKeys, attachMouseLook, type SimDeviceKind, type SimDevicesOptions } from '@pear/sim';
import type { AccountController } from './account';
import { describeError } from './account';
import type { DebugStore } from './debug-panel';
import type { EditorBus } from './editor';
import type { PanelView } from './layout';
import { rigFor } from './needs';
import { RelayClient } from './relay';
import type { Project } from './project';
import { el, icon } from './ui';

/** `onTick` rate: 5 Hz, enough to report a position without flooding the worker. */
const TICK_MS = 200;

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
  /** Live source: packets come from `ingest` (the relay), not the manual devices. */
  live = false;
  /** Local Play only: multiplies the dt that events and `onTick` see. */
  timeScale = 1;
  private tickMs = 0;
  private position: readonly [number, number, number];
  private accuracy: number | null = null;
  /** This player's id on the game server; set by the `_welcome` frame, null in a local run without a server. */
  playerId: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Time from the first packet since the previous step to the last handler returning, for the last step that fired events. */
  latencyMs: number | null = null;

  constructor(private options: LocalRunOptions) {
    this.now = options.now ?? (() => performance.now());
    this.events = new SceneEvents(options.scene);
    this.entities = this.events.entities;
    this.devices = new SimDevices((p) => {
      if (this.player || this.live) return; // Replay and Live sources: the manual devices stay silent
      this.rec?.push(p);
      this.ingest(p);
    }, { ...options.devices, now: this.now });
    this.lastStep = this.now();
    this.position = options.scene.playerOrigin;
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
    this.player?.stop();
    this.devices.stop();
    this.options.sandbox.dispose();
  }

  /** The last finished recording (or loaded file) of this player's sim packets, `t` from 0. Kept in memory only. */
  clip: UsisPacket[] | null = null;
  private rec: UsisPacket[] | null = null;
  private player: UsisPlayer | null = null;
  get recording(): boolean { return this.rec !== null; }
  get replaying(): boolean { return this.player !== null; }

  /** Captures the packets the manual devices emit; stopping keeps them as `clip`. */
  toggleRecord(): void {
    if (this.rec) {
      const t0 = this.rec[0]?.t ?? 0;
      this.clip = this.rec.length ? this.rec.map((p) => ({ ...p, t: p.t - t0 })) : this.clip;
      this.rec = null;
    } else this.rec = [];
  }

  /** Loops `clip` into this player's input instead of its manual devices; null goes back to manual. Packets stay in the page. */
  replay(on: boolean): void {
    this.player?.stop();
    this.player = on && this.clip ? new UsisPlayer(this.clip, (p) => this.ingest(p), { loop: true, now: this.now }) : null;
    this.player?.start();
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
      const dt = (at - this.lastStep) * this.timeScale;
      this.lastStep = at;
      const started = this.pendingSince ?? at;
      this.pendingSince = null;
      const frame = this.bus.frame(at);
      const head = frame.devices.find((d) => d.slot === 'head');
      const phone = frame.devices.find((d) => d.kind === 'phone' && d.position);
      if (phone?.position) { this.position = phone.position; this.accuracy = phone.accuracy ?? null; }
      else if (head?.position) { this.position = head.position; this.accuracy = null; }
      const events = this.events.step(frame, dt);
      for (const ev of events) await this.dispatch(ev.handler, ev.args, ev.entity, ev.intensity);
      this.tickMs += dt;
      if (this.tickMs >= TICK_MS) {
        const seconds = this.tickMs / 1000;
        this.tickMs = 0;
        await this.dispatch('onTick', [seconds]);
      }
      if (events.length) this.latencyMs = Math.max(0, Math.round(this.now() - started));
    } finally {
      this.busy = false;
    }
  }

  /** `onRemote` on every scripted entity (a frame from the server). */
  async deliverRemote(name: string, data: unknown): Promise<void> {
    if (name === '_welcome' && typeof data === 'object' && data !== null && typeof (data as { id?: unknown }).id === 'string') {
      this.playerId = (data as { id: string }).id;
    }
    await this.dispatch('onRemote', [name, data]);
  }

  /** Calls `handler` on the scripted entity `entity`, or on every scripted entity when it is undefined. */
  private async dispatch(handler: string, args: unknown[], entity?: string, intensity?: number): Promise<void> {
    for (const e of entity === undefined ? this.entities : this.entities.filter((x) => x.id === entity)) {
      const script = scriptName(e);
      if (!script) continue;
      const result = await this.options.sandbox.call({
        script, handler, args, entity: { id: e.id, name: e.name, position: e.position },
        playerId: this.playerId,
        position: this.options.scene.permissions.location ? this.position : null,
        positionAccuracy: this.options.scene.permissions.location ? this.accuracy : null,
        ...(intensity !== undefined ? { intensity } : {}),
      });
      for (const o of result.outputs) this.options.onOutput?.(o, script);
    }
  }
}

/** WASD walk: forward follows the head yaw (positive yaw turns left, forward at yaw 0 is -Z), xz plane only, 1.5 m/s. */
export function stepPosition(
  pos: readonly [number, number, number], yaw: number, keys: ReadonlySet<string>, dtSeconds: number, speed = 1.5,
): [number, number, number] {
  const f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  const r = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  if (!f && !r) return [pos[0], pos[1], pos[2]];
  const k = (speed * dtSeconds) / Math.hypot(f, r);
  const [s, c] = [Math.sin(yaw), Math.cos(yaw)];
  return [pos[0] + (-s * f + c * r) * k, pos[1], pos[2] + (-c * f - s * r) * k];
}

type PlayClient = Pick<LocalRun, 'deliverRemote'>;

/** In-memory channel for Play: the server's fire(null) reaches every client, fire(id) one client. */
export function createPlayServer(
  clients: Map<string, PlayClient>, o: Omit<ConstructorParameters<typeof LocalServer>[0], 'prelude' | 'onFire'>,
): LocalServer {
  return new LocalServer({
    ...o, prelude,
    onFire: (player, name, data) => {
      for (const [id, c] of clients) if (player === null || player === id) void c.deliverRemote(name, data).catch(() => {});
    },
  });
}

/** Registers a client, sends its `_welcome {id, name}` frame, then runs the server's onPlayerJoin. */
export function joinPlay(server: LocalServer, clients: Map<string, PlayClient>, id: string, name: string, client: PlayClient): void {
  clients.set(id, client);
  void client.deliverRemote('_welcome', { id, name }).catch(() => {});
  server.join(id, name);
}

/** KeyboardEvent.code -> [forward, right, up]. Codes, not letters, so WASD stays put on other keyboard layouts. */
const FLY_KEYS: Record<string, readonly [number, number, number]> = {
  KeyW: [1, 0, 0], KeyS: [-1, 0, 0], KeyD: [0, 1, 0], KeyA: [0, -1, 0], KeyE: [0, 0, 1], KeyQ: [0, 0, -1],
};
const FLY_SPEED = 6; // world units per second

/** The 3D viewport panel's canvas, kept outside the panel so a re-created panel (layout load) reattaches to the same state. */
export class ViewportHost {
  private viewport: Viewport | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private raf = 0;
  private observer: ResizeObserver | null = null;
  private entities: WorldEntity[] = [];
  private selected: string | null = null;
  private running: { devices: SimDevices } | null = null;
  private detachInput: (() => void)[] = [];
  private flyKeys = new Set<string>();
  private flyFast = false;
  /** Markers for the players the creator is not driving, while running. */
  others: () => { id: string; position: readonly [number, number, number] }[] = () => [];
  /** Click on the canvas while stopped: the entity under the pointer, or null for empty space. */
  onPick?: (id: string | null) => void;
  /** Set by the composition root: the selected entity (left-drag on it slides it on the ground) and where it was dropped. */
  selectedId: () => string | null = () => null;
  onMove?: (id: string, x: number, z: number) => void;
  entityY?: (id: string) => number | undefined;

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
    this.bindCamera(canvas);
    this.bindInput();
    let last = performance.now();
    const frame = () => {
      if (!this.viewport) return;
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000); // cap so a stalled tab does not teleport the camera
      this.flyStep(dt);
      last = now;
      if (this.running) {
        const { devices } = this.running;
        const { yaw, pitch } = devices.headLook;
        // keys are only tracked while the canvas has focus (onkeyup/onblur clear them)
        const p = stepPosition(devices.position, yaw, this.flyKeys, dt);
        devices.setPosition(p[0], p[1], p[2]);
        this.viewport.setHeadPose({ position: devices.position, orientation: quat.fromYawPitch(yaw, pitch) });
        this.viewport.setPlayers([{ id: 'you', position: devices.position, self: true }, ...this.others()]);
      }
      this.viewport.render();
      this.raf = requestAnimationFrame(frame);
    };
    frame();
    return undefined;
  }

  /**
   * Editor camera: right drag rotates (Alt: only around the vertical axis), middle drag pans (Shift+left drag too, for
   * trackpads), wheel zooms, a left click that barely moved picks.
   * While running, a click is mouse-look and the camera follows the head, so all of it is off.
   */
  private bindCamera(canvas: HTMLCanvasElement): void {
    let drag: { mode: 'pan' | 'rotate' | 'none'; moved: number; button: number; move?: { id: string; y: number } } | null = null;
    const ndc = (e: PointerEvent): [number, number] => { const r = canvas.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2]; };
    const CLICK_SLOP_PX = 4;
    canvas.onpointerdown = (e) => {
      if (this.running || !this.viewport) return;
      const mode = e.button === 1 || (e.button === 0 && e.shiftKey) ? 'pan' : e.button === 2 ? 'rotate' : 'none';
      drag = { mode, moved: 0, button: e.button };
      const sel = this.selectedId();
      if (mode === 'none' && e.button === 0 && sel && this.viewport.pick(...ndc(e)) === sel) {
        const y = this.entityY?.(sel);
        if (y !== undefined) drag.move = { id: sel, y };
      }
      canvas.setPointerCapture(e.pointerId);
      if (e.button === 1) e.preventDefault(); // no middle-click autoscroll
    };
    canvas.onpointermove = (e) => {
      if (!drag || !this.viewport) return;
      drag.moved += Math.abs(e.movementX) + Math.abs(e.movementY);
      if (drag.move) {
        if (drag.moved < CLICK_SLOP_PX) return;
        const p = this.viewport.groundPoint(...ndc(e), drag.move.y);
        if (p) this.onMove?.(drag.move.id, Math.round(p[0] * 20) / 20, Math.round(p[2] * 20) / 20); // 5 cm grid
        return;
      }
      if (drag.mode === 'pan') this.viewport.panBy(e.movementX, e.movementY);
      else if (drag.mode === 'rotate') this.viewport.orbitBy(e.movementX, e.altKey ? 0 : e.movementY);
    };
    canvas.onpointerup = (e) => {
      const d = drag;
      drag = null;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      if (!d || !this.viewport || d.button !== 0 || d.mode !== 'none' || d.moved >= CLICK_SLOP_PX) return; // a drag that moved an entity ends here too
      const r = canvas.getBoundingClientRect();
      this.onPick?.(this.viewport.pick(((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2));
    };
    canvas.onpointercancel = () => (drag = null);
    canvas.oncontextmenu = (e) => e.preventDefault();
    canvas.onwheel = (e) => {
      if (this.running || !this.viewport) return;
      e.preventDefault();
      this.viewport.zoomBy(e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY); // deltaMode 1 = lines
    };
    canvas.onkeydown = (e) => {
      this.flyFast = e.shiftKey;
      if (this.running) { // WASD walks the player while running; flyKeys doubles as the held-key set
        if ('KeyW KeyA KeyS KeyD'.includes(e.code) && !e.ctrlKey && !e.metaKey && !e.altKey) (e.preventDefault(), this.flyKeys.add(e.code));
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code in FLY_KEYS) {
        e.preventDefault();
        this.flyKeys.add(e.code);
      } else if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        this.frameSelected();
      }
    };
    canvas.onkeyup = (e) => {
      this.flyFast = e.shiftKey;
      this.flyKeys.delete(e.code);
    };
    canvas.onblur = () => this.flyKeys.clear(); // a key released after focus left would stay held
  }

  /** Per-frame WASD / QE flight in the editor camera; Shift is fast. */
  private flyStep(dtSeconds: number): void {
    if (this.running || !this.viewport || this.flyKeys.size === 0) return;
    let forward = 0, right = 0, up = 0;
    for (const code of this.flyKeys) {
      const [f, r, u] = FLY_KEYS[code]!;
      forward += f;
      right += r;
      up += u;
    }
    this.viewport.fly(Math.sign(forward), Math.sign(right), Math.sign(up), FLY_SPEED * dtSeconds * (this.flyFast ? 3 : 1));
  }

  resetCamera(): void {
    this.viewport?.resetCamera();
  }

  /** Returns false when nothing is selected. */
  frameSelected(): boolean {
    return this.viewport?.frameSelected() ?? false;
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

  /** While running, the camera follows the driven player's virtual AirPods and the canvas takes mouse-look and key input. `origin` places that player; omitted, it stays where it is (switching drivers). */
  setRunning(devices: SimDevices | null, origin?: readonly [number, number, number]): void {
    this.running = devices ? { devices } : null;
    if (devices && origin) devices.setPosition(origin[0], origin[1], origin[2]);
    else (this.viewport?.setHeadPose(null), this.viewport?.setPlayers([]));
    this.flyKeys.clear();
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

export type PlayerSource = 'manual' | 'replay' | 'live' | 'bot';
export type BotMode = 'chase' | 'flee' | 'gestures';
export const TIME_SCALES = [0.5, 1, 2, 4] as const;

/** One player in a running test. `hapticAt` is when its scripts last sent a haptic (ms since epoch, 0 = never). */
export interface TestPlayer {
  id: string;
  name: string;
  run: LocalRun;
  wander: boolean;
  source: PlayerSource;
  botMode: BotMode;
  /** Bot gestures: seconds between gestures, and seconds left until the next. */
  botEvery: number;
  botLeft: number;
  /** Relay device ids feeding this player while the source is Live. */
  liveDevices: Set<string>;
  lastEvent: string | null;
  hapticAt: number;
  socket?: ReconnectingSocket<PlayFrame>;
}

export const SIM_DEVICE_NAMES: Record<SimDeviceKind, string> = { airpods: 'AirPods', phone: 'phone', watch: 'watch' };

const playerDefaults = () => ({ source: 'manual' as PlayerSource, botMode: 'chase' as BotMode, botEvery: 2, botLeft: 2, liveDevices: new Set<string>() });

const IDLE: RunStatus ={ kind: null, text: 'Stopped', rateHz: 0, latencyMs: null, serverLatencyMs: null, players: 0 };

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

const RIG_KEY = 'pear.studio.rig';
const loadRig = (): SimDeviceKind[] => {
  try {
    const saved = JSON.parse(localStorage.getItem(RIG_KEY) ?? 'null');
    if (Array.isArray(saved)) return SIM_DEVICE_KINDS.filter((k) => saved.includes(k));
  } catch { /* no storage: default rig */ }
  return [...SIM_DEVICE_KINDS];
};

/** Capability hint: what the game's tier needs from the simulated rig, or null when it is met. */
export function rigWarning(tier: unknown, rig: readonly SimDeviceKind[]): string | null {
  const t = typeof tier === 'number' ? tier : 1;
  if (t >= 2 && !rig.includes('airpods')) return 'Tier 2 needs position: add the AirPods head device.';
  if (t >= 3 && !rig.includes('watch')) return 'Tier 3 needs heart rate: add the Watch.';
  return null;
}

export class RunController {
  status: RunStatus = IDLE;
  /** Virtual devices the creator chose; a new session starts with all three. Remembered in this browser, not in the project. */
  rig: SimDeviceKind[] = loadRig();
  setRig(rig: SimDeviceKind[]): void {
    this.rig = rig;
    try { localStorage.setItem(RIG_KEY, JSON.stringify(rig)); } catch { /* not persisted */ }
    for (const { run: { devices: d } } of this.players) for (const k of SIM_DEVICE_KINDS) rig.includes(k) ? d.addDevice(k) : d.removeDevice(k);
    for (const l of this.listeners) l();
  }
  /** Everyone in the running test: the creator's own player first, then added players. Empty while stopped. */
  players: TestPlayer[] = [];
  /** The player whose devices the keyboard, mouse and Test panel controls drive. */
  driven: string | null = null;
  get drivenPlayer(): TestPlayer | undefined {
    return this.players.find((p) => p.id === this.driven);
  }
  heartRate = 72;
  /** Local Play only (server time is the server's); applied to every run's dt, wander and bots. */
  timeScale = 1;
  readonly relay = new RelayClient();
  local: LocalRun | null = null;
  private play: ReconnectingSocket<PlayFrame> | null = null;
  private debugSocket: ReconnectingSocket<DebugEvent> | null = null;
  private statusTimer: ReturnType<typeof setInterval> | null = null;
  private sentAt: number | null = null;
  private testPlayers = 0;
  private listeners = new Set<() => void>();
  /** Play: the in-page server and every client it can reach (all test players). */
  private server: LocalServer | null = null;
  private clients = new Map<string, PlayClient>();
  private playerCount = 0;
  private wanderTimer: ReturnType<typeof setInterval> | null = null;
  private session: { scene: SceneDescription; gameId?: string; version?: number } | null = null;

  constructor(private deps: RunDeps) {
    this.relay.onChange = () => { for (const l of this.listeners) l(); };
    this.relay.onPacket = (device, packet) => {
      for (const p of this.players) if (p.source === 'live' && p.liveDevices.has(device)) p.run.ingest({ ...packet, source: 'live' });
    };
    deps.viewport.others = () => this.players.filter((p) => p.id !== this.driven).map((p) => ({ id: p.id, position: p.run.devices.position }));
  }

  /** Sends keyboard, mouse and Test panel input to this player; the camera follows its head. */
  drive(id: string): void {
    const p = this.players.find((x) => x.id === id);
    if (!p) return;
    this.driven = id;
    this.deps.viewport.setRunning(p.run.devices);
    for (const l of this.listeners) l();
  }

  /** Places a player on the ground (Test panel map drag). */
  movePlayer(id: string, x: number, z: number): void {
    const d = this.players.find((p) => p.id === id)?.run.devices;
    if (d && Number.isFinite(x) && Number.isFinite(z)) d.setPosition(x, d.position[1], z); // a zero-size map yields NaN / Infinity
  }

  /** A wandering player random-walks and gestures on its own while the creator drives someone else. */
  setWander(id: string, on: boolean): void {
    const p = this.players.find((x) => x.id === id);
    if (p) p.wander = on;
    for (const l of this.listeners) l();
  }

  /** Record toggle, Source select and clip load for one player; the Test panel redraws on the change. */
  recordPlayer(id: string): void {
    this.players.find((p) => p.id === id)?.run.toggleRecord();
    for (const l of this.listeners) l();
  }

  /** Returns an error sentence when Replay has no clip to play. Live connects to the relay; Bot runs this player's behavior. */
  setSource(id: string, source: PlayerSource): string | undefined {
    const p = this.players.find((x) => x.id === id);
    if (!p) return undefined;
    if (source === 'replay' && !p.run.clip) return 'Record a clip or load a .usis.jsonl file first.';
    p.run.replay(source === 'replay');
    p.run.live = source === 'live';
    if (source === 'live') this.relay.connect();
    p.source = source;
    for (const l of this.listeners) l();
    return undefined;
  }

  /** Feeds this player from (or stops feeding it from) one relay device. */
  setLiveDevice(id: string, deviceId: string, on: boolean): void {
    const p = this.players.find((x) => x.id === id);
    if (p) on ? p.liveDevices.add(deviceId) : p.liveDevices.delete(deviceId);
    for (const l of this.listeners) l();
  }

  setBot(id: string, mode: BotMode, every: number): void {
    const p = this.players.find((x) => x.id === id);
    if (p) (p.botMode = mode, p.botEvery = Math.max(0.2, every || 2), p.botLeft = p.botEvery);
    for (const l of this.listeners) l();
  }

  setTimeScale(n: number): void {
    this.timeScale = n;
    this.applyScale();
    for (const l of this.listeners) l();
  }

  /** Only a Play with its own in-page server runs on this page's clock. */
  private applyScale(): void {
    for (const p of this.players) p.run.timeScale = this.server ? this.timeScale : 1;
  }

  loadClip(id: string, packets: UsisPacket[]): void {
    const run = this.players.find((p) => p.id === id)?.run;
    const p = this.players.find((x) => x.id === id);
    if (run) (run.clip = packets, run.replay(true), run.live = false);
    if (p && run) p.source = 'replay';
    for (const l of this.listeners) l();
  }

  /** Removes an added player; the creator's own player (the first) stays until Stop. */
  removePlayer(id: string): void {
    const i = this.players.findIndex((p) => p.id === id);
    if (i <= 0) return;
    const [p] = this.players.splice(i, 1);
    p!.socket?.close();
    p!.run.stop();
    if (this.clients.delete(id)) (this.server?.leave(id), this.deps.debug.handleDebugEvent({ kind: 'leave', t: Date.now(), player: id }));
    if (this.driven === id) this.drive(this.players[0]!.id);
    this.out('log', `Removed ${id}.`);
    this.refresh();
  }

  /** Wraps a run so the Test panel sees the last remote event each player received. */
  private tracked(p: TestPlayer): PlayClient {
    return { deliverRemote: (name, data) => ((p.lastEvent = name), p.run.deliverRemote(name, data)) };
  }

  sceneTier(): unknown {
    return this.deps.project.scene.requiredTier;
  }

  get running(): boolean {
    return this.local !== null;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
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
    // A game that declares its inputs gets exactly the devices that provide them (not saved: the browser's own choice stays for games that do not).
    if (scene.inputs || Object.keys(scene.gestures).length) this.rig = rigFor(scene.inputs, scene.gestures);
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
      devices: { kinds: this.rig },
    });
    this.local = run;
    run.devices.setHeartRate(this.heartRate);
    await run.load();
    if (this.local !== run) return; // stopped while scripts were loading
    this.playerCount = 1;
    this.players = [{ id: 'player-1', name: account.account?.display_name || 'player-1', run, wander: false, ...playerDefaults(), lastEvent: null, hapticAt: 0 }];
    this.driven = 'player-1';
    viewport.setRunning(run.devices, scene.playerOrigin);
    this.deps.reveal?.('viewport');
    this.deps.reveal?.('test');
    run.start();
    this.wanderTimer = setInterval(() => this.wander(), 200);
    this.session = { scene, ...(gameId ? { gameId } : {}), ...(version !== undefined ? { version } : {}) };
    if (kind === 'local') this.startPlayServer(run);
    const rig = this.rig.length ? this.rig.map((k) => SIM_DEVICE_NAMES[k]).join(', ') : 'no devices';
    this.out('log', `Run ${kind} started: ${Object.keys(project.clientScripts).length} client scripts, simulated ${rig} at 50 Hz.`);

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
    // Play starts with the game's minimum players. Not on the server: added players there still share the creator's account (P8).
    const min = kind === 'local' ? scene.inputs?.players[0] ?? 1 : 1;
    this.applyScale();
    for (let i = 1; i < min && this.local === run; i++) await this.addPlayer();
  }

  /** Play: server scripts run in this page; the server's debug output goes to the same DebugStore rows /debug feeds. */
  private startPlayServer(run: LocalRun): void {
    const { project, debug, editor } = this.deps;
    const ev = (e: { kind: string; [k: string]: unknown }) => debug.handleDebugEvent({ t: Date.now(), ...e });
    const server = createPlayServer(this.clients, {
      onLog: (level, msg) => ev({ kind: 'log', level, msg }),
      onError: (msg) => ev({ kind: 'error', msg }),
      onState: (json) => ev({ kind: 'state', state: JSON.parse(json) }),
    });
    this.server = server;
    debug.setServerConnected(true);
    ev({ kind: 'snapshot', players: [], state: {}, logs: [] });
    for (const [name, source] of Object.entries(project.serverScripts)) {
      try {
        server.load([source]);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        this.out('error', `${name}: ${message}`);
        editor.reportError({ kind: 'server', name }, message);
      }
    }
    const me = this.players[0]!;
    this.joinLocal(me.id, me.name, this.tracked(me));
  }

  private joinLocal(id: string, name: string, client: PlayClient): void {
    joinPlay(this.server!, this.clients, id, name, client);
    this.deps.debug.handleDebugEvent({ kind: 'join', t: Date.now(), player: id });
  }

  /**
   * Another simulated player with its own sandbox and devices. It stands still, 3 m from the origin on a ring so players
   * do not overlap, until the creator drives it, drags it on the map or turns on Wander. In Play it joins the in-page
   * server; on the server it opens its own /play socket.
   */
  async addPlayer(): Promise<void> {
    const { project } = this.deps;
    const sess = this.session;
    if (!this.local || !sess) throw new Error('Press Play first, then add a player.');
    const n = this.playerCount + 1;
    const id = `player-${n}`;
    // On the server each player signs in as its own dev account, since the server keys players by account id.
    let name = id;
    let client: CloudClient | undefined;
    if (!this.server && sess.gameId) {
      const { account } = this.deps;
      name = `${account.account?.display_name || account.account?.subject || 'player'}-p${n}`;
      try {
        client = new CloudClient({ baseUrl: account.serverUrl });
        await client.signIn({ provider: 'dev', subject: name, display_name: name });
      } catch (e) {
        throw new Error(`Could not sign in ${name}: ${describeError(e, account.serverUrl)}`);
      }
      if (!this.local || this.session !== sess) return; // stopped while signing in
    }
    this.playerCount = n;
    const sandbox = new ScriptSandbox({ onLog: (e) => this.out(e.level, `[${id}] ${e.text}`) });
    const p: TestPlayer = { id, name, run: undefined as unknown as LocalRun, wander: false, ...playerDefaults(), lastEvent: null, hapticAt: 0 };
    p.run = new LocalRun({
      scene: sess.scene, sandbox, clientScripts: project.clientScripts,
      devices: { kinds: this.rig },
      onLoadError: (script, message) => this.out('error', `[${id}] ${script}: ${message}`),
      onOutput: (o) => {
        if (o.kind === 'haptic') (p.hapticAt = Date.now(), this.out('log', `[${id}] haptic ${o.pattern} ${o.intensity}`), this.sendHaptic(p, o.pattern, o.intensity));
        if (o.kind !== 'remote') return;
        if (this.server) this.server.remote(id, o.name, o.data);
        else p.socket?.send({ name: o.name, data: o.data });
      },
    });
    const run = p.run;
    await run.load();
    if (!this.local || this.session !== sess) return run.stop(); // stopped while loading
    const [ox, oy, oz] = sess.scene.playerOrigin;
    const a = ((n - 2) * Math.PI) / 3; // 6 spots per ring
    run.devices.setPosition(ox + 3 * Math.sin(a), oy, oz - 3 * Math.cos(a));
    run.devices.setHeartRate(this.heartRate);
    run.start();
    this.players.push(p);
    this.applyScale();
    if (this.server) this.joinLocal(id, id, this.tracked(p));
    else if (sess.gameId && client) {
      p.socket = client.openPlay(sess.gameId, sess.version === undefined ? {} : { version: sess.version });
      p.socket.onMessage = (frame) => { if (frame.name !== '_reload') void this.tracked(p).deliverRemote(frame.name, frame.data); };
    }
    this.out('log', `Added ${id}.`);
    this.refresh();
  }

  /** One wander or bot step for every wandering or bot player the creator is not driving. */
  private wander(): void {
    const scale = this.server ? this.timeScale : 1;
    for (const p of this.players) {
      if (p.id === this.driven) continue;
      if (p.source === 'bot') { this.bot(p, 0.2 * scale); continue; }
      if (!p.wander) continue;
      const d = p.run.devices;
      const [x, y, z] = d.position;
      const step = () => (Math.random() - 0.5) * 0.6 * scale;
      d.setPosition(Math.max(-10, Math.min(10, x + step())), y, Math.max(-10, Math.min(10, z + step())));
      if (Math.random() < 0.05 * scale) {
        const g = (['tap', 'flick', 'pinch'] as const)[Math.floor(Math.random() * 3)]!;
        d.gesture(g, g === 'flick' ? [1, 0, 0] : undefined);
      }
    }
  }

  /** Test-only behavior: walk toward or away from the nearest other player at 1.5 m/s, or gesture every `botEvery` s. Nothing is published. */
  private bot(p: TestPlayer, dt: number): void {
    const d = p.run.devices;
    if (p.botMode === 'gestures') {
      p.botLeft -= dt;
      if (p.botLeft > 0) return;
      p.botLeft = p.botEvery;
      const declared = this.session?.scene.inputs?.gestures;
      const list = declared?.length ? declared : (['tap', 'flick', 'pinch'] as const);
      const g = list[Math.floor(Math.random() * list.length)]!;
      d.gesture(g, g === 'flick' ? [1, 0, 0] : undefined);
      return;
    }
    const [x, y, z] = d.position;
    let near: { dx: number; dz: number; len: number } | null = null;
    for (const o of this.players) {
      if (o === p) continue;
      const dx = o.run.devices.position[0] - x, dz = o.run.devices.position[2] - z, len = Math.hypot(dx, dz);
      if (!near || len < near.len) near = { dx, dz, len };
    }
    if (!near || near.len < 0.01) return;
    const s = p.botMode === 'chase' ? Math.min(1.5 * dt, near.len) : -1.5 * dt;
    d.setPosition(Math.max(-10, Math.min(10, x + (near.dx / near.len) * s)), y, Math.max(-10, Math.min(10, z + (near.dz / near.len) * s)));
  }

  /** A Live player's haptic goes back to the phones feeding it. */
  private sendHaptic(p: TestPlayer, pattern: string, intensity: number): void {
    if (p.source !== 'live') return;
    for (const id of p.liveDevices) this.relay.sendOutput(id, { target: id, type: 'haptic', pattern, intensity: Math.max(0, Math.min(1, intensity)), durationMs: 120 });
  }

  private refresh(kind: RunKind | null = this.status.kind): void {
    const run = this.local;
    if (!run) return;
    this.set({
      kind,
      text: kind === 'local' ? 'Playing locally, simulated devices' : kind === 'server' ? 'Running on the server, simulated devices' : 'Joined as a test player, simulated devices',
      rateHz: run.rateHz,
      latencyMs: run.latencyMs,
      players: kind === 'local' ? this.clients.size : kind === 'server' ? this.deps.debug.players.size : null,
    });
  }

  private handleOutput(o: EffectOutput, script: string): void {
    if (o.kind === 'haptic') {
      this.out('log', `haptic ${o.pattern} ${o.intensity}`);
      if (this.players[0]) (this.players[0].hapticAt = Date.now(), this.sendHaptic(this.players[0], o.pattern, o.intensity));
    } else if (o.kind === 'audio') this.out('log', `audio ${o.action} ${o.sound ?? ''} on ${o.entity}`.trim());
    else if (o.kind === 'spawn') this.out('log', `spawn ${o.name} (not simulated locally)`);
    else if (this.server && this.local?.playerId) this.server.remote(this.local.playerId, o.name, o.data);
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
    const me = this.players[0];
    if (me) await this.tracked(me).deliverRemote(frame.name, frame.data);
  }

  stop(): void {
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.statusTimer = null;
    this.play?.close();
    this.debugSocket?.close();
    this.play = null;
    this.debugSocket = null;
    if (this.wanderTimer) clearInterval(this.wanderTimer);
    this.wanderTimer = null;
    for (const p of this.players.slice(1)) (p.socket?.close(), p.run.stop());
    this.players = [];
    this.driven = null;
    this.playerCount = 0;
    this.server?.dispose();
    this.server = null;
    this.clients.clear();
    this.session = null;
    this.relay.close();
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
    'aria-label': 'Viewport. While running: drag to look, arrow keys turn the head, and T, G, F, P and H send tap, double tap, flick, pinch and squeeze from anywhere outside text fields.',
  });
  const overlay = el('div', { class: 'vp-overlay', 'aria-hidden': 'true' });
  root.append(canvas, overlay);
  const problem = host.attach(canvas);
  if (problem) root.prepend(el('div', { class: 'om-issue', role: 'alert' }, [icon('warn'), el('p', {}, [problem])]));
  const show = () => {
    const p = run.drivenPlayer;
    const look = p?.run.devices.headLook;
    overlay.textContent = look
      ? `Driving ${p!.name}. Head yaw ${Math.round((look.yaw * 180) / Math.PI)} deg, pitch ${Math.round((look.pitch * 180) / Math.PI)} deg`
      : 'Editor camera';
  };
  const timer = setInterval(show, 100);
  show();
  return { element: root, focus: () => canvas.focus(), dispose: () => (clearInterval(timer), host.detach()) };
}
