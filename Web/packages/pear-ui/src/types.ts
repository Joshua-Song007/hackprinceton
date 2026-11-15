// PearUI v1 (plan.md Phase 14, Contract C1): a game's native screens as data, rendered 1:1 by this package (web)
// and Apps/PearPlayer/PearPlayer/Play/PearUI (SwiftUI). Games cannot ship code to iOS, so screens are JSON.

export type Tone = 'neutral' | 'accent' | 'good' | 'bad' | 'warn';
export type Size = 's' | 'm' | 'l' | 'xl' | 'huge';
export interface Style { tone?: Tone; size?: Size; align?: 'start' | 'center' | 'end'; pad?: number; grow?: boolean;
  /** Rounded panel fill / dashed outline (full width, min 52pt), monospace, tracked caps label, one shrinking line. */
  card?: boolean; dashed?: boolean; mono?: boolean; caps?: boolean; fit?: boolean;
  /** Screen root only: whole-screen background, a fill name or `{{expr}}` yielding one. */
  fill?: 'bad' | 'accent' | 'neutral' | 'black' | string }

export type Action = { send: string; data?: Record<string, unknown> } | { set: string; value?: unknown };

export interface BaseNode { type: string; if?: string; id?: string; style?: Style }
export interface Node extends BaseNode {
  children?: Node[];
  value?: unknown;
  label?: string;
  action?: Action;
  src?: string;
  until?: string;
  items?: string;
  /** list: `row` lays items side by side with equal widths (default column). */
  direction?: 'row' | 'column';
  item?: Node;
  markers?: string;
  follow?: string;
  kind?: 'motion' | 'location';
  event?: string;
  hz?: number;
  on?: string;
  haptic?: 'light' | 'heavy' | 'success' | 'fail';
  sound?: string;
}

export interface Route { when?: string; screen: string }
export interface PearUI { pearui: 1; route: Route[]; screens: Record<string, Node> }

export interface ViewState {
  ev: Record<string, unknown>;
  me?: { id?: string; name?: string; lobby?: string };
  local: Record<string, unknown>;
  device: { kind: 'phone' | 'ipad' | 'watch' };
  item?: unknown;
}

/** What a client sends or stores when the user acts. */
export type OutAction = { name: string; data: unknown } | { set: string; value: unknown };

/** Folds one script→client frame into the view state (`_welcome` → me, anything else → ev[name]). */
export function reduceFrame(state: ViewState, frame: { name: string; data?: unknown }): ViewState {
  if (frame.name === '_welcome') return { ...state, me: (frame.data ?? {}) as ViewState['me'] };
  return { ...state, ev: { ...state.ev, [frame.name]: frame.data } };
}

export const emptyState = (kind: ViewState['device']['kind'] = 'phone'): ViewState => ({ ev: {}, local: {}, device: { kind } });
