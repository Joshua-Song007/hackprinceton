import { describe, expect, it } from 'vitest';
import type { Observation } from '@pear/runtime';
import { socketTransport, type DecideRequest } from '../src/agentTransport';

class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  open() { this.readyState = 1; this.onopen?.(); }
  send(data: string) { this.sent.push(JSON.parse(data)); }
  reply(m: object) { this.onmessage?.({ data: JSON.stringify(m) }); }
  drop() { this.readyState = 3; this.onclose?.(); }
  close() { this.readyState = 3; this.onclose?.(); }
}

const observation: Observation = { gameTime: 1, you: { position: [0, 0], facing: 0, arena: 10, devices: [] }, others: [], heard: [] };
const req = (player = 'player-2'): DecideRequest => ({
  run: 'run-1', player, persona: 'follows', role: { id: 'r', name: 'R', brief: '', kind: 'player' }, instructions: { title: 'T' }, observation, game_time: 1,
});
const make = (url: string | null = 'ws://x', timeouts = { decide: 40, report: 40 }) => {
  FakeSocket.all = [];
  return socketTransport(() => url, FakeSocket as unknown as typeof WebSocket, timeouts);
};
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('socketTransport', () => {
  it('sends a decide with an id and resolves with the matching plan', async () => {
    const t = make();
    const p = t.decide(req());
    await tick();
    const s = FakeSocket.all[0]!;
    expect(s.sent).toEqual([]); // not open yet
    s.open();
    await tick();
    expect(s.sent[0]).toMatchObject({ type: 'decide', id: 'a1', run: 'run-1', player: 'player-2', persona: 'follows' });
    s.reply({ type: 'plan', id: 'a1', actions: [{ type: 'wait', seconds: 1 }], unsure: [{ phase: 'p', line: 'l', why: 'w' }, { nope: 1 }] });
    await expect(p).resolves.toEqual({ actions: [{ type: 'wait', seconds: 1 }], unsure: [{ phase: 'p', line: 'l', why: 'w' }] });
    t.close();
  });

  it('matches out-of-order replies by id and reuses one socket', async () => {
    const t = make();
    const a = t.decide(req('a'));
    const b = t.decide(req('b'));
    await tick();
    FakeSocket.all[0]!.open();
    await tick();
    expect(FakeSocket.all).toHaveLength(1);
    const [first, second] = FakeSocket.all[0]!.sent;
    FakeSocket.all[0]!.reply({ type: 'plan', id: second!.id, actions: ['b'], unsure: [] });
    FakeSocket.all[0]!.reply({ type: 'plan', id: first!.id, actions: ['a'], unsure: [] });
    expect((await a).actions).toEqual(['a']);
    expect((await b).actions).toEqual(['b']);
    t.close();
  });

  it('an error reply rejects with its message', async () => {
    const t = make();
    const p = t.decide(req());
    await tick();
    FakeSocket.all[0]!.open();
    await tick();
    FakeSocket.all[0]!.reply({ type: 'error', id: 'a1', message: 'no key' });
    await expect(p).rejects.toThrow('no key');
    t.close();
  });

  it('a report resolves with its notes and summary', async () => {
    const t = make();
    const p = t.report({ run: 'run-1', player: 'player-2' });
    await tick();
    FakeSocket.all[0]!.open();
    await tick();
    FakeSocket.all[0]!.reply({ type: 'report_result', id: 'a1', unsure: [{ why: 'vague' }], summary: 'ok' });
    await expect(p).resolves.toEqual({ unsure: [{ phase: '', line: '', why: 'vague' }], summary: 'ok' });
    t.close();
  });

  it('a closed socket rejects every pending request, and the next request opens a new one', async () => {
    const t = make();
    const a = t.decide(req('a'));
    const b = t.decide(req('b'));
    await tick();
    FakeSocket.all[0]!.open();
    await tick();
    FakeSocket.all[0]!.drop();
    await expect(a).rejects.toThrow('closed the connection');
    await expect(b).rejects.toThrow('closed the connection');
    const c = t.decide(req('c'));
    await tick();
    expect(FakeSocket.all).toHaveLength(2);
    FakeSocket.all[1]!.open();
    await tick();
    FakeSocket.all[1]!.reply({ type: 'plan', id: FakeSocket.all[1]!.sent[0]!.id, actions: [], unsure: [] });
    await expect(c).resolves.toMatchObject({ actions: [] });
    t.close();
  });

  it('a request that is not answered times out and a late answer is ignored', async () => {
    const t = make();
    const p = t.decide(req());
    await tick();
    FakeSocket.all[0]!.open();
    await expect(p).rejects.toThrow('did not answer within');
    FakeSocket.all[0]!.reply({ type: 'plan', id: 'a1', actions: [], unsure: [] }); // must not throw
    t.close();
  });

  it('no plugin url rejects with a sentence and the url is read at each open', async () => {
    let url: string | null = null;
    FakeSocket.all = [];
    const t = socketTransport(() => url, FakeSocket as unknown as typeof WebSocket, { decide: 40, report: 40 });
    await expect(t.decide(req())).rejects.toThrow('Install the Deep Agent plugin first.');
    url = 'ws://fresh?token=2';
    const p = t.decide(req());
    await tick();
    expect(FakeSocket.all[0]!.url).toBe('ws://fresh?token=2');
    t.close();
    await expect(p).rejects.toThrow();
  });

  it('close rejects pending requests', async () => {
    const t = make();
    const p = t.decide(req());
    await tick();
    FakeSocket.all[0]!.open();
    await tick();
    t.close();
    await expect(p).rejects.toThrow('closed the connection');
  });
});
