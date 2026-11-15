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

  it('deletes a game with the token, resolves on 204 and reports a refusal', async () => {
    const fetch = stub(new Response(null, { status: 204 }), json({}, 403), json({}, 404));
    const c = new CloudClient({ fetch, token: 'tok' });
    await expect(c.deleteGame('g 1')).resolves.toBeUndefined();
    expect(lastCall(fetch).url).toBe('/api/games/g%201');
    expect(lastCall(fetch).init.method).toBe('DELETE');
    expect(lastCall(fetch).init.headers.Authorization).toBe('Bearer tok');
    expect(await c.deleteGame('g-1').catch((e) => e)).toMatchObject({ kind: 'forbidden', status: 403 });
    expect(await c.deleteGame('g-1').catch((e) => e)).toMatchObject({ kind: 'notFound', status: 404 });
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

describe('CloudClient developer and About routes', () => {
  it('signs in as a developer without a display name and reads the role', async () => {
    const dev = { ...account, provider: 'developer', role: 'developer' };
    const fetch = stub(json({ token: 'tok', account: dev }));
    const c = new CloudClient({ fetch });
    const res = await c.signIn({ provider: 'developer', subject: 'root', password: 'pw' });
    expect(res.account.role).toBe('developer');
    expect(JSON.parse(lastCall(fetch).init.body as string)).toEqual({ provider: 'developer', subject: 'root', password: 'pw' });
  });

  it('maps a 401 on developer sign-in to unauthorized', async () => {
    const c = new CloudClient({ fetch: stub(json({}, 401)) });
    await expect(c.signIn({ provider: 'developer', subject: 'root', password: 'x' })).rejects.toMatchObject({ kind: 'unauthorized' });
  });

  it('lists all games, updates a game and handles the cover routes', async () => {
    const game = { id: 'g 1', owner_id: 'o', title: 'T', created_at: 't', updated_at: 't', owner_name: 'Ada', has_cover: true };
    const fetch = stub(json([game]), json(game), new Response(null, { status: 204 }), new Response(null, { status: 204 }), json({}, 413));
    const c = new CloudClient({ baseUrl: 'http://s', fetch, token: 'tok' });
    expect(await c.listAllGames()).toEqual([game]);
    expect(lastCall(fetch).url).toBe('http://s/api/games?all=1');
    await c.updateGame('g 1', { description: 'hi' });
    expect(lastCall(fetch, 1).url).toBe('http://s/api/games/g%201');
    expect(lastCall(fetch, 1).init.method).toBe('PUT');
    expect(JSON.parse(lastCall(fetch, 1).init.body as string)).toEqual({ description: 'hi' });
    const img = new Blob(['x'], { type: 'image/png' });
    await c.uploadCover('g 1', img);
    expect(lastCall(fetch, 2).url).toBe('http://s/api/games/g%201/cover');
    expect(lastCall(fetch, 2).init.method).toBe('PUT');
    expect(lastCall(fetch, 2).init.headers['Content-Type']).toBe('image/png');
    expect(lastCall(fetch, 2).init.body).toBe(img);
    await c.deleteCover('g 1');
    expect(lastCall(fetch, 3).init.method).toBe('DELETE');
    await expect(c.uploadCover('g 1', img)).rejects.toMatchObject({ status: 413 });
    expect(c.coverUrl('g 1', 'v2')).toBe('http://s/api/games/g%201/cover?v=v2');
  });
});
