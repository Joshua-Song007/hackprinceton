// Typed client for the Backend routes: accounts, games, versions, the /play socket and the /debug socket.
// Only game content (remote events, versions) goes through here; USIS sensor data never does (Network Rule).

export interface Account {
  id: string;
  provider: string;
  subject: string;
  display_name: string;
  created_at: string;
}
export interface SignInRequest {
  provider: string;
  subject: string;
  display_name?: string;
}
export interface SignInResponse {
  token: string;
  account: Account;
}
export interface Game {
  id: string;
  owner_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}
export type RunModeName = 'screen' | 'device';
export interface NewGameVersion {
  scene: Record<string, unknown>;
  /** Script name -> source. */
  client_scripts: Record<string, string>;
  server_scripts: Record<string, string>;
  assets: Record<string, unknown>;
  metadata: Record<string, unknown>;
  run_mode: RunModeName;
}
export interface GameVersion extends NewGameVersion {
  id: string;
  game_id: string;
  version: number;
  published_at: string;
}

/** The `/play` frame, both directions. The server sends `{name: "_reload", data: {version}}` when a newer version replaces the host. */
export interface PlayFrame {
  name: string;
  data: unknown;
}
/** `/debug` messages: an initial snapshot, then `{kind: join|leave|in|out|log|error|state|reload, t, ...}`. Typed loosely on purpose. */
export interface DebugEvent {
  kind: string;
  t?: number;
  [field: string]: unknown;
}

export type ApiErrorKind = 'unauthorized' | 'forbidden' | 'notFound' | 'badRequest' | 'unavailable' | 'server' | 'network';

/** Every failure of an HTTP call. `status` is 0 for `network`. */
export class ApiError extends Error {
  override name = 'ApiError';
  readonly kind: ApiErrorKind;
  readonly status: number;
  constructor(kind: ApiErrorKind, status: number, message: string) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

const KIND_BY_STATUS: Record<number, ApiErrorKind> = {
  400: 'badRequest', 401: 'unauthorized', 403: 'forbidden', 404: 'notFound', 503: 'unavailable',
};
const kindOf = (status: number): ApiErrorKind => KIND_BY_STATUS[status] ?? 'server';

export interface WebSocketLike {
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(data: string): void;
  close(): void;
}

export interface CloudOptions {
  /** Server origin, e.g. "https://studio.example.com". Default: same origin as the page. */
  baseUrl?: string;
  token?: string;
  fetch?: typeof fetch;
  webSocket?: (url: string) => WebSocketLike;
  /** Called once per 401, after the token is cleared. Requests are never retried automatically. */
  onUnauthorized?: () => void;
}

export type SocketStatus = 'connecting' | 'open' | 'closed';

export interface SocketOptions {
  initialBackoffMs?: number;
  maxBackoffMs?: number;
}

/** A WebSocket that reconnects with exponential backoff (500 ms doubling to 10 s) until `close()`. */
export class ReconnectingSocket<T> {
  status: SocketStatus = 'connecting';
  /** Set these before messages arrive; assignment is allowed at any time. */
  onMessage: (message: T) => void = () => {};
  onStatus: (status: SocketStatus) => void = () => {};
  private socket: WebSocketLike | null = null;
  private attempts = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private open: () => WebSocketLike;
  private initial: number;
  private max: number;

  constructor(open: () => WebSocketLike, options: SocketOptions = {}) {
    this.open = open;
    this.initial = options.initialBackoffMs ?? 500;
    this.max = options.maxBackoffMs ?? 10_000;
    this.connect();
  }

  /** False when the socket is not open (the frame is dropped, not queued). */
  send(message: unknown): boolean {
    if (this.status !== 'open' || !this.socket) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.socket?.close();
    this.setStatus('closed');
  }

  private setStatus(status: SocketStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.onStatus(status);
  }

  private connect(): void {
    this.setStatus('connecting');
    const socket = this.open();
    this.socket = socket;
    socket.onopen = () => {
      this.attempts = 0;
      this.setStatus('open');
    };
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      try {
        this.onMessage(JSON.parse(event.data) as T);
      } catch {
        // A malformed frame is ignored, like the server does.
      }
    };
    socket.onclose = () => {
      if (this.closed || this.socket !== socket) return;
      this.setStatus('connecting');
      const delay = Math.min(this.max, this.initial * 2 ** this.attempts++);
      this.timer = setTimeout(() => this.connect(), delay);
    };
  }
}

export class CloudClient {
  token: string | null;
  private baseUrl: string;
  private fetchImpl: typeof fetch;
  private webSocket: (url: string) => WebSocketLike;
  private onUnauthorized: () => void;

  constructor(options: CloudOptions = {}) {
    this.baseUrl = (options.baseUrl ?? '').replace(/\/+$/, '');
    this.token = options.token ?? null;
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.webSocket = options.webSocket ?? ((url) => new WebSocket(url) as unknown as WebSocketLike);
    this.onUnauthorized = options.onUnauthorized ?? (() => {});
  }

  async signIn(request: SignInRequest): Promise<SignInResponse> {
    const response = await this.request<SignInResponse>('POST', '/api/accounts/signin', { display_name: '', ...request });
    this.token = response.token;
    return response;
  }

  me(): Promise<Account> {
    return this.request('GET', '/api/accounts/me');
  }

  /** Clears the local token even when the server call fails. */
  async signOut(): Promise<void> {
    try {
      await this.request('POST', '/api/accounts/signout');
    } finally {
      this.token = null;
    }
  }

  listGames(): Promise<Game[]> {
    return this.request('GET', '/api/games');
  }

  createGame(title: string): Promise<Game> {
    return this.request('POST', '/api/games', { title });
  }

  publish(gameId: string, version: NewGameVersion): Promise<GameVersion> {
    return this.request('POST', `/api/games/${encodeURIComponent(gameId)}/versions`, version);
  }

  fetchVersion(gameId: string, version: number | 'latest' = 'latest'): Promise<GameVersion> {
    return this.request('GET', `/api/games/${encodeURIComponent(gameId)}/versions/${version}`);
  }

  /** Player socket for `/play/{id}`. `version` pins a version; omitted means latest. */
  openPlay(gameId: string, options: SocketOptions & { version?: number } = {}): ReconnectingSocket<PlayFrame> {
    const query: Record<string, string> = options.version === undefined ? {} : { version: String(options.version) };
    return new ReconnectingSocket<PlayFrame>(() => this.webSocket(this.socketUrl(`/play/${encodeURIComponent(gameId)}`, query)), options);
  }

  /** Owner-only debug stream for `/debug/{id}`. */
  openDebug(gameId: string, options: SocketOptions = {}): ReconnectingSocket<DebugEvent> {
    return new ReconnectingSocket<DebugEvent>(() => this.webSocket(this.socketUrl(`/debug/${encodeURIComponent(gameId)}`, {})), options);
  }

  /** Same-origin when no baseUrl is set; http(s) maps to ws(s). The token goes in `?token=` (browsers cannot set WebSocket headers). */
  socketUrl(path: string, query: Record<string, string>): string {
    const origin = this.baseUrl || globalThis.location?.origin || '';
    const params = new URLSearchParams(query);
    if (this.token) params.set('token', this.token);
    const qs = params.toString();
    return `${origin.replace(/^http/, 'ws')}${path}${qs ? `?${qs}` : ''}`;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (e) {
      throw new ApiError('network', 0, `${method} ${path}: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!response.ok) {
      const kind = kindOf(response.status);
      if (kind === 'unauthorized') {
        this.token = null;
        this.onUnauthorized();
      }
      throw new ApiError(kind, response.status, `${method} ${path}: ${response.status}`);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}
