import { describe, expect, it } from 'vitest';
import { createdGameId, gameRows, runGamePrompt, scenarioOk } from '../src/promptGame';

class FakeSocket {
  static last: FakeSocket;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];
  constructor(public url: string) { FakeSocket.last = this; }
  send(s: string) { this.sent.push(s); }
  close() { this.onclose?.(); }
  push(m: object) { this.onmessage?.({ data: JSON.stringify(m) }); }
}
const Fake = FakeSocket as unknown as typeof WebSocket;
const run = (rows: unknown[] = []) => runGamePrompt({ url: 'ws://x', text: 'make a game', onRow: (r) => rows.push(r), WebSocketImpl: Fake });
const scenario = (ok: boolean) => ({ type: 'tool_result', name: 'run_scenario', ok: true, text: JSON.stringify({ report: { ok } }) });

describe('parsers', () => {
  it('reads report.ok and the created game id', () => {
    expect(scenarioOk('{"report":{"ok":true}}')).toBe(true);
    expect(scenarioOk('x "ok": false y')).toBe(false);
    expect(scenarioOk('nothing')).toBeNull();
    expect(createdGameId('{"id":"g1"}')).toBe('g1');
    expect(createdGameId('boom')).toBeNull();
  });
  it('turns tool calls and results into terminal rows', () => {
    expect(gameRows({ type: 'tool_call', name: 'validate_game', args: { a: 1 } })[0]).toMatchObject({ name: 'validate_game', dir: 'out', text: '{"a":1}' });
    expect(gameRows(scenario(false))[0]).toMatchObject({ level: 'error', dir: 'in' });
    expect(gameRows(scenario(false))[0]!.text.startsWith('FAIL')).toBe(true);
    expect(gameRows({ type: 'nope' })).toEqual([]);
  });
});

describe('runGamePrompt', () => {
  it('sends a game prompt, streams rows and returns the created game', async () => {
    const rows: unknown[] = [];
    const p = run(rows);
    const s = FakeSocket.last;
    s.onopen!();
    expect(JSON.parse(s.sent[0]!)).toMatchObject({ type: 'prompt', mode: 'game', text: 'make a game' });
    s.push({ type: 'tool_result', name: 'create_game', ok: true, text: '{"id":"g9"}' });
    s.push(scenario(true));
    s.push({ type: 'done', summary: 'v1 passes' });
    expect(await p).toMatchObject({ gameId: 'g9', problem: null, summary: 'v1 passes' });
    expect(rows.length).toBe(3);
  });
  it('reports a missing plugin, an offline runtime and a missing key', async () => {
    expect((await runGamePrompt({ url: null, text: 'x', onRow() {} })).problem).toMatch(/Install the Deep Agent/);
    const off = run();
    FakeSocket.last.onerror!();
    expect((await off).problem).toMatch(/offline/);
    const key = run();
    FakeSocket.last.onopen!();
    FakeSocket.last.push({ type: 'error', message: 'No model API key: set ANTHROPIC_API_KEY' });
    expect(await key).toMatchObject({ needsKey: true });
  });
  it('flags an agent that stopped after 6 failing runs', async () => {
    const p = run();
    const s = FakeSocket.last;
    s.onopen!();
    s.push({ type: 'tool_result', name: 'create_game', ok: true, text: '{"id":"g2"}' });
    for (let i = 0; i < 6; i++) s.push(scenario(false));
    s.push({ type: 'done', summary: '' });
    const r = await p;
    expect(r.gameId).toBe('g2');
    expect(r.problem).toMatch(/6 iterations/);
  });
});
