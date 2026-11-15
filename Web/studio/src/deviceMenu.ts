// The menu that opens when a creator clicks a device in the viewport: what that device can do in a test (phone gestures, watch
// heart-rate presets) and, for a passed device, who to give it to. Pure, so the Test panel and the viewport share one answer.
import { GESTURE_TYPES, type GestureType } from '@pear/core';
import type { RigDevice, SceneInputs } from '@pear/runtime';
import type { MenuItem } from './ui';

export const HEART_PRESETS = [['Rest', 60], ['Walk', 90], ['Run', 140], ['Spike', 180]] as const;

const GESTURE_LABEL: Record<GestureType, string> = { tap: 'Tap', doubleTap: 'Double tap', flick: 'Flick', squeeze: 'Squeeze', pinch: 'Pinch' };
const DEVICE_LABEL: Record<RigDevice, string> = { phone: 'iPhone', watch: 'Apple Watch', airpods: 'AirPods' };

export interface DeviceMenuActions {
  gesture(type: GestureType): void;
  heartRate(bpm: number): void;
  give(playerId: string): void;
}

/**
 * Items for one device. A phone offers the gestures the game declares (all of them when it declares none), a watch the
 * heart-rate presets. `holder` is the player holding a passed device (null otherwise): the menu adds Give to each other player.
 */
export function deviceMenuItems(
  kind: RigDevice, inputs: SceneInputs | null, players: readonly { id: string; name: string }[], holder: string | null, act: DeviceMenuActions,
): MenuItem[] {
  const items: MenuItem[] = [{ heading: true, label: DEVICE_LABEL[kind] }];
  if (kind === 'phone') {
    const gestures = GESTURE_TYPES.filter((g) => !inputs || inputs.gestures.includes(g));
    items.push(...(gestures.length ? gestures.map((g) => ({ label: GESTURE_LABEL[g], run: () => act.gesture(g) })) : [{ label: 'The game uses no gestures', disabled: true }]));
  } else if (kind === 'watch') {
    items.push(...HEART_PRESETS.map(([label, bpm]) => ({ label: `${label} (${bpm} bpm)`, run: () => act.heartRate(bpm) })));
  } else {
    items.push({ label: 'Turn the head with the arrow keys', disabled: true });
  }
  const others = players.filter((p) => p.id !== holder);
  if (holder !== null && others.length) {
    items.push({ separator: true }, { heading: true, label: 'Give to' }, ...others.map((p) => ({ label: p.name, run: () => act.give(p.id) })));
  }
  return items;
}
