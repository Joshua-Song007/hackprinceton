// What a game needs from each player (scene `inputs`), what its scripts actually use, and which simulated devices
// provide it. Pure, so the Test panel checklist and Play share one answer and tests cover it.
import { GESTURE_TYPES, type GestureType } from '@pear/core';
import type { CustomGesture, PeripheralKind, SceneInputs } from '@pear/runtime';
import type { SimDeviceKind } from '@pear/sim';

/** Reads the client scripts: a quoted gesture name, `ctx.position`, heart rate and head handlers. Players stay 1 to 32. */
export function inferInputs(clientScripts: Record<string, string>): SceneInputs {
  const src = Object.values(clientScripts).join('\n');
  return {
    head: /\bonLookAt\b|\bonTriggerEnter\b|\bonTriggerExit\b/.test(src),
    position: /\bctx\.position\b/.test(src),
    heartRate: /\bonHeartRate\b|\bctx\.intensity\b/.test(src),
    gestures: GESTURE_TYPES.filter((g) => new RegExp(`["']${g}["']`).test(src)),
    players: [1, 32],
  };
}

/**
 * Devices that provide the inputs in the simulator, plus every device the scene lists as a peripheral. Head rides on
 * the AirPods head device, position is a phone GPS fix, gestures also on the phone, heart rate on the watch.
 */
export function rigFor(inputs: SceneInputs | null | undefined, custom: Record<string, CustomGesture> = {}, peripherals: readonly PeripheralKind[] = []): SimDeviceKind[] {
  const kinds = new Set<SimDeviceKind>(peripherals);
  if (inputs?.head) kinds.add('airpods');
  if (inputs?.gestures.length || inputs?.position) kinds.add('phone');
  if (inputs?.heartRate) kinds.add('watch');
  for (const g of Object.values(custom)) kinds.add(slotDevice(g.slot));
  return (['airpods', 'phone', 'watch'] as const).filter((k) => kinds.has(k));
}

/** The simulated device that carries a slot. */
export function slotDevice(slot: string): SimDeviceKind {
  return slot === 'head' ? 'airpods' : slot === 'leftWrist' || slot === 'rightWrist' ? 'watch' : 'phone';
}

/** What the scripts use that `declared` leaves out, as the inputs with those added; null when nothing is missing. */
export function missingInputs(declared: SceneInputs, used: SceneInputs): { names: string[]; merged: SceneInputs } | null {
  const names: string[] = [];
  if (used.head && !declared.head) names.push('head');
  if (used.position && !declared.position) names.push('position');
  if (used.heartRate && !declared.heartRate) names.push('heart rate');
  const extra = used.gestures.filter((g) => !declared.gestures.includes(g));
  names.push(...extra);
  if (!names.length) return null;
  return {
    names,
    merged: {
      ...declared,
      head: declared.head || used.head,
      position: declared.position || used.position,
      heartRate: declared.heartRate || used.heartRate,
      gestures: GESTURE_TYPES.filter((g) => declared.gestures.includes(g) || extra.includes(g)),
    },
  };
}

/** One line for people: "head, position, tap, double tap; 2 to 32 players". */
export function describeInputs(i: SceneInputs): string {
  const label: Record<GestureType, string> = { tap: 'tap', doubleTap: 'double tap', flick: 'flick', squeeze: 'squeeze', pinch: 'pinch' };
  const parts = [i.head && 'head', i.position && 'position', i.heartRate && 'heart rate', ...i.gestures.map((g) => label[g])].filter(Boolean);
  const players = i.players[0] === i.players[1] ? `${i.players[0]} player${i.players[0] === 1 ? '' : 's'}` : `${i.players[0]} to ${i.players[1]} players`;
  return `${parts.length ? parts.join(', ') : 'no input'}; ${players}`;
}
