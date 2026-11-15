import { afterEach, expect, it, vi } from 'vitest';
import type { AccountController } from '../src/account';
import { PreviewDocument } from './physical-preview-dom';

const records = vi.hoisted(() => [] as { opts: { kind: string; lobby: string; gameId: string }; started: boolean; disposed: boolean }[]);
vi.mock('../src/livePreview/map', () => ({
  DEFAULT_CENTER: { lat: 40, lng: -74 },
  PreviewMap: class {
    element = document.createElement('div');
    addDevice() {} resize() {} setPosition() {} dispose() {}
  },
}));
vi.mock('../src/publishView', () => ({ qrDataUrl: (url: string) => `data:qr,${url}` }));
vi.mock('../src/livePreview/session', () => ({
  DeviceSession: class {
    status = 'idle';
    state = { ev: {}, local: {}, device: { kind: 'phone' } };
    uiState = { kind: 'none', reason: 'No published UI' };
    onChange = () => {};
    record: (typeof records)[number];
    constructor(opts: (typeof records)[number]['opts']) { this.record = { opts, started: false, disposed: false }; records.push(this.record); }
    async start() { this.record.started = true; }
    dispose() { this.record.disposed = true; }
  },
}));
afterEach(() => { records.splice(0); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('pairs the exact lobby, separates browser slots from simulators, and exposes only the approved hosted chooser callback', async () => {
  vi.useFakeTimers();
  const doc = new PreviewDocument();
  const copy = vi.fn(async () => {});
  vi.stubGlobal('document', doc);
  vi.stubGlobal('navigator', { clipboard: { writeText: copy } });
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => setTimeout(fn, 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  const openHosted = vi.fn();
  const account = { gameId: 'game-one', game: { title: 'Game' }, serverUrl: 'https://pear.test', account: null, onChange: () => () => {} } as unknown as AccountController;
  const { createLivePreviewPanel } = await import('../src/livePreview/panel');
  const panel = createLivePreviewPanel(account, openHosted);
  const root = panel.element as unknown as PreviewDocument['root'];
  const find = (label: string) => root.find((e) => e.attrs['aria-label'] === label)[0];
  const lobby = find('Lobby code');
  lobby.value = 'SAME42';
  root.find((e) => e.tagName === 'button' && e.textContent === 'Apply lobby / reconnect')[0].click();
  const initial = records.slice(-2);
  expect(initial.map((r) => r.opts.kind)).toEqual(['phone', 'ipad']);
  expect(initial.every((r) => r.started && r.opts.lobby === 'SAME42')).toBe(true);
  const phoneSource = find('iPhone input source');
  phoneSource.value = 'browser'; phoneSource.dispatchEvent(new Event('change'));
  expect(initial.every((r) => r.disposed)).toBe(true);
  expect(records.filter((r) => !r.disposed).map((r) => r.opts.kind)).toEqual(['ipad']);
  const ipadSource = find('iPad input source');
  ipadSource.value = 'browser'; ipadSource.dispatchEvent(new Event('change'));
  expect(records.filter((r) => !r.disposed)).toEqual([]);
  expect(root.textContent).toContain('Slot reserved for a real browser');
  expect(root.textContent).toContain('0/0 Studio cloud sessions open · not physical devices');
  const urls = root.find((e) => e.tagName === 'a').map((e) => new URL(e.attrs.href));
  expect(urls).toHaveLength(2);
  expect(urls.map((u) => u.searchParams.get('role'))).toEqual(['phone', 'referee']);
  for (const url of urls) {
    expect(url.origin).toBe('https://pear.test'); expect(url.pathname).toBe('/player.html');
    expect(url.searchParams.get('game')).toBe('game-one'); expect(url.searchParams.get('lobby')).toBe('SAME42');
  }
  expect(root.find((e) => e.tagName === 'img' && e.attrs.src.startsWith('data:qr,')).length).toBe(2);
  root.find((e) => e.tagName === 'button' && e.textContent === 'Copy link')[0].click();
  expect(copy).toHaveBeenCalledWith(urls[0].href);
  root.find((e) => e.tagName === 'button' && e.textContent === 'Open hosted game…')[0].click();
  expect(openHosted).toHaveBeenCalledTimes(1);
  panel.dispose?.();
});
