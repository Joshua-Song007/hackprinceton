import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, CloudClient, type NewGameVersion, type WebSocketLike } from '../src';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function stub(...responses: Response[]) {
  const fetch = vi.fn(async (..._args: Parameters<typeof globalThis.fetch>) => responses.shift() ?? json({}, 500));
  return fetch;
}
const lastCall = (f: ReturnType<typeof stub>, n = 0) => {
  const [url, init] = f.mock.calls[n]!;
  return { url: String(url), init: init as RequestInit & { headers: Record<string, string> } };
};

const account = { id: 'a1', provider: 'dev', subject: 's', display_name: 'Ada', created_at: 't' };
const version: NewGameVersion = {
  scene: { name: 'x' }, client_scripts: { player: 'p' }, server_scripts: { game: 'g' }, assets: {}, metadata: {}, run_mode: 'screen',
};

describe('CloudClient requests', () => {
  it('signs in with the dev body and keeps the token for later calls', async () => {
    const fetch = stub(json({ token: 'tok', account }), json(account), json([]));
    const c = new CloudClient({ baseUrl: 'http://srv:8080/', fetch });
    const res = await c.signIn({ provider: 'dev', subject: 'ada', display_name: 'Ada' });
    expect(res.token).toBe('tok');
    expect(lastCall(fetch).url).toBe('http://srv:8080/api/accounts/signin');
    expect(lastCall(fetch).init.method).toBe('POST');
    expect(JSON.parse(lastCall(fetch).init.body as string)).toEqual({ provider: 'dev', subject: 'ada', display_name: 'Ada' });
    expect(lastCall(fetch).init.headers.Authorization).toBeUndefined();

    expect(await c.me()).toEqual(account);
    expect(lastCall(fetch, 1).url).toBe('http://srv:8080/api/accounts/me');
    expect(lastCall(fetch, 1).init.headers.Authorization).toBe('Bearer tok');
    await c.listGames();
    expect(lastCall(fetch, 2).url).toBe('http://srv:8080/api/games');
  });

  it('creates games, publishes, and fetches versions', async () => {
    const game = { id: 'g-1', owner_id: 'a1', title: 'T', created_at: 't', updated_at: 't' };
    const fetch = stub(json(game, 201), json({ ...version, id: 'v', game_id: 'g-1', version: 1, published_at: 't' }, 201), json({}), json({}));
    const c = new CloudClient({ fetch, token: 'tok' });
    expect(await c.createGame('T')).toEqual(game);
    expect(JSON.parse(lastCall(fetch).init.body as string)).toEqual({ title: 'T' });
    expect((await c.publish('g-1', version)).version).toBe(1);
    expect(lastCall(fetch, 1).url).toBe('/api/games/g-1/versions');
    expect(JSON.parse(lastCall(fetch, 1).init.body as string)).toEqual(version);
    await c.fetchVersion('g-1');
    await c.fetchVersion('g-1', 3);
    expect(lastCall(fetch, 2).url).toBe('/api/games/g-1/versions/latest');
    expect(lastCall(fetch, 3).url).toBe('/api/games/g-1/versions/3');
    expect(lastCall(fetch, 3).init.method).toBe('GET');
  });

  it('signOut posts, tolerates 204, and clears the token', async () => {
    const fetch = stub(new Response(null, { status: 204 }));
    const c = new CloudClient({ fetch, token: 'tok' });
    await c.signOut();
    expect(lastCall(fetch).url).toBe('/api/accounts/signout');
    expect(c.token).toBeNull();
  });
});

describe('error mapping', () => {
  it.each([
    [400, 'badRequest'], [401, 'unauthorized'], [403, 'forbidden'], [404, 'notFound'], [503, 'unavailable'], [500, 'server'],
  ])('maps %i to %s', async (status, kind) => {
    const c = new CloudClient({ fetch: stub(json({}, status)), token: 't' });
    const error = await c.listGames().catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind, status });
  });

  it('401 clears the token, notifies once, and is not retried', async () => {
    const fetch = stub(json({}, 401), json([]));
    const onUnauthorized = vi.fn();
    const c = new CloudClient({ fetch, token: 'stale', onUnauthorized });
    await expect(c.me()).rejects.toMatchObject({ kind: 'unauthorized' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(c.token).toBeNull();
    await c.listGames();
    expect(lastCall(fetch, 1).init.headers.Authorization).toBeUndefined();
  });

  it('maps a thrown fetch to a network error', async () => {
    const c = new CloudClient({ fetch: vi.fn(async () => Promise.reject(new TypeError('offline'))) });
    await expect(c.me()).rejects.toMatchObject({ kind: 'network', status: 0 });
  });

  it('signOut still clears the token when the call fails', async () => {
    const c = new CloudClient({ fetch: stub(json({}, 500)), token: 't' });
    await expect(c.signOut()).rejects.toBeInstanceOf(ApiError);
    expect(c.token).toBeNull();
  });
});

class FakeSocket implements WebSocketLike {
  onopen: WebSocketLike['onopen'] = null;
  onmessage: WebSocketLike['onmessage'] = null;
  onclose: WebSocketLike['onclose'] = null;
  onerror: WebSocketLike['onerror'] = null;
  sent: string[] = [];
  closed = false;
  constructor(readonly url: string) {}
  send(d: string) { this.sent.push(d); }
  close() { this.closed = true; }
}

describe('sockets', () => {
  afterEach(() => vi.useRealTimers());

  it('builds /play and /debug urls with the token and version', () => {
    const sockets: FakeSocket[] = [];
    const c = new CloudClient({ baseUrl: 'https://pear.example', token: 'a b', webSocket: (u) => sockets[sockets.push(new FakeSocket(u)) - 1]! });
    c.openPlay('g-1', { version: 2 });
    c.openDebug('g-1');
    expect(sockets[0]!.url).toBe('wss://pear.example/play/g-1?version=2&token=a+b');
    expect(sockets[1]!.url).toBe('wss://pear.example/debug/g-1?token=a+b');
  });

  it('delivers frames, sends JSON, and reconnects with doubling backoff until closed', () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const c = new CloudClient({ baseUrl: 'http://h', token: 't', webSocket: (u) => sockets[sockets.push(new FakeSocket(u)) - 1]! });
    const play = c.openPlay('g');
    const frames: unknown[] = [];
    const statuses: string[] = [];
    play.onMessage = (f) => frames.push(f);
    play.onStatus = (s) => statuses.push(s);

    expect(play.send({ name: 'x', data: 1 })).toBe(false); // not open yet
    sockets[0]!.onopen!({});
    expect(play.send({ name: 'banish', data: { enemy: 'a' } })).toBe(true);
    expect(sockets[0]!.sent).toEqual(['{"name":"banish","data":{"enemy":"a"}}']);
    sockets[0]!.onmessage!({ data: '{"name":"_reload","data":{"version":2}}' });
    sockets[0]!.onmessage!({ data: 'not json' });
    expect(frames).toEqual([{ name: '_reload', data: { version: 2 } }]);

    sockets[0]!.onclose!({});
    expect(statuses).toEqual(['open', 'connecting']);
    vi.advanceTimersByTime(499);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    sockets[1]!.onclose!({}); // never opened: backoff doubles
    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);
    sockets[2]!.onopen!({}); // success resets the backoff
    sockets[2]!.onclose!({});
    vi.advanceTimersByTime(500);
    expect(sockets).toHaveLength(4);

    play.close();
    expect(sockets[3]!.closed).toBe(true);
    expect(play.status).toBe('closed');
    sockets[3]!.onclose!({});
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(4);
  });
});
