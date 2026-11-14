// Client for the local device relay (`npm run relay`): lists the phones the relay has accepted and receives their USIS packets.
// Localhost only (Network Rule): sensor data goes from the relay to this page and nowhere else.
import { validateUsis, type UsisPacket } from '@omni/core';

export const RELAY_URL = 'ws://127.0.0.1:8787';

export interface RelayDevice { id: string; name: string; kind: string }

export class RelayClient {
  status: 'idle' | 'open' | 'failed' = 'idle';
  devices: RelayDevice[] = [];
  onChange?: () => void;
  onPacket?: (deviceId: string, packet: UsisPacket) => void;
  private ws: WebSocket | null = null;

  connect(): void {
    if (this.ws) return;
    let ws: WebSocket;
    try { ws = new WebSocket(RELAY_URL); } catch { this.status = 'failed'; this.onChange?.(); return; }
    this.ws = ws;
    ws.onopen = () => { this.status = 'open'; this.onChange?.(); };
    ws.onclose = ws.onerror = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.devices = [];
      this.status = 'failed';
      this.onChange?.();
    };
    ws.onmessage = (e) => {
      let m: { type?: string; devices?: RelayDevice[]; deviceId?: string; packet?: unknown };
      try { m = JSON.parse(String(e.data)); } catch { return; }
      if (m.type === 'devices' && Array.isArray(m.devices)) { this.devices = m.devices; this.onChange?.(); }
      else if (m.type === 'packet' && typeof m.deviceId === 'string') {
        const v = validateUsis(m.packet);
        if (v.ok) this.onPacket?.(m.deviceId, v.packet);
      }
    };
  }

  sendOutput(deviceId: string, command: { target: string; type: 'haptic'; pattern: string; intensity: number; durationMs: number }): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'output', deviceId, command }));
  }

  close(): void {
    const ws = this.ws;
    this.ws = null;
    this.devices = [];
    this.status = 'idle';
    ws?.close();
  }
}
