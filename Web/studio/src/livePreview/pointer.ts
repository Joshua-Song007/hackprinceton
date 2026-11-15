export type PointerPhase = 'down' | 'move' | 'up' | 'cancel';
export interface PointerInput {
  phase: PointerPhase;
  pointerType: 'pen' | 'touch' | 'mouse';
  x: number; y: number; pressure: number; tiltX: number; tiltY: number; buttons: number;
}
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Explicit game event contract, not a PearUI sensor or a native Pencil promise. */
export function pointerInput(e: Pick<PointerEvent, 'clientX' | 'clientY' | 'pressure' | 'tiltX' | 'tiltY' | 'buttons' | 'pointerType'>, rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>, phase: PointerPhase): PointerInput | null {
  if (![e.clientX, e.clientY, e.pressure, e.tiltX, e.tiltY, e.buttons, rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) return null;
  if (!['down', 'move', 'up', 'cancel'].includes(phase) || !['pen', 'touch', 'mouse'].includes(e.pointerType) || !Number.isInteger(e.buttons) || e.buttons < 0) return null;
  return { phase, pointerType: e.pointerType as PointerInput['pointerType'], x: clamp((e.clientX - rect.left) / rect.width, 0, 1), y: clamp((e.clientY - rect.top) / rect.height, 0, 1), pressure: phase === 'up' || phase === 'cancel' ? 0 : clamp(e.pressure, 0, 1), tiltX: clamp(e.tiltX, -90, 90), tiltY: clamp(e.tiltY, -90, 90), buttons: phase === 'up' || phase === 'cancel' ? 0 : e.buttons };
}

/** One captured pointer; movement is bounded to 30 Hz, terminal events always pass. Stop cancels the gesture. */
export function bindPointerPad(pad: HTMLElement, send: (input: PointerInput) => void, now: () => number = () => performance.now()): () => void {
  let active: number | null = null;
  let lastMove = -Infinity;
  let last: PointerInput | null = null;
  const release = () => {
    const id = active;
    active = null;
    if (id !== null && pad.hasPointerCapture(id)) pad.releasePointerCapture(id);
  };
  const cancel = () => {
    if (active !== null && last) send({ ...last, phase: 'cancel', pressure: 0, buttons: 0 });
    release();
    last = null;
  };
  const handle = (e: PointerEvent) => {
    const phase: PointerPhase = e.type === 'pointerdown' ? 'down' : e.type === 'pointermove' ? 'move' : e.type === 'pointerup' ? 'up' : 'cancel';
    if (phase === 'down' ? active !== null : active !== e.pointerId) return;
    const input = pointerInput(e, pad.getBoundingClientRect(), phase);
    if (!input) { if (phase === 'up' || phase === 'cancel') cancel(); return; }
    e.preventDefault();
    if (phase === 'down') { active = e.pointerId; lastMove = -Infinity; pad.setPointerCapture(e.pointerId); }
    last = input;
    const t = now();
    if (phase !== 'move' || t - lastMove >= 1000 / 30) { send(input); if (phase === 'move') lastMove = t; }
    if (phase === 'up' || phase === 'cancel') { release(); last = null; }
  };
  const types = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'] as const;
  types.forEach((type) => pad.addEventListener(type, handle));
  pad.addEventListener('lostpointercapture', cancel);
  return () => { cancel(); types.forEach((type) => pad.removeEventListener(type, handle)); pad.removeEventListener('lostpointercapture', cancel); };
}
