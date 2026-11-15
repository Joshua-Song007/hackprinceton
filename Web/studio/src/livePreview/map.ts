// GPS map: MapLibre on OSM raster tiles (no key), one draggable marker per preview device.
// Dragging a marker reports the new position; setPosition moves a marker when a frame carries lat/lng.
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { el } from '../ui';

export interface LatLng { lat: number; lng: number }

/** Princeton University, where the hackathon runs; markers start a few metres apart so both are visible. */
export const DEFAULT_CENTER: LatLng = { lat: 40.3431, lng: -74.6551 };

const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors' },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

export class PreviewMap {
  readonly element = el('div', { class: 'lp-map', role: 'application', 'aria-label': 'GPS map of the preview devices; drag a marker to move that device' });
  private map: maplibregl.Map | null = null;
  private error: string | null = null;
  private markers = new Map<string, { marker: maplibregl.Marker; dragging: boolean }>();

  constructor(private onMove: (id: string, at: LatLng) => void) {
    try {
      this.map = new maplibregl.Map({ container: this.element, style: STYLE, center: [DEFAULT_CENTER.lng, DEFAULT_CENTER.lat], zoom: 16, attributionControl: { compact: true } });
      this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    } catch (e) {
      // No WebGL (remote desktop, old GPU): say so instead of leaving a blank box.
      this.error = e instanceof Error ? e.message : String(e);
      this.element.append(el('p', { class: 'lp-empty' }, [`The map needs WebGL, which is unavailable here (${this.error}). Device positions still show in the terminal.`]));
    }
  }

  /** Adds the device's marker (idempotent) at `at`, coloured by device. */
  addDevice(id: string, label: string, color: string, at: LatLng): void {
    if (!this.map || this.markers.has(id)) return;
    const marker = new maplibregl.Marker({ color, draggable: true }).setLngLat([at.lng, at.lat]).addTo(this.map);
    marker.getElement().setAttribute('title', `${label}: drag to move`);
    marker.getElement().setAttribute('aria-label', `${label} location marker`);
    const entry = { marker, dragging: false };
    marker.on('dragstart', () => (entry.dragging = true));
    marker.on('dragend', () => {
      entry.dragging = false;
      const p = marker.getLngLat();
      this.onMove(id, { lat: p.lat, lng: p.lng });
    });
    this.markers.set(id, entry);
  }

  /** Moves a marker to a position seen in a frame; ignored while the user drags it. */
  setPosition(id: string, at: LatLng): void {
    const m = this.markers.get(id);
    if (!m || m.dragging) return;
    const cur = m.marker.getLngLat();
    if (Math.abs(cur.lat - at.lat) < 1e-9 && Math.abs(cur.lng - at.lng) < 1e-9) return;
    m.marker.setLngLat([at.lng, at.lat]);
  }

  position(id: string): LatLng | null {
    const p = this.markers.get(id)?.marker.getLngLat();
    return p ? { lat: p.lat, lng: p.lng } : null;
  }

  /** Call when the panel is resized or shown, so the canvas matches its box. */
  resize(): void {
    this.map?.resize();
  }

  dispose(): void {
    this.map?.remove();
    this.map = null;
    this.markers.clear();
  }
}
