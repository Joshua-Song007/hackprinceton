// Real loopback HTTP/WebSocket + the actual browser player/PearUI + PearScript host.
// This proves protocol delivery, not a production Rust backend, browser engine or real device.
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { afterEach, expect, it, vi } from 'vitest';
import type { WebSocketLike } from '@pear/cloud';
import { LocalServer } from '@pear/script';
import prelude from '../../../Packages/PearScript/Sources/PearScript/Resources/prelude.js?raw';
import { physicalPlayerUrl } from '../src/livePreview/physical';
import { PreviewDocument, pointerEvent } from './physical-preview-dom';

interface Peer {
  send(data: string): void;
  close(): void;
  on(event: string, callback: (data: { toString(): string }) => void): void;
}
interface WsServer {
  clients: Set<Peer>;
  on(event: 'connection', callback: (peer: Peer, req: IncomingMessage) => void): void;
  close(callback: () => void): void;
}
const { WebSocket, WebSocketServer } = createRequire(import.meta.url)('ws') as {
  WebSocket: new (url: string) => WebSocketLike;
  WebSocketServer: new (options: { server: Server }) => WsServer;
};
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it.each([['phone', 'phone'], ['ipad', 'referee']] as const)('physical %s joins the intended lobby and delivers button, pointer, motion and GPS events', async (kind, role) => {
  const doc = new PreviewDocument();
  const windowEvents = new EventTarget();
  const events: { name: string; data: unknown }[] = [];
  const joins: URL[] = [];
  const errors: string[] = [];
  const peers = new Map<string, Peer>();
  const ui = { pearui: 1, route: [{ when: 'ev.screen.visible', screen: 'game' }, { screen: 'waiting' }], screens: { waiting: { type: 'text', value: 'Waiting for game' }, game: { type: 'column', children: [
    { type: 'text', value: '{{device.kind}}' },
    { type: 'text', value: '{{ev.ack.name}} · {{ev.ack.lobby}}' },
    { type: 'button', label: 'Fire', action: { send: 'tap', data: { hit: true } } },
    { type: 'sensor', kind: 'motion', event: 'aim' },
    { type: 'sensor', kind: 'location', event: 'position' },
  ] } } };
  const host = new LocalServer({ prelude, lobby: 'PAIR42', onError: (e) => errors.push(e), onFire: (id, name, data) => {
    for (const [playerId, peer] of peers) if (id === null || id === playerId) peer.send(JSON.stringify({ name, data }));
  } });
  host.load([`export default serverScript({
    onPlayerJoin(ctx, player) { ctx.remote.fire(player.id, 'screen', { visible: true }); },
    onRemote(ctx, player, name, data) { ctx.remote.fire(player.id, 'ack', { from: player.id, lobby: ctx.lobby, name, data }); }
  });`]);
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/accounts/signin') {
      res.end(JSON.stringify({ token: 'physical-token', account: {} }));
    } else if (req.url === '/api/games/g-physical/versions/latest') {
      res.end(JSON.stringify({ version: 1, assets: { 'ui.json': { data: Buffer.from(JSON.stringify(ui)).toString('base64') } } }));
    } else { res.statusCode = 404; res.end('{}'); }
  });
  const wss = new WebSocketServer({ server });
  wss.on('connection', (peer, req) => {
    const url = new URL(req.url!, 'http://loopback');
    joins.push(url);
    if (url.pathname !== '/play/g-physical' || url.searchParams.get('lobby') !== 'PAIR42' || url.searchParams.get('token') !== 'physical-token') { peer.close(); return; }
    peers.set('physical-player', peer);
    peer.send(JSON.stringify({ name: '_welcome', data: { id: 'physical-player', name: 'My device', lobby: 'PAIR42' } }));
    host.join('physical-player', 'My device');
    peer.on('message', (raw) => {
      const frame = JSON.parse(raw.toString());
      events.push(frame);
      host.remote('physical-player', frame.name, frame.data);
    });
    peer.on('close', () => { host.leave('physical-player'); peers.delete('physical-player'); });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(async () => {
    host.dispose();
    for (const peer of wss.clients) peer.close();
    await new Promise<void>((resolve) => wss.close(resolve));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No loopback port');
  const base = `http://127.0.0.1:${address.port}`;
  const playerUrl = new URL(physicalPlayerUrl(base, { gameId: 'g-physical', lobby: 'PAIR42', kind, role }));
  let locationSuccess!: PositionCallback;
  const clearWatch = vi.fn();
  vi.stubGlobal('document', doc);
  vi.stubGlobal('location', playerUrl);
  vi.stubGlobal('WebSocket', WebSocket);
  vi.stubGlobal('PointerEvent', Event);
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('DeviceOrientationEvent', { requestPermission: async () => 'granted' });
  vi.stubGlobal('navigator', { geolocation: { watchPosition: (success: PositionCallback) => { locationSuccess = success; return 9; }, clearWatch } });
  vi.stubGlobal('addEventListener', windowEvents.addEventListener.bind(windowEvents));
  vi.stubGlobal('removeEventListener', windowEvents.removeEventListener.bind(windowEvents));
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => setTimeout(fn, 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  cleanups.push(async () => { windowEvents.dispatchEvent(new Event('pagehide')); });
  vi.resetModules();
  await import('../src/livePreview/player');
  const button = (label: string) => {
    const found = doc.root.find((e) => e.tagName === 'button' && e.textContent === label)[0];
    if (!found) throw new Error(`Missing button: ${label}; player: ${doc.root.textContent.slice(0, 1300)}; script errors: ${errors.join(', ')}`);
    return found;
  };
  expect(doc.root.textContent).toContain('No input sent yet.');
  button('Join lobby').click();
  await vi.waitFor(() => expect(events[0]).toEqual({ name: 'role', data: { kind, role } }));
  expect(joins).toHaveLength(1);
  expect(joins[0].pathname).toBe('/play/g-physical');
  expect(joins[0].searchParams.get('lobby')).toBe('PAIR42');
  await vi.waitFor(() => expect(doc.root.textContent).toContain('Connected · My device · lobby PAIR42'));
  await vi.waitFor(() => expect(button('Fire')).toBeDefined());
  button('Fire').click();
  await vi.waitFor(() => expect(events).toContainEqual({ name: 'tap', data: { hit: true } }));
  await vi.waitFor(() => expect(doc.root.textContent).toContain('tap · PAIR42'));
  button('Enable Touch / Pencil pad').click();
  const pad = doc.root.find((e) => e.className === 'player-pad')[0];
  pad.dispatchEvent(pointerEvent('pointerdown'));
  pad.dispatchEvent(pointerEvent('pointerup'));
  await vi.waitFor(() => expect(events).toContainEqual({ name: 'pointer', data: { phase: 'down', pointerType: 'pen', x: .5, y: .5, pressure: .5, tiltX: 20, tiltY: -10, buttons: 1 } }));
  button('Enable motion').click();
  await vi.waitFor(() => expect(button('Motion enabled').disabled).toBe(false));
  windowEvents.dispatchEvent(Object.assign(new Event('deviceorientation'), { beta: 8, gamma: -2, alpha: 90 }));
  button('Enable location').click();
  locationSuccess({ coords: { latitude: 40, longitude: -74, accuracy: 4 } } as GeolocationPosition);
  await vi.waitFor(() => expect(events).toContainEqual({ name: 'aim', data: { pitch: 8, roll: -2, yaw: 90 } }));
  await vi.waitFor(() => expect(events).toContainEqual({ name: 'position', data: { lat: 40, lng: -74, acc: 4 } }));
  // A route disappearing must release its sensor hooks and remount on return.
  const peer = peers.get('physical-player')!;
  peer.send(JSON.stringify({ name: 'screen', data: { visible: false } }));
  await vi.waitFor(() => expect(doc.root.textContent).toContain('Waiting for game'));
  peer.send(JSON.stringify({ name: 'screen', data: { visible: true } }));
  await vi.waitFor(() => expect(button('Fire')).toBeDefined());
  // Malformed wire data must not destroy the working screen.
  peer.send('not-json'); peer.send('null'); peer.send(JSON.stringify({ name: 3 }));
  button('Fire').click();
  await vi.waitFor(() => expect(events.filter((e) => e.name === 'tap')).toHaveLength(2));
  // Disconnect stops capture/watch/listeners, and never queues input for a reconnect.
  pad.dispatchEvent(pointerEvent('pointerdown'));
  peer.close();
  await vi.waitFor(() => expect(button('Enable Touch / Pencil pad').disabled).toBe(true));
  expect(clearWatch).toHaveBeenCalledWith(9);
  expect(pad.hasPointerCapture(1)).toBe(false);
  const count = events.length;
  pad.dispatchEvent(pointerEvent('pointermove'));
  locationSuccess({ coords: { latitude: 41, longitude: -74, accuracy: 4 } } as GeolocationPosition);
  windowEvents.dispatchEvent(Object.assign(new Event('deviceorientation'), { beta: 9, gamma: 1, alpha: 2 }));
  button('Leave lobby').click();
  expect(events).toHaveLength(count);
  expect(doc.root.textContent).toContain('You left the lobby. Inputs stopped.');
  expect(errors).toEqual([]);
}, 10000);
