import { describe, expect, it } from 'vitest';
import { consoleRows, type OutputEntry, type ServerRow } from '../src/debug-panel';

const out: OutputEntry[] = [
  { t: 1, level: 'log', text: 'hi', script: 'enemy' },
  { t: 3, level: 'error', text: 'boom' },
];
const srv: ServerRow[] = [
  { t: 2, kind: 'in', player: 'p1', detail: 'punch {}', level: 'log' },
  { t: 3, kind: 'error', player: '', detail: 'bad', level: 'error' },
];

describe('consoleRows', () => {
  it('merges in time order, output first on ties', () => {
    const r = consoleRows(out, srv, 'all');
    expect(r.map((x) => x.text)).toEqual(['hi', 'in: punch {}', 'boom', 'bad']);
    expect(r.map((x) => x.source)).toEqual(['enemy', 'p1', 'client', 'server']);
  });
  it('filters client, server and errors', () => {
    expect(consoleRows(out, srv, 'client')).toHaveLength(2);
    expect(consoleRows(out, srv, 'server')).toHaveLength(2);
    expect(consoleRows(out, srv, 'errors').map((x) => x.text)).toEqual(['boom', 'bad']);
  });
});
