// Run: Run local (runtime + sandbox + sim devices in this page), Run on server (publish a draft version, join
// /play as player 1), Add test player (another tab), Stop. `LocalRun` has no DOM so the e2e test drives it in Node.
// Simulated USIS packets never leave this page (Network Rule); only remote events reach /play.
import { CloudClient, type DebugEvent, type PlayFrame, type ReconnectingSocket } from '@pear/cloud';
import { quat, type UsisPacket } from '@pear/core';
import {
  InputBus, OBSERVATION_RANGE, SceneEvents, Viewport, buildObservation, ownershipOf, readViewportColors, scriptName,
  type Action, type Cue, type Observation, type Ownership, type OwnershipMode, type PeripheralKind, type RigDevice, type RigHit, type RigView, type SceneDescription, type WorldEntity,
} from '@pear/runtime';
import { LocalServer, ScriptSandbox, type ScriptOutput } from '@pear/script';
import prelude from '../../../Packages/PearScript/Sources/PearScript/Resources/prelude.js?raw';
import { SIM_DEVICE_KINDS, SimDevices, UsisPlayer, attachGestureKeys, attachMouseLook, type SimDeviceKind, type SimDevicesOptions } from '@pear/sim';
import { AgentDriver, type AgentNoteRecord, type AgentSeat } from './agentPlayers';
import { socketTransport, type AgentTransport, type DecideRequest } from './agentTransport';
import { describeAction, seatCrew, startProblem, type AgentLogEntry, type CrewId } from './playtestPlan';
import { buildPlaytestReport, type PlaytestReport } from './playtestReport';
import type { AccountController } from './account';
import { describeError } from './account';
import type { DebugStore } from './debug-panel';
import type { EditorBus } from './editor';
import type { PanelView } from './layout';
import { rigFor } from './needs';
import { createPauseClock } from './pauseClock';
import { isPhoneOnly, phoneLinks, type PhoneLink } from './phonePlay';
import { ScriptAudio } from './scriptAudio';
import { RelayClient } from './relay';
import type { Project } from './project';
import { button, el, icon } from './ui';

/** `onTick` rate: 5 Hz, enough to report a position without flooding the worker. */
const TICK_MS = 200;

/** `calibrate` is handled inside LocalRun and never reaches `onOutput`. */
export type EffectOutput = Exclude<ScriptOutput, { kind: 'log' } | { kind: 'calibrate' }>;

export interface LocalRunOptions {
  scene: SceneDescription;
  clientScripts: Record<string, string>;
  sandbox: ScriptSandbox;
  /** Haptic, remote, audio and spawn effects of client handlers. */
  onOutput?(output: EffectOutput, script: string): void;
  /** Plays `audio` outputs (the creator's player only); without it they are only reported through `onOutput`. */
  audio?: Pick<ScriptAudio, 'handle'> & Partial<Pick<ScriptAudio, 'dispose'>>;
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
  private bus: InputBus;
  private events: SceneEvents;
  private now: () => number;
  private headStamps: number[] = [];
  private pendingSince: number | null = null;
  private lastStep: number;
  private busy = false;
  /** `ctx.player.role` for this player's scripts; set from the Test panel. */
  role: 'player' | 'ref' = 'player';
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
    this.bus = new InputBus({ raise: options.scene.raise });
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
    this.options.audio?.dispose?.();
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
  private phoneRaised = false;
  private phoneSeq = 0;
  private phoneStart: number | null = null;
  private phoneSent = false;

  /** Whether the simulated phone is held up (see `raisePhone`). */
  get phoneUp(): boolean { return this.phoneRaised; }

  /**
   * Toggles the simulated phone between rest (pitch 0) and held up (pitch 90 degrees, past any gestures.raise angle below 90);
   * pass `up` to set it instead. The phone streams its orientation through the InputBus like a real one, so scripts get
   * onGesture raise / lower. Returns the new state, or null when there is no phone in the rig or a replay / live source owns the input.
   */
  raisePhone(up: boolean = !this.phoneRaised): boolean | null {
    if (!this.devices.has('phone') || this.player || this.live) return null;
    if (!this.phoneSent) this.emitPhoneOrientation(); // the first packet is the rest pose, so send it before the tilt
    this.phoneRaised = up;
    this.emitPhoneOrientation();
    return up;
  }

  private emitPhoneOrientation(): void {
    this.phoneSent = true;
    const at = this.now();
    this.phoneStart ??= at;
    const p: UsisPacket = {
      v: 1, deviceId: 'sim-phone', kind: 'phone', slot: 'hand', source: 'sim',
      t: Math.max(0, Math.round(at - this.phoneStart)), seq: this.phoneSeq++,
      ch: { orientation: quat.fromYawPitch(0, this.phoneRaised ? Math.PI / 2 : 0) },
    };
    this.rec?.push(p);
    this.ingest(p);
  }

  /** `report` false keeps a packet that several players ingest (a free device) from showing in the debug panel once per player. */
  ingest(packet: UsisPacket, report = true): void {
    const at = this.now();
    this.pendingSince ??= at;
    if (packet.slot === 'head') this.headStamps.push(at);
    this.bus.ingest(packet, at);
    if (report) this.options.onPacket?.(packet);
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
      if (this.options.scene.raise && this.devices.has('phone') && !this.player && !this.live) this.emitPhoneOrientation(); // 50 Hz like a real phone, so the slot never goes stale
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
        role: this.role,
        position: this.options.scene.permissions.location ? this.position : null,
        positionAccuracy: this.options.scene.permissions.location ? this.accuracy : null,
        ...(intensity !== undefined ? { intensity } : {}),
      });
      for (const o of result.outputs) {
        if (o.kind === 'calibrate') this.bus.calibrate(); // self.calibrate(): current pose becomes the raise rest pose
        else {
          if (o.kind === 'audio') this.options.audio?.handle(o);
          this.options.onOutput?.(o, script);
        }
      }
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

/** Which players receive a packet from a device of this ownership: `free` reaches everyone, `passed` only its holder. */
export function routeTargets(mode: OwnershipMode, playerIds: readonly string[], holder: string | null): string[] {
  if (mode === 'free') return [...playerIds];
  if (mode === 'passed') return holder !== null && playerIds.includes(holder) ? [holder] : [];
  return [];
}

/** Device kinds that live in the room (one shared device) instead of with each player; a free AirPods has no meaning, so it stays per player. */
export function roomKinds(rig: readonly SimDeviceKind[], ownership: Partial<Record<PeripheralKind, Ownership>>): SimDeviceKind[] {
  return rig.filter((k) => {
    const mode = ownershipOf(ownership, k).mode;
    return mode === 'passed' || (mode === 'free' && k !== 'airpods');
  });
}

/** One step toward `goal` on the ground (x, z), at most `speed` * `dtSeconds` long; `done` once it is within 5 cm. */
export function stepToward(pos: readonly [number, number], goal: readonly [number, number], speed: number, dtSeconds: number): { pos: [number, number]; done: boolean } {
  const dx = goal[0] - pos[0], dz = goal[1] - pos[1], len = Math.hypot(dx, dz);
  if (len <= 0.05) return { pos: [goal[0], goal[1]], done: true };
  const step = Math.min(len, speed * dtSeconds);
  return { pos: [pos[0] + (dx / len) * step, pos[1] + (dz / len) * step], done: step >= len };
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
  /** Set while a run is on; `devices` are the driven player's, null while nobody is driven (the room is shown, no input reaches a player). */
  private running: { devices: SimDevices | null } | null = null;
  /** `overview`: the editor camera stays on while running and the players are drawn; `player`: first person from the driven head. */
  cameraMode: 'overview' | 'player' = 'overview';
  private frameOnNextFrame = false;
  private devicePreview: { kind: RigDevice; at: readonly [number, number, number] } | null = null;
  private detachInput: (() => void)[] = [];
  private flyKeys = new Set<string>();
  private flyFast = false;
  /** R while running (outside text fields): raise or lower the driven player's simulated phone. Set by RunController. */
  onRaise?: () => void;
  /** What to draw of the players and devices: the run's players while running, the scene's rig preview while stopped. */
  rig: () => RigView | null = () => null;
  /** The scene's rig while nothing runs: one player at the origin with the devices the game lists. Set by the composition root. */
  preview: () => RigView | null = () => null;
  /** The player the keyboard and the Test panel drive. */
  drivenId: () => string | null = () => null;
  /** Running: a click on a player's body drives it; a click on a device marker opens its menu at the pointer. */
  onDrive?: (id: string) => void;
  onDeviceMenu?: (hit: Extract<RigHit, { type: 'device' }>, clientX: number, clientY: number) => void;
  /** Running: the driven player was dragged to (x, z), or sent walking there by a double click. */
  onPlace?: (x: number, z: number) => void;
  onWalkTo?: (x: number, z: number) => void;
  /** Running: a free device is dragged (runtime only). Stopped: it is dropped, so the scene saves its place once. */
  onPlaceDevice?: (kind: RigDevice, x: number, z: number) => void;
  onMoveDevice?: (kind: RigDevice, x: number, z: number) => void;
  /** WASD moved the driven player, so a walk in progress ends. */
  onKeyMove?: () => void;
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
      if (this.running && !this.running.devices) this.viewport.setHeadPose(null);
      else if (this.running?.devices) {
        const { devices } = this.running;
        const { yaw, pitch } = devices.headLook;
        // keys are only tracked while the canvas has focus (onkeyup/onblur clear them)
        if (this.flyKeys.size) {
          const p = stepPosition(devices.position, yaw, this.flyKeys, dt);
          devices.setPosition(p[0], p[1], p[2]);
          this.onKeyMove?.();
        }
        if (this.cameraMode === 'player') this.viewport.setHeadPose({ position: devices.position, orientation: quat.fromYawPitch(yaw, pitch) });
        else this.viewport.setHeadPose(null);
      }
      const view = this.rig();
      if (this.frameOnNextFrame && view && this.cameraMode === 'overview') {
        this.frameOnNextFrame = false;
        this.viewport.frameAll(view.avatars.map((a) => a.position));
      }
      const preview = this.devicePreview;
      this.viewport.setRig(view && preview ? { ...view, free: view.free.map((f) => (f.kind === preview.kind ? { ...f, at: preview.at } : f)) } : view);
      this.viewport.render();
      this.raf = requestAnimationFrame(frame);
    };
    frame();
    return undefined;
  }

  /**
   * Editor camera: right drag rotates (Alt: only around the vertical axis), middle drag pans (Shift+left drag too, for
   * trackpads), wheel zooms, a left click that barely moved picks.
   * While running in Player view, a click is mouse-look and the camera follows the head, so all of it is off. In Overview the camera works as above, a click on a player drives them or on a device opens its menu, and a drag places the driven player or a free device.
   */
  private bindCamera(canvas: HTMLCanvasElement): void {
    let drag: { mode: 'pan' | 'rotate' | 'none'; moved: number; button: number; move?: { id: string; y: number }; place?: true; device?: { kind: RigDevice; y: number } } | null = null;
    const firstPerson = () => !!this.running?.devices && this.cameraMode === 'player';
    const ndc = (e: PointerEvent): [number, number] => { const r = canvas.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2]; };
    const CLICK_SLOP_PX = 4;
    canvas.onpointerdown = (e) => {
      if (!this.viewport || firstPerson()) return;
      const mode = e.button === 1 || (e.button === 0 && e.shiftKey) ? 'pan' : e.button === 2 ? 'rotate' : 'none';
      drag = { mode, moved: 0, button: e.button };
      if (mode === 'none' && e.button === 0) {
        const hit = this.viewport.pickRig(...ndc(e));
        const free = hit?.type === 'device' && hit.owner === null ? this.rig()?.free.find((f) => f.kind === hit.kind) : undefined;
        if (free) drag.device = { kind: free.kind, y: free.at[1] };
        else if (this.running) {
          if (hit?.type === 'avatar' && hit.id === this.drivenId()) drag.place = true; // a player dragged on the ground is placed there
        } else {
          const sel = this.selectedId();
          if (sel && this.viewport.pick(...ndc(e)) === sel) {
            const y = this.entityY?.(sel);
            if (y !== undefined) drag.move = { id: sel, y };
          }
        }
      }
      canvas.setPointerCapture(e.pointerId);
      if (e.button === 1) e.preventDefault(); // no middle-click autoscroll
    };
    canvas.onpointermove = (e) => {
      if (!drag || !this.viewport) return;
      drag.moved += Math.abs(e.movementX) + Math.abs(e.movementY);
      if (drag.place || drag.device) {
        if (drag.moved < CLICK_SLOP_PX) return;
        const p = this.viewport.groundPoint(...ndc(e), drag.device ? drag.device.y : 0);
        if (!p) return;
        const [x, z] = [Math.round(p[0] * 20) / 20, Math.round(p[2] * 20) / 20];
        if (drag.device) {
          this.devicePreview = { kind: drag.device.kind, at: [x, drag.device.y, z] };
          if (this.running) this.onPlaceDevice?.(drag.device.kind, x, z);
        } else this.onPlace?.(x, z);
        return;
      }
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
      const dropped = this.devicePreview;
      this.devicePreview = null;
      if (d?.device && dropped && d.moved >= CLICK_SLOP_PX && !this.running) this.onMoveDevice?.(dropped.kind, dropped.at[0], dropped.at[2]); // one write, not one per pointer move
      if (!d || !this.viewport || d.button !== 0 || d.mode !== 'none' || d.moved >= CLICK_SLOP_PX) return; // a drag that moved an entity ends here too
      if (this.running) {
        const hit = this.viewport.pickRig(...ndc(e));
        if (hit?.type === 'avatar') this.onDrive?.(hit.id);
        else if (hit?.type === 'device') this.onDeviceMenu?.(hit, e.clientX, e.clientY);
        return;
      }
      const r = canvas.getBoundingClientRect();
      this.onPick?.(this.viewport.pick(((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2));
    };
    canvas.onpointercancel = () => ((drag = null), (this.devicePreview = null));
    canvas.oncontextmenu = (e) => e.preventDefault();
    canvas.ondblclick = (e) => {
      if (!this.running || firstPerson() || !this.viewport) return;
      const p = this.viewport.groundPoint(...ndc(e as unknown as PointerEvent), 0);
      if (p) this.onWalkTo?.(p[0], p[2]);
    };
    canvas.onwheel = (e) => {
      if (!this.viewport || firstPerson()) return;
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

  /** While running, the canvas takes key input; in Player view the camera follows the driven player's virtual AirPods and the canvas takes mouse-look, in Overview it frames the room. `origin` places that player and starts in Overview; omitted, it stays where it is (switching drivers). */
  setRunning(devices: SimDevices | null, origin?: readonly [number, number, number], active = devices !== null): void {
    this.running = devices || active ? { devices } : null;
    if (this.running && origin) {
      devices?.setPosition(origin[0], origin[1], origin[2]);
      this.cameraMode = 'overview'; // a new run starts looking at the room, with everyone in frame
      this.frameOnNextFrame = true;
    } else if (!devices) {
      this.viewport?.setHeadPose(null);
      this.cameraMode = 'overview'; // nobody driven: no head to follow
    }
    this.flyKeys.clear();
    this.bindInput();
  }

  /** Overview (the room, every player) or Player view (first person from the driven head). */
  setCameraMode(mode: 'overview' | 'player'): void {
    if (this.cameraMode === mode || (mode === 'player' && !this.running?.devices)) return;
    this.cameraMode = mode;
    if (mode === 'overview') this.frameOnNextFrame = true;
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
    if (!run.devices) return;
    const devices = run.devices;
    const step = (5 * Math.PI) / 180;
    const onKey = (e: KeyboardEvent) => {
      const { yaw, pitch } = devices.headLook;
      const delta: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
      const d = delta[e.key];
      if (!d) return;
      e.preventDefault();
      devices.setHeadLook(yaw + d[0], pitch + d[1]);
    };
    canvas.addEventListener('keydown', onKey);
    const onRaiseKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.code !== 'KeyR' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || t?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName ?? '')) return;
      this.onRaise?.();
    };
    window.addEventListener('keydown', onRaiseKey);
    this.detachInput = [
      ...(this.cameraMode === 'player' ? [attachMouseLook(canvas, devices)] : []), attachGestureKeys(window, devices), () => canvas.removeEventListener('keydown', onKey),
      () => window.removeEventListener('keydown', onRaiseKey),
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

/** What the creator chose to start a playtest: how many players, who they are, and how many decisions each agent may make. */
export interface PlaytestOptions {
  players: number;
  crew: CrewId;
  calls: number;
}

export interface PlaytestState {
  options: PlaytestOptions;
  state: 'running' | 'finishing' | 'done';
}

/** One play-by-play line with how its player is shown ("player-2 (Referee)"). */
export interface PlaytestLine {
  entry: AgentLogEntry;
  who: string;
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
  /** Where a double click in the viewport sent this player walking (x, z); null when not walking. */
  goal: [number, number] | null;
  socket?: ReconnectingSocket<PlayFrame>;
  /** What this player heard and felt since its last observation; an agent player reads and clears it. */
  cues: Cue[];
  /** The driver that plays this player (local Play only); null for a person-driven, wandering or idle player. */
  agent: AgentDriver | null;
}

export const SIM_DEVICE_NAMES: Record<SimDeviceKind, string> = { airpods: 'AirPods', phone: 'phone', watch: 'watch' };

const MAX_CUES = 50;
const playerDefaults = () => ({ cues: [] as Cue[], agent: null as AgentDriver | null, goal: null as [number, number] | null, source: 'manual' as PlayerSource, botMode: 'chase' as BotMode, botEvery: 2, botLeft: 2, liveDevices: new Set<string>() });

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
  /** The Deep Agent runtime's WebSocket URL for agent players, or null when the plugin is not installed. */
  agentUrl?(): string | null;
  /** Play on a phone-only game (Quick Draw) ends here: the links of the two real phones, no simulated players, no viewport. */
  onPhones?(links: PhoneLink[]): void;
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
    for (const { run: { devices: d } } of this.players) for (const k of SIM_DEVICE_KINDS) if (!this.rooms.has(k)) rig.includes(k) ? d.addDevice(k) : d.removeDevice(k); // a room device follows the scene, not the rig
    for (const l of this.listeners) l();
  }
  /**
   * Local Play: one shared SimDevices per device kind that is `free` or `passed` (not each player's own), with the scene's
   * ownership and, for passed kinds, which player holds it.
   */
  readonly rooms = new Map<SimDeviceKind, SimDevices>();
  private ownership: Partial<Record<PeripheralKind, Ownership>> = {};
  /** The open run's ownership, for the Test panel. */
  get ownershipNow(): Partial<Record<PeripheralKind, Ownership>> {
    return this.ownership;
  }
  private holders = new Map<SimDeviceKind, string>();
  private roomTimer: ReturnType<typeof setInterval> | null = null;
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
  private walkTimer: ReturnType<typeof setInterval> | null = null;
  private session: { scene: SceneDescription; gameId?: string; version?: number } | null = null;
  /** Local Play: time stands still while an agent player thinks (see `hold`); the devices, scripts and server run on this clock. */
  readonly clock = createPauseClock();
  private runId = '';
  private gameStart = 0;
  private agentSeq = 0;
  private agentTransport: AgentTransport | null = null;
  private agentTimer: ReturnType<typeof setInterval> | null = null;
  /** The last playtest report (kept after the run stops, cleared when the next run begins), and whether the agents are looking back now. */
  report: PlaytestReport | null = null;
  finishing = false;
  /** The playtest the creator started from the Playtest panel (kept after the run stops, cleared when the next run begins). */
  playtest: PlaytestState | null = null;
  private pendingPlaytest: PlaytestOptions | null = null;
  private keptLog: PlaytestLine[] = [];
  /** Agents taken off a player (driven, wandering, another source, switched off) whose notes still belong in the report. */
  private retired: AgentDriver[] = [];

  constructor(private deps: RunDeps) {
    this.relay.onChange = () => { for (const l of this.listeners) l(); };
    this.relay.onPacket = (device, packet) => {
      for (const p of this.players) if (p.source === 'live' && p.liveDevices.has(device)) p.run.ingest({ ...packet, source: 'live' });
    };
    deps.viewport.onRaise = () => void this.raisePhone();
    const host = deps.viewport;
    host.rig = () => this.rigView() ?? host.preview();
    host.drivenId = () => this.driven;
    host.onDrive = (id) => this.drive(id);
    host.onPlace = (x, z) => this.driven && this.movePlayer(this.driven, x, z);
    host.onWalkTo = (x, z) => this.driven && this.walkTo(this.driven, x, z);
    host.onKeyMove = () => { const p = this.drivenPlayer; if (p) p.goal = null; };
    host.onPlaceDevice = (kind, x, z) => this.placeRoomDevice(kind, x, z);
  }

  /** Sends keyboard, mouse and Test panel input to this player; the camera follows its head. With null nobody is driven: the room stays on screen and no input reaches a player. */
  drive(id: string | null): void {
    if (id === null) {
      this.driven = null;
      this.deps.viewport.setRunning(null, undefined, true);
      for (const l of this.listeners) l();
      return;
    }
    const p = this.players.find((x) => x.id === id);
    if (!p) return;
    this.dropAgent(p); // a person takes over
    this.driven = id;
    this.deps.viewport.setRunning(p.run.devices);
    for (const l of this.listeners) l();
  }

  /** Raises (or lowers) the simulated phone of a player, default the driven one: the R key and the Test panel button. Returns the new state, or null (no such player, no phone in the rig, or a replay / live source). */
  raisePhone(id: string | null = this.driven, up?: boolean): boolean | null {
    const p = this.players.find((x) => x.id === id);
    const r = p ? p.run.raisePhone(up) : null;
    if (r !== null) for (const l of this.listeners) l();
    return r;
  }

  /** Sets what `ctx.player.role` is for one player's scripts. */
  setRole(id: string, role: 'player' | 'ref'): void {
    const p = this.players.find((x) => x.id === id);
    if (p) p.run.role = role;
    for (const l of this.listeners) l();
  }

  /** Places a player on the ground (Test panel map drag). */
  movePlayer(id: string, x: number, z: number): void {
    const p = this.players.find((q) => q.id === id);
    const d = p?.run.devices;
    if (p && d && Number.isFinite(x) && Number.isFinite(z)) {
      p.goal = null;
      d.setPosition(x, d.position[1], z); // a zero-size map yields NaN / Infinity
    }
  }

  /** Sends a player walking to (x, z) at 1.5 m/s; WASD, a drag or a new goal ends it. */
  walkTo(id: string, x: number, z: number): void {
    const p = this.players.find((q) => q.id === id);
    if (p && Number.isFinite(x) && Number.isFinite(z)) p.goal = [x, z];
  }

  private walk(): void {
    if (this.clock.held) return;
    const scale = this.server ? this.timeScale : 1;
    for (const p of this.players) {
      if (!p.goal) continue;
      const d = p.run.devices;
      const next = stepToward([d.position[0], d.position[2]], p.goal, 1.5 * scale, 0.05);
      d.setPosition(next.pos[0], d.position[1], next.pos[1]);
      if (next.done) p.goal = null;
    }
  }

  /** Freezes the run's clock (devices, scripts, the in-page server's timers, wander, walking) until each `hold` has a `release`. */
  hold(): void {
    this.clock.hold();
    for (const l of this.listeners) l();
  }

  release(): void {
    this.clock.release();
    for (const l of this.listeners) l();
  }

  get held(): boolean {
    return this.clock.held > 0;
  }

  /** Seconds since this run started, on the pause clock (0 while stopped). */
  gameTime(): number {
    return this.local ? (this.clock.now() - this.gameStart) / 1000 : 0;
  }

  private cue(p: TestPlayer, kind: Cue['kind'], text: string, from?: string): void {
    p.cues.push({ t: Math.round(this.gameTime() * 10) / 10, kind, text, ...(from ? { from } : {}) });
    if (p.cues.length > MAX_CUES) p.cues.splice(0, p.cues.length - MAX_CUES);
  }

  /** What this player perceives now: others in front and in range, and the cues since the last call (which clears them). Null for an unknown player. */
  observationFor(id: string): Observation | null {
    const p = this.players.find((x) => x.id === id);
    const avatars = this.rigView()?.avatars;
    const me = avatars?.find((a) => a.id === id);
    return p && avatars && me ? buildObservation(me, avatars, p.cues.splice(0), this.gameTime()) : null;
  }

  private dropAgent(p: TestPlayer): void {
    p.agent?.dispose();
    if (p.agent && (p.agent.calls || p.agent.notes.length)) this.retired.push(p.agent);
    p.agent = null;
  }

  private buildReport(lookedBack: boolean): PlaytestReport {
    const instructions = this.deps.project.instructions;
    const drivers = [...this.retired, ...this.players.flatMap((p) => (p.agent ? [p.agent] : []))];
    const notes: AgentNoteRecord[] = drivers.flatMap((d) => d.notes).sort((a, b) => a.gameTime - b.gameTime);
    return buildPlaytestReport({
      title: instructions?.title ?? '',
      phases: instructions?.phases.map((ph) => ({ id: ph.id, title: ph.title })) ?? [],
      gameTime: this.gameTime(),
      players: drivers.map((d) => ({
        id: d.id, persona: d.seat.persona, role: instructions?.roles.find((r) => r.id === d.seat.role)?.name ?? '', calls: d.calls, status: d.status, summary: d.summary,
      })),
      notes,
      lookedBack,
    });
  }

  /** The end-of-run look back: every agent that played answers once about what was unclear, then stops, and the report is built. Returns a sentence when it cannot run. */
  async finishPlaytest(): Promise<string | undefined> {
    if (!this.server) return 'Agent players run in local Play only.';
    const live = this.players.flatMap((p) => (p.agent ? [p.agent] : []));
    if (!live.length) return 'No agent players to finish.';
    if (this.finishing) return 'The agents are already looking back.';
    if (live.every((d) => d.looked)) return 'The playtest is finished.';
    if (!live.some((d) => d.calls)) return 'The agents have not played yet.';
    const transport = this.agentTransport;
    if (this.playtest) this.playtest = { ...this.playtest, state: 'finishing' };
    this.finishing = true;
    for (const l of this.listeners) l();
    try {
      await Promise.all(live.map((d) => d.lookBack()));
      if (this.agentTransport !== transport) return undefined; // stopped meanwhile: stop() kept what it had
      this.report = this.buildReport(live.every((d) => d.looked));
    } finally {
      this.finishing = false;
      if (this.playtest?.state === 'finishing') this.playtest = { ...this.playtest, state: 'done' };
      for (const l of this.listeners) l();
    }
    return undefined;
  }

  /** Makes a player an agent (a Deep Agent plays it from the instructions) or, with null, a plain player again. Returns an error sentence, or undefined. */
  setAgent(id: string, seat: AgentSeat | null, budget?: { calls: number; quiet: boolean }): string | undefined {
    const p = this.players.find((x) => x.id === id);
    if (!p) return undefined;
    if (!seat) {
      this.dropAgent(p);
      for (const l of this.listeners) l();
      return undefined;
    }
    const instructions = this.deps.project.instructions;
    if (!this.server) return 'Agent players run in local Play only.';
    if (id === this.driven) return 'Drive another player: an agent cannot be the player you drive.';
    if (p.source === 'replay' || p.source === 'live') return 'Set the input source to Manual first.';
    if (!instructions) return "Write the game's instructions first (Deep Agent, Instructions mode).";
    if (!this.deps.agentUrl?.()) return 'Install the Deep Agent plugin first.';
    this.dropAgent(p);
    const role = instructions.roles.find((r) => r.id === seat.role);
    if (role) p.run.role = role.kind;
    p.wander = false;
    if (p.source === 'bot') p.source = 'manual';
    this.agentTransport ??= socketTransport(() => this.deps.agentUrl?.() ?? null);
    p.agent = new AgentDriver({
      id, seat, run: `${this.runId}-${++this.agentSeq}`, transport: this.agentTransport, ...(budget ? { cap: budget.calls, quiet: budget.quiet } : {}),
      clock: { now: this.clock.now, hold: () => this.hold(), release: () => this.release() },
      host: {
        observation: () => this.observationFor(id)!,
        apply: (a) => this.applyAgent(p, a),
        walking: () => p.goal !== null,
        intro: () => this.introFor(p, seat),
        gameTime: () => this.gameTime(),
      },
    });
    for (const l of this.listeners) l();
    return undefined;
  }

  private introFor(p: TestPlayer, seat: AgentSeat): { role: DecideRequest['role']; instructions: unknown } {
    const instructions = this.deps.project.instructions;
    const r = instructions?.roles.find((x) => x.id === seat.role);
    return { role: r ? { id: r.id, name: r.name, brief: r.brief, kind: r.kind } : { id: 'player', name: 'Player', brief: '', kind: p.run.role }, instructions };
  }

  /** The only way an agent acts: the same moves a person has (walk, turn the head, gesture, hand over a device, speak). What cannot be done comes back as a note cue. */
  private applyAgent(p: TestPlayer, a: Action): void {
    const d = p.run.devices;
    if (a.type !== 'say') this.out('log', `[${p.id}] ${describeAction(a)}`); // what an agent does is printed; speech is printed below
    const lookToward = (x: number, z: number) => d.setHeadLook(Math.atan2(-(x - d.position[0]), -(z - d.position[2])), 0);
    if (a.type === 'walk_to') this.walkTo(p.id, a.x, a.z);
    else if (a.type === 'look_at') {
      if ('player' in a) {
        const at = this.players.find((q) => q.id === a.player)?.run.devices.position;
        if (at) lookToward(at[0], at[2]);
        else this.cue(p, 'note', `There is no player ${a.player} to look at.`);
      } else lookToward(a.x, a.z);
    } else if (a.type === 'gesture') {
      const room = this.rooms.has('phone') && (ownershipOf(this.ownership, 'phone').mode === 'free' || this.holders.get('phone') === p.id);
      if (d.has('phone') || room) d.gesture(a.gesture, a.gesture === 'flick' ? [1, 0, 0] : undefined);
      else this.cue(p, 'note', `You have no phone to do a ${a.gesture} with.`);
    } else if (a.type === 'give_device') {
      if (this.holders.get(a.device) !== p.id) this.cue(p, 'note', `You do not hold the ${a.device}.`);
      else if (a.to === p.id || !this.players.some((q) => q.id === a.to)) this.cue(p, 'note', `There is no player ${a.to} to give it to.`);
      else this.holdDevice(a.device, a.to);
    } else if (a.type === 'say') {
      this.out('log', `[${p.id}] says: ${a.text}`);
      for (const q of this.players) {
        const [qx, , qz] = q.run.devices.position;
        if (q !== p && Math.hypot(qx - d.position[0], qz - d.position[2]) <= OBSERVATION_RANGE) this.cue(q, 'speech', a.text, p.id);
      }
    }
  }

  /** Moves a free room device on the ground while running (this run only; the scene keeps its own place). */
  placeRoomDevice(kind: SimDeviceKind, x: number, z: number): void {
    const room = this.rooms.get(kind);
    if (room && ownershipOf(this.ownership, kind).mode === 'free' && Number.isFinite(x) && Number.isFinite(z)) room.setPosition(x, room.position[1], z);
  }

  /** What the viewport draws of the run: every player's body, head look, devices and last haptic, and the free devices. Null while stopped. */
  rigView(): RigView | null {
    if (!this.players.length) return null;
    return {
      avatars: this.players.map((p, n) => {
        const d = p.run.devices;
        const { yaw, pitch } = d.headLook;
        const held = [...this.holders].filter(([, id]) => id === p.id).map(([kind]) => ({ kind, shared: true }));
        // An agent player also shows who it is, what it is doing, what it just said and where it is walking, in its own colour.
        const tag = p.agent ? { label: p.name, ...(p.agent.doing === 'Waiting' ? {} : { doing: p.agent.doing }), say: p.agent.saying(this.gameTime()), goal: p.goal, tint: n } : {};
        return { id: p.id, position: d.position, yaw, pitch, driven: p.id === this.driven, devices: [...d.list().map((kind) => ({ kind, shared: false })), ...held], hapticAt: p.hapticAt, ...tag };
      }),
      free: [...this.rooms].filter(([kind]) => ownershipOf(this.ownership, kind).mode === 'free').map(([kind, room]) => ({ kind, at: room.position })),
    };
  }

  /** A wandering player random-walks and gestures on its own while the creator drives someone else. */
  setWander(id: string, on: boolean): void {
    const p = this.players.find((x) => x.id === id);
    if (p) (p.wander = on, on && this.dropAgent(p));
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
    if (source !== 'manual') this.dropAgent(p);
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
    for (const [kind, holder] of this.holders) if (holder === id) this.holders.set(kind, this.players[0]!.id);
    if (this.clients.delete(id)) (this.server?.leave(id), this.deps.debug.handleDebugEvent({ kind: 'leave', t: Date.now(), player: id }));
    p!.agent?.dispose();
    if (this.driven === id) this.drive(this.status.kind === 'local' ? null : this.players[0]!.id);
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

  out(level: 'log' | 'warn' | 'error', text: string): void {
    this.deps.debug.addOutput(level, text);
  }

  async runLocal(): Promise<void> {
    if (this.phoneOnly()) return this.runPhones();
    await this.begin('local');
  }

  /** True when the project's scene has nothing visible (Quick Draw): Play is two real phones. An invalid scene falls through to `begin`, which reports it. */
  private phoneOnly(): boolean {
    try {
      return isPhoneOnly(this.deps.project.description());
    } catch {
      return false;
    }
  }

  /** Whether the Deep Agent plugin is installed, so agents can run. */
  get agentsAvailable(): boolean {
    return !!this.deps.agentUrl?.();
  }

  /** Publishes the draft if it changed, then hands out the phone links of that exact version. Needs a signed-in account with a game picked. */
  private async runPhones(): Promise<void> {
    const { account, project } = this.deps;
    if (!account.account || !account.gameId) throw new Error('This game plays on two real phones, so it must be published first. Sign in, pick or create a game in Account, then press Play again.');
    this.stop();
    try {
      const { version, published } = await account.publishIfChanged(project);
      this.out('log', published ? `Published version ${version} of ${account.game?.title ?? 'the game'}.` : `No changes since version ${version}.`);
      this.showPhones(account.gameId, version);
    } catch (e) {
      throw new Error(describeError(e, account.serverUrl));
    }
  }

  private showPhones(gameId: string, version: number): void {
    this.out('log', `Open the two phone links to play ${gameId} version ${version}.`);
    this.deps.onPhones?.(phoneLinks(this.deps.account.serverUrl, gameId, version));
  }

  /** Publishes the draft as a new version, then joins /play as player 1 with the debug stream open. */
  async runServer(): Promise<void> {
    if (this.phoneOnly()) return this.runPhones();
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
    if (this.phoneOnly()) return this.showPhones(gameId, version);
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
    this.report = null;
    this.playtest = null;
    this.keptLog = [];
    editor.clearErrors();
    let scene: SceneDescription;
    try {
      scene = project.description();
    } catch (e) {
      this.out('error', `Scene is invalid: ${e instanceof Error ? e.message : String(e)}`);
      throw new Error('The scene is invalid, see Output.');
    }
    // A game that declares its inputs or lists peripherals gets exactly the devices that provide them (not saved: the browser's own choice stays for games that do not).
    if (scene.inputs || Object.keys(scene.gestures).length || scene.peripherals.length || scene.raise) this.rig = rigFor(scene.inputs, scene.gestures, scene.peripherals, !!scene.raise);
    // Free and passed devices are shared by the room, which only the in-page Play can route; elsewhere every player keeps their own.
    const shared = kind === 'local' ? roomKinds(this.rig, scene.ownership) : [];
    if (kind !== 'local' && Object.keys(scene.ownership).length) this.out('warn', 'Free and passed devices are simulated in local Play only; here every player has their own devices.');
    const sandbox = new ScriptSandbox({
      onLog: (entry) => {
        debug.addOutput(entry.level, entry.text, entry.script);
        if (entry.level === 'error' && entry.script) editor.reportError({ kind: 'client', name: entry.script }, entry.text);
      },
    });
    this.gameStart = this.clock.now();
    this.runId = `run-${Date.now().toString(36)}`;
    const run = new LocalRun({
      scene, sandbox, clientScripts: project.clientScripts, now: this.clock.now,
      onPacket: (p) => debug.addPacket(p),
      onLoadError: (script, message) => {
        this.out('error', `${script}: ${message}`);
        editor.reportError({ kind: 'client', name: script }, message);
      },
      onOutput: (o, script) => this.handleOutput(o, script),
      audio: new ScriptAudio(),
      devices: { kinds: this.rig.filter((k) => !shared.includes(k)) },
    });
    this.local = run;
    run.devices.setHeartRate(this.heartRate);
    await run.load();
    if (this.local !== run) return; // stopped while scripts were loading
    this.playerCount = 1;
    this.players = [{ id: 'player-1', name: account.account?.display_name || 'player-1', run, wander: false, ...playerDefaults(), lastEvent: null, hapticAt: 0 }];
    this.driven = kind === 'local' ? null : 'player-1'; // local Play starts with nobody driven; on a server the creator is the player who joined
    this.buildRooms(shared, scene.ownership);
    if (kind === 'local') {
      run.devices.setPosition(scene.playerOrigin[0], scene.playerOrigin[1], scene.playerOrigin[2]);
      viewport.setRunning(null, scene.playerOrigin, true);
    } else viewport.setRunning(run.devices, scene.playerOrigin);
    this.deps.reveal?.('viewport');
    this.deps.reveal?.('test');
    run.start();
    this.wanderTimer = setInterval(() => this.wander(), 200);
    this.walkTimer = setInterval(() => this.walk(), 50);
    if (kind === 'local') this.agentTimer = setInterval(() => this.agentTick(), 100);
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
    const pending = this.pendingPlaytest;
    const min = kind === 'local' ? pending?.players ?? this.deps.project.playerLimits().min : 1;
    this.applyScale();
    for (let i = 1; i < min && this.local === run; i++) await this.addPlayer();
    if (kind === 'local' && pending && this.local === run) {
      const seats = seatCrew(this.players.length, pending.crew, this.deps.project.instructions?.roles ?? []);
      let first: string | undefined;
      this.players.forEach((p, n) => { first ??= this.setAgent(p.id, seats[n]!, { calls: pending.calls, quiet: true }); });
      if (first) this.out('warn', `Agents were not seated: ${first}`);
      this.playtest = { options: pending, state: 'running' };
    }
  }

  /** Starts a playtest: a fresh local Play with the chosen number of players, every one an agent (nobody driven). Returns a sentence when it cannot start. */
  async startPlaytest(options: PlaytestOptions): Promise<string | undefined> {
    const { project } = this.deps;
    const problem = startProblem({ hasInstructions: !!project.instructions, hasPlugin: !!this.deps.agentUrl?.(), limits: project.playerLimits(), players: options.players });
    if (problem) return problem;
    if (this.running && this.status.kind !== 'local') return 'Stop the current run first.';
    if (this.phoneOnly()) return 'This game plays on two real phones, so agents cannot play it.';
    this.pendingPlaytest = options;
    try {
      await this.runLocal();
    } finally {
      this.pendingPlaytest = null;
    }
    return undefined;
  }

  private agentTick(): void {
    for (const p of this.players) p.agent?.tick();
    if (this.playtest?.state !== 'running') return;
    const live = this.players.flatMap((p) => (p.agent ? [p.agent] : []));
    if (live.length && live.every((d) => d.exhausted)) void this.finishPlaytest();
  }

  private collectLog(drivers: readonly AgentDriver[]): PlaytestLine[] {
    const roles = this.deps.project.instructions?.roles ?? [];
    return drivers
      .flatMap((d) => {
        const role = roles.find((r) => r.id === d.seat.role)?.name;
        const who = role ? `${d.id} (${role})` : d.id;
        return d.log.map((entry) => ({ entry, who }));
      })
      .sort((a, b) => a.entry.gameTime - b.entry.gameTime)
      .slice(-200);
  }

  /** The play-by-play of every agent so far, oldest first; after the run stops, the last one the run had. */
  playtestLog(): PlaytestLine[] {
    const drivers = [...this.retired, ...this.players.flatMap((p) => (p.agent ? [p.agent] : []))];
    return drivers.length || this.players.length ? this.collectLog(drivers) : this.keptLog;
  }

  /** Play: server scripts run in this page; the server's debug output goes to the same DebugStore rows /debug feeds. */
  private startPlayServer(run: LocalRun): void {
    const { project, debug, editor } = this.deps;
    const ev = (e: { kind: string; [k: string]: unknown }) => debug.handleDebugEvent({ t: Date.now(), ...e });
    const server = createPlayServer(this.clients, {
      now: this.clock.epoch, setTimer: this.clock.setTimer, clearTimer: this.clock.clearTimer,
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
  async addPlayer(role: 'player' | 'ref' = 'player'): Promise<void> {
    const { project } = this.deps;
    const sess = this.session;
    if (!this.local || !sess) throw new Error('Press Play first, then add a player.');
    const limits = project.playerLimits();
    if (this.players.length >= limits.max) throw new Error(`The game allows at most ${limits.max} players.`);
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
      scene: sess.scene, sandbox, clientScripts: project.clientScripts, now: this.clock.now,
      devices: { kinds: this.rig.filter((k) => !this.rooms.has(k)) },
      onLoadError: (script, message) => this.out('error', `[${id}] ${script}: ${message}`),
      onOutput: (o) => {
        if (o.kind === 'haptic') (p.hapticAt = Date.now(), this.cue(p, 'haptic', `${o.pattern} ${o.intensity}`), this.out('log', `[${id}] haptic ${o.pattern} ${o.intensity}`), this.sendHaptic(p, o.pattern, o.intensity));
        if (o.kind === 'audio') this.cue(p, 'audio', `${o.action} ${o.sound ?? o.text ?? ''}`.trim());
        if (o.kind !== 'remote') return;
        if (this.server) this.server.remote(id, o.name, o.data);
        else p.socket?.send({ name: o.name, data: o.data });
      },
    });
    const run = p.run;
    run.role = role;
    await run.load();
    if (!this.local || this.session !== sess) return run.stop(); // stopped while loading
    const [ox, oy, oz] = sess.scene.playerOrigin;
    const a = ((n - 2) * Math.PI) / 3; // 6 spots per ring
    run.devices.setPosition(ox + 3 * Math.sin(a), oy, oz - 3 * Math.cos(a));
    this.attachRooms(p);
    run.devices.setHeartRate(this.heartRate);
    run.start();
    this.players.push(p);
    this.applyScale();
    if (this.server) this.joinLocal(id, id, this.tracked(p));
    else if (sess.gameId && client) {
      p.socket = client.openPlay(sess.gameId, sess.version === undefined ? {} : { version: sess.version });
      p.socket.onMessage = (frame) => { if (frame.name !== '_reload') void this.tracked(p).deliverRemote(frame.name, frame.data); };
    }
    this.out('log', `Added ${id}${role === 'ref' ? ' as referee' : ''}.`);
    this.refresh();
  }

  /** Starts one shared device per room kind, gives each player the redirect to it, and mirrors a passed device's holder every sim tick. */
  private buildRooms(kinds: readonly SimDeviceKind[], ownership: Partial<Record<PeripheralKind, Ownership>>): void {
    this.ownership = ownership;
    for (const kind of kinds) {
      const room = new SimDevices((packet) => this.route(packet), { kinds: [kind], idPrefix: 'room', now: this.clock.now });
      const own = ownershipOf(ownership, kind);
      if (own.mode === 'free' && own.at) room.setPosition(...own.at);
      if (own.mode === 'passed') this.holders.set(kind, this.players[0]!.id);
      this.rooms.set(kind, room);
    }
    for (const p of this.players) this.attachRooms(p);
    if (!this.rooms.size) return;
    this.roomTimer = setInterval(() => this.mirrorHolders(), 20);
    for (const room of this.rooms.values()) room.start();
  }

  /** The player's own devices send gestures, accel and heart rate for a room kind to the shared device (a passed one only while this player holds it). */
  private attachRooms(p: TestPlayer): void {
    for (const [kind, room] of this.rooms) {
      const passed = ownershipOf(this.ownership, kind).mode === 'passed';
      p.run.devices.redirect(kind, room, passed ? () => this.holders.get(kind) === p.id : () => true);
    }
  }

  /** A passed device is worn or carried by its holder, so it takes the holder's pose, position and heart rate. */
  private mirrorHolders(): void {
    for (const [kind, id] of this.holders) {
      const from = this.players.find((p) => p.id === id)?.run.devices;
      const room = this.rooms.get(kind);
      if (!from || !room) continue;
      room.setHeadLook(from.headLook.yaw, from.headLook.pitch);
      room.setPosition(...from.position);
      room.setGpsAccuracy(from.gpsAccuracyMeters);
      room.setHeartRate(from.heartRateBpm);
    }
  }

  /** A packet from a shared device goes to everyone (free) or to its holder (passed); players fed by a clip or live devices keep to those. */
  private route(packet: UsisPacket): void {
    const kind = packet.kind as SimDeviceKind;
    const eligible = this.players.filter((p) => p.source !== 'live' && !p.run.replaying).map((p) => p.id);
    const targets = routeTargets(ownershipOf(this.ownership, kind as PeripheralKind).mode, eligible, this.holders.get(kind) ?? null);
    targets.forEach((id, i) => this.players.find((p) => p.id === id)?.run.ingest(packet, i === 0));
  }

  /** Who holds a passed device, or null for a device that is not passed. */
  holderOf(kind: SimDeviceKind): string | null {
    return this.holders.get(kind) ?? null;
  }

  /** Hands a passed device to another player. The previous holder's copy goes stale after 500 ms. */
  holdDevice(kind: SimDeviceKind, playerId: string): void {
    if (!this.holders.has(kind) || !this.players.some((p) => p.id === playerId)) return;
    this.holders.set(kind, playerId);
    for (const l of this.listeners) l();
  }

  /** One wander or bot step for every wandering or bot player the creator is not driving. */
  private wander(): void {
    if (this.clock.held) return;
    const scale = this.server ? this.timeScale : 1;
    for (const p of this.players) {
      if (p.id === this.driven || p.goal) continue;
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
      if (this.players[0]) (this.players[0].hapticAt = Date.now(), this.cue(this.players[0], 'haptic', `${o.pattern} ${o.intensity}`), this.sendHaptic(this.players[0], o.pattern, o.intensity));
    } else if (o.kind === 'audio') {
      this.out('log', `audio ${o.action} ${o.sound ?? o.text ?? ''} on ${o.entity}`.trim());
      if (this.players[0]) this.cue(this.players[0], 'audio', `${o.action} ${o.sound ?? o.text ?? ''}`.trim());
    }
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
    if (this.walkTimer) clearInterval(this.walkTimer);
    this.walkTimer = null;
    if (this.agentTimer) clearInterval(this.agentTimer);
    this.agentTimer = null;
    const agents = this.players.flatMap((p) => (p.agent ? [p.agent] : []));
    if (this.finishing || agents.some((d) => !d.looked && (d.calls || d.notes.length)) || this.retired.some((d) => d.calls || d.notes.length)) this.report = this.buildReport(false);
    if (this.playtest) {
      this.keptLog = this.collectLog([...this.retired, ...agents]);
      this.playtest = { ...this.playtest, state: 'done' };
    }
    this.retired = [];
    for (const p of this.players) p.agent?.dispose();
    this.agentTransport?.close();
    this.agentTransport = null;
    this.clock.reset();
    if (this.roomTimer) clearInterval(this.roomTimer);
    this.roomTimer = null;
    for (const room of this.rooms.values()) room.stop();
    this.rooms.clear();
    this.holders.clear();
    this.ownership = {};
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
    'aria-label': 'Viewport. While running: W A S D walk the player you drive, arrow keys turn the head (in Player view, drag to look), and T, G, F, P and H send tap, double tap, flick, pinch and squeeze, and R raises or lowers the phone, from anywhere outside text fields.',
  });
  const overlay = el('div', { class: 'vp-overlay', 'aria-hidden': 'true' });
  // The two things only a running test needs on screen: the view, and a new player (everything else is a click on the scene).
  const viewBtn = button('View: Overview', () => (host.setCameraMode(host.cameraMode === 'overview' ? 'player' : 'overview'), show()), { variant: 'small' });
  const addBtn = button('Add player', () => void run.addPlayer().catch((e) => run.out('error', e instanceof Error ? e.message : String(e))), { variant: 'small' });
  const bar = el('div', { class: 'vp-bar' }, [viewBtn, addBtn]);
  root.append(canvas, overlay, bar);
  const problem = host.attach(canvas);
  if (problem) root.prepend(el('div', { class: 'om-issue', role: 'alert' }, [icon('warn'), el('p', {}, [problem])]));
  const show = () => {
    const p = run.drivenPlayer;
    const look = p?.run.devices.headLook;
    bar.hidden = !run.running;
    viewBtn.textContent = host.cameraMode === 'overview' ? 'View: Overview' : 'View: Player';
    viewBtn.setAttribute('aria-pressed', String(host.cameraMode === 'player'));
    overlay.textContent = look
      ? `Driving ${p!.name}. Head yaw ${Math.round((look.yaw * 180) / Math.PI)} deg, pitch ${Math.round((look.pitch * 180) / Math.PI)} deg`
      : 'Editor camera';
  };
  const timer = setInterval(show, 100);
  show();
  return { element: root, focus: () => canvas.focus(), dispose: () => (clearInterval(timer), host.detach()) };
}
