// Peripherals catalog: the devices a game can list, the signals each one gives, and the pure edits the Peripherals panel makes.
// Signals stay in the scene's `inputs` and `gestures`; `peripherals` only lists devices, so there is one source of truth.
import { GESTURE_TYPES, type GestureType, type Slot } from '@pear/core';
import { DEFAULT_FREE_AT, PERIPHERAL_KINDS, parseGestures, parseInputs, parseOwnership, ownershipOf, parsePeripherals, type CustomGesture, type Ownership, type OwnershipMode, type PeripheralKind, type RigVec, type RigView, type SceneInputs } from '@pear/runtime';
import { inferInputs, rigFor, slotDevice } from './needs';
import type { SceneJson } from './project';

export type SignalId = 'head' | 'position' | 'heartRate' | GestureType;

export interface SignalDef {
  id: SignalId;
  label: string;
  hint: string;
  /** The script handler that receives this signal. */
  handler: 'onLookAt' | 'onTick' | 'onHeartRate' | 'onGesture';
  /** Base name of the script "Add handler" creates. */
  scriptName: string;
  /** `onLookAt` reaches only the entity being looked at, so its script must sit on a chosen entity. */
  needsEntity: boolean;
}

export interface PeripheralDef {
  label: string;
  blurb: string;
  /** Icon symbol name in index.html. */
  icon: 'phone' | 'watch' | 'airpods';
  defaultSlot: Slot;
  signals: SignalDef[];
  outputs: { label: string; hint: string }[];
  /** Who can hold this device: an AirPods has no pose of its own, so it is never free-floating. */
  ownership: OwnershipMode[];
}

/** What the panel edits: the scene fields that describe devices. */
export interface PeripheralState {
  peripherals: PeripheralKind[];
  /** Kinds that are not `player`; a kind not listed is held by each player. */
  ownership: Partial<Record<PeripheralKind, Ownership>>;
  inputs: SceneInputs | null;
  gestures: Record<string, CustomGesture>;
}

const gesture = (id: GestureType, label: string, hint: string): SignalDef => ({ id, label, hint, handler: 'onGesture', scriptName: id, needsEntity: false });

export const PERIPHERALS: Record<PeripheralKind, PeripheralDef> = {
  phone: {
    label: 'iPhone',
    blurb: 'position and gestures',
    icon: 'phone',
    defaultSlot: 'hand',
    signals: [
      { id: 'position', label: 'Position', hint: 'Where the player stands (GPS). Turns on the location permission.', handler: 'onTick', scriptName: 'position', needsEntity: false },
      gesture('tap', 'Tap', 'A tap on the screen.'),
      gesture('doubleTap', 'Double tap', 'Two quick taps.'),
      gesture('flick', 'Flick', 'A quick flick of the phone.'),
      gesture('squeeze', 'Squeeze', 'A squeeze.'),
      gesture('pinch', 'Pinch', 'A pinch.'),
    ],
    outputs: [{ label: 'Haptic', hint: 'ctx.haptic(pattern, intensity)' }],
    ownership: ['player', 'free', 'passed'],
  },
  watch: {
    label: 'Apple Watch',
    blurb: 'heart rate',
    icon: 'watch',
    defaultSlot: 'leftWrist',
    signals: [{ id: 'heartRate', label: 'Heart rate', hint: 'onHeartRate gets the bpm; ctx.intensity is 0 to 1.', handler: 'onHeartRate', scriptName: 'heartRate', needsEntity: false }],
    outputs: [],
    ownership: ['player', 'free', 'passed'],
  },
  airpods: {
    label: 'AirPods',
    blurb: 'head direction',
    icon: 'airpods',
    defaultSlot: 'head',
    signals: [{ id: 'head', label: 'Head direction', hint: 'Look-at and head-probe triggers.', handler: 'onLookAt', scriptName: 'lookAt', needsEntity: true }],
    outputs: [],
    ownership: ['player', 'passed'],
  },
};

/** Devices shown in the picker that cannot be added yet. */
export const COMING_SOON = [{ label: 'iPad', blurb: 'Touch and Apple Pencil. After the hackathon.' }] as const;

const DEFAULT_SIGNAL: Record<PeripheralKind, SignalId> = { phone: 'tap', watch: 'heartRate', airpods: 'head' };
const ALL_SIGNALS: SignalId[] = ['head', 'position', 'heartRate', ...GESTURE_TYPES];
const EMPTY_INPUTS: SceneInputs = { head: false, position: false, heartRate: false, gestures: [], players: [1, 32] };

/** The device that carries a signal. */
export function deviceOfSignal(id: SignalId): PeripheralKind {
  return id === 'head' ? 'airpods' : id === 'heartRate' ? 'watch' : 'phone';
}

export function signalDef(id: SignalId): SignalDef {
  return PERIPHERALS[deviceOfSignal(id)].signals.find((s) => s.id === id)!;
}

export function signalOn(inputs: SceneInputs | null, id: SignalId): boolean {
  if (!inputs) return false;
  return id === 'head' || id === 'position' || id === 'heartRate' ? inputs[id] : inputs.gestures.includes(id);
}

export function setSignal(inputs: SceneInputs | null, id: SignalId, on: boolean): SceneInputs {
  const base = inputs ?? EMPTY_INPUTS;
  if (id === 'head') return { ...base, head: on };
  if (id === 'position') return { ...base, position: on };
  if (id === 'heartRate') return { ...base, heartRate: on };
  return { ...base, gestures: GESTURE_TYPES.filter((g) => (g === id ? on : base.gestures.includes(g))) };
}

/** The device fields of a scene as the panel edits them; a field that does not parse counts as empty. */
export function readPeripheralState(scene: SceneJson): PeripheralState {
  const safe = <T,>(read: () => T, fallback: T): T => {
    try {
      return read();
    } catch {
      return fallback;
    }
  };
  return {
    peripherals: safe(() => parsePeripherals(scene.peripherals), []),
    ownership: safe(() => parseOwnership(scene.ownership), {}),
    inputs: safe(() => (scene.inputs ? parseInputs(scene.inputs) : null), null),
    gestures: safe(() => parseGestures(scene.gestures), {}),
  };
}

/** Devices the game uses: the listed ones plus those its signals and motion gestures imply, in catalog order. */
export function devicesOf(state: PeripheralState): PeripheralKind[] {
  const present = new Set<string>([...state.peripherals, ...rigFor(state.inputs, state.gestures)]);
  return PERIPHERAL_KINDS.filter((k) => present.has(k));
}

/** A game that does not declare inputs yet starts from what its scripts already use, so declaring drops nothing. */
export function seedInputs(state: PeripheralState, clientScripts: Record<string, string>): PeripheralState {
  return state.inputs ? state : { ...state, inputs: inferInputs(clientScripts) };
}

/** Lists the device and turns on its default signal. A device the game already has stays as it is. */
export function addPeripheral(state: PeripheralState, kind: PeripheralKind): PeripheralState {
  if (devicesOf(state).includes(kind)) return state;
  return { ...state, peripherals: [...state.peripherals, kind], inputs: setSignal(state.inputs, DEFAULT_SIGNAL[kind], true) };
}

/** Turns one signal on or off. The device is listed too, so unticking its last signal does not make its card vanish. */
export function toggleSignal(state: PeripheralState, id: SignalId, on: boolean): PeripheralState {
  const kind = deviceOfSignal(id);
  return {
    ...state,
    peripherals: state.peripherals.includes(kind) ? state.peripherals : [...state.peripherals, kind],
    inputs: setSignal(state.inputs, id, on),
  };
}

/** Who holds a device. A mode the device cannot have leaves the state as it is; `player` clears the entry, `free` starts at the default spot. */
export function setOwnership(state: PeripheralState, kind: PeripheralKind, mode: OwnershipMode): PeripheralState {
  if (!PERIPHERALS[kind].ownership.includes(mode)) return state;
  const { [kind]: _old, ...rest } = state.ownership;
  const entry: Ownership | null = mode === 'player' ? null : mode === 'free' ? { mode, at: state.ownership[kind]?.at ?? [...DEFAULT_FREE_AT] as unknown as Ownership['at'] } : { mode };
  return { ...state, ownership: entry ? { ...rest, [kind]: entry } : rest };
}

/** Moves a free device. Anything else leaves the state as it is. */
export function placeDevice(state: PeripheralState, kind: PeripheralKind, at: readonly [number, number, number]): PeripheralState {
  if (state.ownership[kind]?.mode !== 'free') return state;
  return { ...state, ownership: { ...state.ownership, [kind]: { mode: 'free', at: [...at] as unknown as Ownership['at'] } } };
}

/** The rig the viewport shows while nothing runs: one player at `origin` with the devices the game has, and the free devices where they sit. */
export function previewRig(state: PeripheralState, origin: RigVec): RigView {
  const devices = devicesOf(state);
  const mode = (kind: PeripheralKind) => ownershipOf(state.ownership, kind).mode;
  return {
    avatars: [{
      id: 'preview', position: origin, yaw: 0, pitch: 0, driven: true, hapticAt: 0,
      devices: devices.filter((kind) => mode(kind) !== 'free').map((kind) => ({ kind, shared: mode(kind) === 'passed' })),
    }],
    free: devices.filter((kind) => mode(kind) === 'free').map((kind) => ({ kind, at: state.ownership[kind]?.at ?? DEFAULT_FREE_AT })),
  };
}

/** Drops the device, its signals, its ownership and the motion gestures that run on it. */
export function removePeripheral(state: PeripheralState, kind: PeripheralKind): PeripheralState {
  let inputs = state.inputs;
  if (inputs) for (const s of PERIPHERALS[kind].signals) inputs = setSignal(inputs, s.id, false);
  const { [kind]: _gone, ...ownership } = state.ownership;
  return {
    peripherals: state.peripherals.filter((k) => k !== kind),
    ownership,
    inputs,
    gestures: Object.fromEntries(Object.entries(state.gestures).filter(([, g]) => slotDevice(g.slot) !== kind)),
  };
}

/** Signals the scripts use that `declared` leaves off. */
export function missingSignals(declared: SceneInputs, used: SceneInputs): SignalId[] {
  return ALL_SIGNALS.filter((id) => signalOn(used, id) && !signalOn(declared, id));
}

/** A client script with the handler for a signal. Each stub reads as "used" to `inferInputs`, so the panel's status turns to "In use". */
export function handlerStub(id: SignalId): string {
  switch (id) {
    case 'head':
      return 'export default script({\n  onLookAt(self, ctx) {\n    // The player looked at this entity for half a second.\n  },\n});\n';
    case 'position':
      return 'export default script({\n  onTick(self, ctx, dt) {\n    // Five times a second. ctx.position is this player\'s [x, y, z] in meters, or null.\n    const position = ctx.position;\n  },\n});\n';
    case 'heartRate':
      return 'export default script({\n  onHeartRate(self, ctx, bpm) {\n    // ctx.intensity runs from 0 (resting) to 1 (hardest).\n  },\n});\n';
    default:
      return `export default script({\n  onGesture(self, ctx, gesture) {\n    if (gesture.type === "${id}") {\n    }\n  },\n});\n`;
  }
}

/** The base script name for a signal, with 2, 3 ... added until it is free. */
export function scriptNameFor(id: SignalId, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = signalDef(id).scriptName;
  let name = base;
  for (let n = 2; used.has(name); n++) name = `${base}${n}`;
  return name;
}
