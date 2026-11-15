import { afterEach, expect, it, vi } from 'vitest';
import { RelayClient } from '../src/relay';

class Socket {
  static OPEN = 1;
  static latest: Socket;
  onopen?: () => void;
  onclose?: () => void;
  onmessage?: (event: { data: string }) => void;
  constructor() { Socket.latest = this; }
  close() { this.onclose?.(); }
}
afterEach(() => vi.unstubAllGlobals());

it('reports connecting separately from real devices and clears devices on disconnect', () => {
  vi.stubGlobal('WebSocket', Socket);
  const relay = new RelayClient();
  relay.connect();
  expect(relay.status).toBe('connecting');
  Socket.latest.onopen?.();
  expect(relay.status).toBe('open');
  expect(relay.devices).toEqual([]);
  Socket.latest.onmessage?.({ data: JSON.stringify({ type: 'devices', devices: [{ id: 'real', name: 'My phone', kind: 'phone' }] }) });
  expect(relay.devices).toHaveLength(1);
  Socket.latest.onclose?.();
  expect(relay.status).toBe('failed');
  expect(relay.devices).toEqual([]);
});

it('ignores stale socket events after an explicit disconnect', () => {
  vi.stubGlobal('WebSocket', Socket);
  const relay = new RelayClient();
  relay.connect();
  const stale = Socket.latest;
  relay.close();
  stale.onopen?.();
  stale.onmessage?.({ data: JSON.stringify({ type: 'devices', devices: [{ id: 'stale' }] }) });
  expect(relay.status).toBe('idle');
  expect(relay.devices).toEqual([]);
});
