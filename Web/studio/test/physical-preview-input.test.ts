import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserSensors } from '../src/livePreview/browserSensors';
import { parsePhysicalJoin, physicalPlayerUrl, phoneReachable, needsPreviewSession } from '../src/livePreview/physical';
import { bindPointerPad, pointerInput, type PointerInput } from '../src/livePreview/pointer';
import { PreviewDocument, pointerEvent } from './physical-preview-dom';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('physical preview pairing', () => {
  it.each([['phone', 'phone'], ['ipad', 'referee']] as const)('preserves exact game/lobby/kind/role for %s', (kind, role) => {
    const join = { gameId: 'game & one', lobby: 'AB12', kind, role };
    const url = new URL(physicalPlayerUrl('https://pear.test/', join));
    expect(url.pathname).toBe('/player.html');
    expect(parsePhysicalJoin(url.search)).toEqual(join);
    expect([...url.searchParams.keys()]).toEqual(['game', 'lobby', 'kind', 'role']);
  });
  it.each(['', '?game=g&lobby=A&kind=phone', '?game=g&lobby=a!&kind=phone&role=phone', '?game=g&lobby=ABCDEFGHIJKLM&kind=phone&role=phone', '?game=g&lobby=A&kind=watch&role=phone', '?game=g&lobby=A&kind=ipad&role=owner'])('rejects malformed pairing %s', (search) => {
    expect(parsePhysicalJoin(search)).toBeNull();
  });
  it('never starts a hidden simulator for a browser slot and warns on non-phone origins', () => {
    expect(needsPreviewSession('browser')).toBe(false);
    expect(needsPreviewSession('simulator')).toBe(true);
    expect(needsPreviewSession('companion')).toBe(true);
    for (const base of ['http://pear.test', 'https://localhost', 'https://127.0.0.1', 'https://127.0.0.2', 'https://0.0.0.0', 'https://[::1]', 'https://app.localhost', 'https://tauri.localhost', 'tauri://localhost', 'not a url']) expect(phoneReachable(base)).toBe(false);
    expect(phoneReachable('https://pear.test/player.html')).toBe(true);
  });
});

describe('browser Pencil pointer pad', () => {
  const rect = { left: 10, top: 20, width: 200, height: 100 };
  const data = { clientX: 500, clientY: -5, pressure: 2, tiltX: 120, tiltY: -100, buttons: 1, pointerType: 'pen' };
  it('normalizes and clamps finite coordinates, pressure and tilt; terminals clear contact', () => {
    expect(pointerInput(data, rect, 'down')).toEqual({ phase: 'down', pointerType: 'pen', x: 1, y: 0, pressure: 1, tiltX: 90, tiltY: -90, buttons: 1 });
    expect(pointerInput(data, rect, 'up')).toMatchObject({ pressure: 0, buttons: 0 });
    for (const key of ['clientX', 'clientY', 'pressure', 'tiltX', 'tiltY', 'buttons']) expect(pointerInput({ ...data, [key]: NaN }, rect, 'move')).toBeNull();
    expect(pointerInput(data, { ...rect, width: 0 }, 'move')).toBeNull();
    expect(pointerInput({ ...data, pointerType: 'unknown' }, rect, 'down')).toBeNull();
    expect(pointerInput({ ...data, buttons: -1 }, rect, 'down')).toBeNull();
    expect(pointerInput(data, rect, 'invented' as 'down')).toBeNull();
  });
  it('captures one pointer, caps moves at 30 Hz, always delivers up, and removes handlers on stop', () => {
    const pad = new PreviewDocument().root;
    const sent: PointerInput[] = [];
    let now = 0;
    const stop = bindPointerPad(pad.asElement(), (data) => sent.push(data), () => now);
    pad.dispatchEvent(pointerEvent('pointerdown'));
    expect(pad.hasPointerCapture(1)).toBe(true);
    pad.dispatchEvent(pointerEvent('pointerdown', { pointerId: 2 }));
    pad.dispatchEvent(pointerEvent('pointermove', { pointerId: 2 }));
    for (now = 0; now < 100; now++) pad.dispatchEvent(pointerEvent('pointermove'));
    pad.dispatchEvent(pointerEvent('pointerup'));
    expect(sent.map((x) => x.phase)).toEqual(['down', 'move', 'move', 'move', 'up']);
    expect(pad.hasPointerCapture(1)).toBe(false);
    stop();
    pad.dispatchEvent(pointerEvent('pointerdown'));
    expect(sent).toHaveLength(5);
  });
  it.each(['pointercancel', 'lostpointercapture', 'stop', 'malformed-up'])('cancels and releases a contact on %s', (reason) => {
    const pad = new PreviewDocument().root;
    const sent: PointerInput[] = [];
    const stop = bindPointerPad(pad.asElement(), (data) => sent.push(data));
    pad.dispatchEvent(pointerEvent('pointerdown'));
    if (reason === 'stop') stop();
    else pad.dispatchEvent(pointerEvent(reason === 'malformed-up' ? 'pointerup' : reason, reason === 'malformed-up' ? { pressure: NaN } : {}));
    expect(sent.map((x) => x.phase)).toEqual(['down', 'cancel']);
    expect(sent[1]).toMatchObject({ pressure: 0, buttons: 0 });
    expect(pad.hasPointerCapture(1)).toBe(false);
    stop();
    expect(sent).toHaveLength(2);
  });
});

describe('opt-in browser sensors', () => {
  function setup() {
    const events = new EventTarget();
    vi.stubGlobal('addEventListener', events.addEventListener.bind(events));
    vi.stubGlobal('removeEventListener', events.removeEventListener.bind(events));
    vi.stubGlobal('isSecureContext', true);
    const permission = vi.fn(async () => 'granted');
    vi.stubGlobal('DeviceOrientationEvent', { requestPermission: permission });
    let success: PositionCallback;
    let failure: PositionErrorCallback;
    const clearWatch = vi.fn();
    const watchPosition = vi.fn((ok: PositionCallback, fail: PositionErrorCallback) => { success = ok; failure = fail; return 7; });
    vi.stubGlobal('navigator', { geolocation: { watchPosition, clearWatch } });
    const sensors = new BrowserSensors();
    const motion = vi.fn();
    const gps = vi.fn();
    const stopMotion = sensors.hooks.sensor!({ type: 'sensor', kind: 'motion', hz: 1000 }, motion);
    sensors.hooks.sensor!({ type: 'sensor', kind: 'location' }, gps);
    const orientation = (values = { beta: 12, gamma: -4, alpha: 30 }) => events.dispatchEvent(Object.assign(new Event('deviceorientation'), values));
    const position = (latitude = 40, longitude = -74, accuracy = 3) => success({ coords: { latitude, longitude, accuracy } } as GeolocationPosition);
    return { sensors, motion, gps, stopMotion, orientation, position, permission, watchPosition, clearWatch, fail: () => failure({ message: 'denied' } as GeolocationPositionError) };
  }
  it('only shares requested, finite readings after consent, with motion rate bounded to 30 Hz', async () => {
    const t = setup();
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    t.orientation();
    expect(t.motion).not.toHaveBeenCalled();
    expect(t.watchPosition).not.toHaveBeenCalled();
    await t.sensors.enableMotion();
    t.orientation({ beta: NaN, gamma: 1, alpha: 2 });
    for (now = 0; now < 100; now++) t.orientation();
    expect(t.motion).toHaveBeenCalledTimes(3);
    expect(t.motion).toHaveBeenLastCalledWith({ pitch: 12, roll: -4, yaw: 30 });
    t.sensors.enableLocation();
    t.position(91); t.position(40, Infinity); t.position(40, -74, -1);
    expect(t.gps).not.toHaveBeenCalled();
    t.position();
    expect(t.gps).toHaveBeenCalledWith({ lat: 40, lng: -74, acc: 3 });
    if (t.stopMotion) t.stopMotion();
    now = 200; t.orientation();
    expect(t.motion).toHaveBeenCalledTimes(3);
    t.sensors.stop();
    t.position();
    expect(t.clearWatch).toHaveBeenCalledWith(7);
    expect(t.gps).toHaveBeenCalledTimes(1);
  });
  it('does not resume a pending motion permission after stop/disconnect', async () => {
    const t = setup();
    let grant!: (permission: string) => void;
    t.permission.mockImplementation(() => new Promise((resolve) => { grant = resolve; }));
    const pending = t.sensors.enableMotion();
    t.sensors.stop(); grant('granted');
    expect(await pending).toBe(false);
    t.orientation();
    expect(t.motion).not.toHaveBeenCalled();
  });
  it('reports denied/unsupported permissions and clears a failed location watch', async () => {
    const t = setup();
    t.permission.mockResolvedValue('denied');
    await expect(t.sensors.enableMotion()).rejects.toThrow('denied');
    const onError = vi.fn(); t.sensors.onError = onError;
    t.sensors.enableLocation(); t.fail();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('Location unavailable'));
    expect(t.clearWatch).toHaveBeenCalledWith(7);
    t.sensors.enableLocation();
    expect(t.watchPosition).toHaveBeenCalledTimes(2);
    t.sensors.stop();
    vi.stubGlobal('isSecureContext', false);
    await expect(t.sensors.enableMotion()).rejects.toThrow('HTTPS');
    expect(() => t.sensors.enableLocation()).toThrow('HTTPS');
  });
});
