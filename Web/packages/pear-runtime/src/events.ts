// Derives script events from an InputFrame and the scene: trigger enter/exit (head probe), look-at, gestures, heart rate.
// Mirrors TriggerSystem, LookAtDetector, GestureEventMapper and HeartRateIntensity in the Swift PearRuntime, except
// look-at tests the head forward ray against the entity's box bounds instead of an angle cone [provisional].
import { quat, vec3, type Slot, type Vec3 } from '@pear/core';
import type { InputFrame } from './input';
import { flattenScene, scriptName, type CustomGesture, type SceneDescription, type WorldEntity } from './scene';

export type GameHandler = 'onLookAt' | 'onGesture' | 'onHeartRate' | 'onTriggerEnter' | 'onTriggerExit';

/** A handler call for a script. `entity` is a `WorldEntity.id`; undefined means every scripted entity. */
export interface GameEvent {
  handler: GameHandler;
  entity?: string;
  /** Handler arguments after (self, ctx). */
  args: unknown[];
  /** Normalized heart-rate intensity, set on `onHeartRate` only (becomes `ctx.intensity`). */
  intensity?: number;
}

export interface EventOptions {
  /** Seconds of continuous gaze before `onLookAt` fires. Default 0.5 s. */
  lookDwellMs?: number;
  restBpm?: number;
  maxBpm?: number;
}

/** Entity-local frame: undo translation, rotation and scale. Boundary counts as inside. */
function toLocal(e: WorldEntity, p: Vec3): Vec3 {
  const r = quat.rotate(quat.conjugate(e.rotation), vec3.sub(p, e.position));
  return [r[0] / e.scale[0], r[1] / e.scale[1], r[2] / e.scale[2]];
}

/** Ray vs the entity's unit box (1 m cube scaled by entity scale), slab method in local space. */
export function rayHitsEntity(e: WorldEntity, origin: Vec3, direction: Vec3): boolean {
  const o = toLocal(e, origin);
  // A head inside the box has no direction to it, like LookAtDetector's zero-distance case.
  if (o.every((v) => Math.abs(v) <= 0.5)) return false;
  const dRaw = quat.rotate(quat.conjugate(e.rotation), direction);
  let tMin = 0;
  let tMax = Infinity;
  for (let axis = 0; axis < 3; axis++) {
    const d = dRaw[axis]! / e.scale[axis]!;
    const oa = o[axis]!;
    if (Math.abs(d) < 1e-12) {
      if (Math.abs(oa) > 0.5) return false;
      continue;
    }
    const t1 = (-0.5 - oa) / d;
    const t2 = (0.5 - oa) / d;
    tMin = Math.max(tMin, Math.min(t1, t2));
    tMax = Math.min(tMax, Math.max(t1, t2));
    if (tMin > tMax) return false;
  }
  return true;
}

function insideTrigger(e: WorldEntity, p: Vec3): boolean {
  const trigger = e.components.find((c) => c.type === 'trigger');
  if (trigger?.type !== 'trigger') return false;
  const local = toLocal(e, p);
  if (trigger.shape === 'sphere') return vec3.length(local) <= trigger.radius;
  return local.every((v, i) => Math.abs(v) <= trigger.size[i]! / 2);
}

export class SceneEvents {
  readonly entities: WorldEntity[];
  private playerOrigin: Vec3;
  private options: Required<EventOptions>;
  private occupants = new Map<string, Set<Slot>>();
  private gazeMs = new Map<string, number>();
  private fired = new Set<string>();
  private lastBpm: number | undefined;
  private custom: [string, CustomGesture][];
  /** Per custom gesture: above threshold last tick (rising-edge detection, since accel is sample-and-hold) and cooldown left. */
  private motion = new Map<string, { above: boolean; coolMs: number }>();

  constructor(scene: SceneDescription, options: EventOptions = {}) {
    this.custom = Object.entries(scene.gestures ?? {});
    this.entities = flattenScene(scene);
    this.playerOrigin = scene.playerOrigin;
    this.options = { lookDwellMs: 500, restBpm: 60, maxBpm: 180, ...options };
  }

  /** Events for one tick, in order: triggers, look-at, gestures, heart rate. `dtMs` is the time since the last step. */
  step(frame: InputFrame, dtMs: number): GameEvent[] {
    const events: GameEvent[] = [];
    const head = frame.devices.find((d) => d.slot === 'head');

    // Probes: one per slot, first non-stale device with a position; the head falls back to playerOrigin.
    const probes = new Map<Slot, Vec3>();
    for (const d of frame.devices) {
      if (d.stale) continue;
      const p = d.position ?? (d.slot === 'head' ? this.playerOrigin : undefined);
      if (p) probes.set(d.slot, p);
    }
    for (const e of this.entities) {
      const trigger = e.components.find((c) => c.type === 'trigger');
      if (trigger?.type !== 'trigger') continue;
      const before = this.occupants.get(e.id) ?? new Set<Slot>();
      const inside = new Set<Slot>();
      const observed = new Set<Slot>();
      for (const [slot, p] of probes) {
        if (!trigger.probeSlots.includes(slot)) continue;
        observed.add(slot);
        if (insideTrigger(e, p)) inside.add(slot);
      }
      const left = [...before].filter((s) => observed.has(s) && !inside.has(s)).sort();
      const entered = [...inside].filter((s) => !before.has(s)).sort();
      this.occupants.set(e.id, new Set([...before].filter((s) => !left.includes(s)).concat(entered)));
      for (const slot of left) events.push({ handler: 'onTriggerExit', entity: e.id, args: [slot] });
      for (const slot of entered) events.push({ handler: 'onTriggerEnter', entity: e.id, args: [slot] });
    }

    // Look-at: a stale or orientation-less head freezes the timers.
    if (head && !head.stale && head.orientation) {
      const origin = head.position ?? this.playerOrigin;
      const forward = quat.forward(head.orientation);
      for (const e of this.entities) {
        if (!scriptName(e)) continue;
        if (!rayHitsEntity(e, origin, forward)) {
          this.gazeMs.delete(e.id);
          this.fired.delete(e.id);
          continue;
        }
        const total = (this.gazeMs.get(e.id) ?? 0) + Math.max(0, dtMs);
        this.gazeMs.set(e.id, total);
        if (total >= this.options.lookDwellMs && !this.fired.has(e.id)) {
          this.fired.add(e.id);
          events.push({ handler: 'onLookAt', entity: e.id, args: [] });
        }
      }
    }

    for (const d of frame.devices) {
      if (d.stale) continue;
      for (const g of d.gestures) events.push({ handler: 'onGesture', args: [{ type: g.type, ...(g.dir ? { dir: g.dir } : {}), ...(g.t !== undefined ? { t: g.t } : {}) }] });
    }

    // Custom motion gestures: accel along the axis rising past the threshold fires once, then cools down.
    for (const [name, def] of this.custom) {
      const m = this.motion.get(name) ?? { above: false, coolMs: 0 };
      m.coolMs = Math.max(0, m.coolMs - Math.max(0, dtMs));
      const d = frame.devices.find((x) => x.slot === def.slot && !x.stale && x.accel);
      const along = d?.accel ? vec3.dot(d.accel, def.axis) : 0;
      const above = along >= def.threshold;
      if (above && !m.above && m.coolMs === 0) {
        events.push({ handler: 'onGesture', args: [{ type: name, dir: def.axis }] });
        m.coolMs = def.cooldownMs;
      }
      m.above = above;
      this.motion.set(name, m);
    }

    const bpm = frame.devices.find((d) => !d.stale && d.heartRate !== undefined)?.heartRate;
    if (bpm !== undefined && bpm !== this.lastBpm) {
      this.lastBpm = bpm;
      const { restBpm, maxBpm } = this.options;
      const intensity = maxBpm > restBpm ? Math.min(Math.max((bpm - restBpm) / (maxBpm - restBpm), 0), 1) : 0;
      events.push({ handler: 'onHeartRate', args: [bpm], intensity });
    }
    return events;
  }
}
