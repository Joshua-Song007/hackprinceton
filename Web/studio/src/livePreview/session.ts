// One preview device: signs in as its own dev account, joins `/play/{game}?lobby=…`, sends the role hello on every open,
// folds frames with reduceFrame and keeps the latest version's ui.json. No DOM, so the flow is tested with a fake server.
import { CloudClient, ReconnectingSocket, type PlayFrame, type SocketStatus, type WebSocketLike } from '@pear/cloud';
import { emptyState, reduceFrame, validate, type PearUI, type ViewState } from '@pear/ui';
import { extractLatLng, findUiAsset, inlineUiText, frameRow, reduceAction, roleFrame, sysRow, type LogRow, type PreviewKind } from './helpers';

export interface SessionOptions {
  name: string;
  kind: PreviewKind;
  baseUrl: string;
  gameId: string;
  lobby: string;
  fetch?: typeof fetch;
  webSocket?: (url: string) => WebSocketLike;
  /** Unique per panel run so each connect is a fresh dev account. */
  run?: string;
}

export type UiState = { kind: 'loading' } | { kind: 'ready'; ui: PearUI; version: number } | { kind: 'none'; reason: string };

export class DeviceSession {
  state: ViewState;
  uiState: UiState = { kind: 'loading' };
  status: SocketStatus | 'idle' | 'signing-in' | 'failed' = 'idle';
  /** Last position carried by a frame (or dragged to); the map follows it. */
  position: { lat: number; lng: number } | null = null;
  token: string | null = null;
  onChange: () => void = () => {};
  onLog: (row: Omit<LogRow, 'id'>) => void = () => {};
  private client: CloudClient;
  private socket: ReconnectingSocket<PlayFrame> | null = null;
  private disposed = false;
  private loadedVersion: number | null = null;
  private assets: Record<string, unknown> = {};
  /** A ui.json picked from disk: previews an unpublished UI instead of the hosted version's. */
  localUi: PearUI | null = null;

  constructor(readonly opts: SessionOptions) {
    this.state = emptyState(opts.kind);
    this.client = new CloudClient({ baseUrl: opts.baseUrl, fetch: opts.fetch, webSocket: opts.webSocket });
  }

  async start(): Promise<void> {
    const { name, kind, gameId, lobby } = this.opts;
    this.set('signing-in');
    try {
      const run = this.opts.run ?? Date.now().toString(36);
      const res = await this.client.signIn({ provider: 'dev', subject: `sim-preview-${kind}-${run}`, display_name: name });
      this.token = res.token;
    } catch (e) {
      this.fail(`Sign-in failed: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (this.disposed) return;
    void this.loadUi();
    const url = this.client.socketUrl(`/play/${encodeURIComponent(gameId)}`, { lobby });
    this.socket = new ReconnectingSocket<PlayFrame>(() => this.openSocket(url));
    this.socket.onMessage = (f) => this.receive(f);
    this.socket.onStatus = (s) => {
      this.set(s);
      this.log(sysRow(name, `socket ${s}${s === 'open' ? ` (lobby ${lobby})` : ''}`));
      if (s === 'open') this.send(roleFrame(kind).name, roleFrame(kind).data);
    };
  }

  private openSocket(url: string): WebSocketLike {
    return (this.opts.webSocket ?? ((u) => new WebSocket(u) as unknown as WebSocketLike))(url);
  }

  /** Fetches the latest version and its ui.json asset; a version without one is the friendly empty state. */
  async loadUi(): Promise<void> {
    if (this.localUi) return this.setUi({ kind: 'ready', ui: this.localUi, version: 0 });
    try {
      const v = await this.client.fetchVersion(this.opts.gameId, 'latest');
      this.loadedVersion = v.version;
      this.assets = v.assets ?? {};
      const inline = inlineUiText(v.assets);
      let ui: unknown;
      if (inline !== null) ui = JSON.parse(inline);
      else {
        const sha = findUiAsset(v.assets);
        if (!sha) return this.setUi({ kind: 'none', reason: `Version ${v.version} has no ui.json asset yet.` });
        const f = this.opts.fetch ?? ((i, init) => globalThis.fetch(i, init));
        const res = await f(`${this.opts.baseUrl.replace(/\/+$/, '')}/api/assets/${sha}`);
        if (!res.ok) return this.setUi({ kind: 'none', reason: `Could not fetch ui.json (HTTP ${res.status}).` });
        ui = (await res.json()) as unknown;
      }
      const problems = validate(ui);
      if (problems.length) return this.setUi({ kind: 'none', reason: `ui.json is invalid: ${problems[0]}` });
      this.setUi({ kind: 'ready', ui: ui as PearUI, version: v.version });
    } catch (e) {
      this.setUi({ kind: 'none', reason: `Could not load the game's UI: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  /** URL for an `image` node's `src` (an asset name); the name itself when the version has no such asset. */
  assetUrl = (name: string): string => {
    const v = this.assets[name];
    const sha = typeof v === 'string' ? v : (v as { sha256?: string } | undefined)?.sha256;
    return sha ? `${this.opts.baseUrl.replace(/\/+$/, '')}/api/assets/${sha}` : name;
  };

  private setUi(u: UiState): void {
    if (this.disposed) return;
    this.uiState = u;
    if (u.kind === 'none') this.log(sysRow(this.opts.name, u.reason, 'warn'));
    this.onChange();
  }

  private receive(f: PlayFrame): void {
    if (this.disposed || !f || typeof f.name !== 'string') return;
    this.log(frameRow(this.opts.name, 'in', f));
    this.state = reduceFrame(this.state, f);
    const at = extractLatLng(f.data);
    if (at) this.position = at;
    const reloaded = f.name === '_reload' ? (f.data as { version?: number } | null)?.version : undefined;
    if (f.name === '_reload' && reloaded !== this.loadedVersion) void this.loadUi();
    this.onChange();
  }

  /** Sends one frame; false (and nothing logged as sent) while the socket is not open. */
  send(name: string, data: unknown = {}): boolean {
    const ok = this.socket?.send({ name, data }) ?? false;
    if (ok) {
      this.log(frameRow(this.opts.name, 'out', { name, data }));
      const at = extractLatLng(data);
      if (at) this.position = at;
    }
    return ok;
  }

  /** A button or `set` action from the rendered UI. */
  act(action: Parameters<typeof reduceAction>[1]): void {
    const r = reduceAction(this.state, action);
    this.state = r.state;
    if (r.send) this.send(r.send.name, r.send.data);
    else this.onChange(); // a send changes nothing visible; skipping the re-render keeps a held button and 30 Hz sensors intact
  }

  dispose(): void {
    this.disposed = true;
    this.socket?.close();
    this.socket = null;
  }

  private set(s: DeviceSession['status']): void {
    this.status = s;
    if (!this.disposed) this.onChange();
  }

  private fail(msg: string): void {
    this.log(sysRow(this.opts.name, msg, 'error'));
    this.set('failed');
  }

  private log(row: Omit<LogRow, 'id'>): void {
    if (!this.disposed) this.onLog(row);
  }
}
