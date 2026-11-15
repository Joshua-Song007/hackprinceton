import type { Hooks, Node } from '@pear/ui';
import { sensorHz } from './helpers';

interface Subscription { node: Node; emit: (data: unknown) => void; last: number }

/** No listeners, location requests or cloud readings until the player explicitly opts in. */
export class BrowserSensors {
  private subscriptions = new Set<Subscription>();
  private motion = false;
  private location: number | null = null;
  private generation = 0;
  onReading: (text: string) => void = () => {};
  onError: (text: string) => void = () => {};
  hooks: Hooks = {
    sensor: (node, emit) => {
      const sub = { node, emit, last: -Infinity };
      this.subscriptions.add(sub);
      return () => { this.subscriptions.delete(sub); };
    },
  };

  private emit(kind: Node['kind'], data: unknown): void {
    const now = performance.now();
    for (const sub of this.subscriptions) {
      if (sub.node.kind !== kind || now - sub.last < 1000 / sensorHz(sub.node, kind === 'location' ? 1 : 10)) continue;
      sub.last = now;
      sub.emit(data);
      this.onReading(`${kind}: ${JSON.stringify(data)}`);
    }
  }

  private orientation = (e: DeviceOrientationEvent) => {
    if (!this.motion || ![e.beta, e.gamma, e.alpha].every((v) => typeof v === 'number' && Number.isFinite(v))) return;
    this.emit('motion', { pitch: e.beta, roll: e.gamma, yaw: e.alpha });
  };

  async enableMotion(): Promise<boolean> {
    if (!globalThis.isSecureContext) throw new Error('Motion needs HTTPS. Open the secure pairing link.');
    const E = globalThis.DeviceOrientationEvent as typeof DeviceOrientationEvent & { requestPermission?: () => Promise<string> };
    if (!E) throw new Error('This browser does not expose device orientation.');
    const generation = this.generation;
    if (E.requestPermission && await E.requestPermission() !== 'granted') throw new Error('Motion permission denied. Allow Motion & Orientation in browser settings, then retry.');
    if (generation !== this.generation) return false;
    if (!this.motion) addEventListener('deviceorientation', this.orientation);
    this.motion = true;
    return true;
  }

  enableLocation(): void {
    if (!globalThis.isSecureContext || !navigator.geolocation) throw new Error('Location needs HTTPS and a browser with location access.');
    if (this.location !== null) return;
    const generation = this.generation;
    this.location = navigator.geolocation.watchPosition((p) => {
      if (generation !== this.generation) return;
      const { latitude: lat, longitude: lng, accuracy: acc } = p.coords;
      if (![lat, lng, acc].every(Number.isFinite) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || acc < 0) return;
      this.emit('location', { lat, lng, acc });
    }, (e) => {
      if (generation !== this.generation) return;
      this.onError(`Location unavailable: ${e.message}. Check this site's location permission and retry.`);
      if (this.location !== null) navigator.geolocation.clearWatch(this.location);
      this.location = null;
    }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 });
  }

  stop(): void {
    this.generation++;
    removeEventListener('deviceorientation', this.orientation);
    this.motion = false;
    if (this.location !== null) navigator.geolocation.clearWatch(this.location);
    this.location = null;
  }
}
