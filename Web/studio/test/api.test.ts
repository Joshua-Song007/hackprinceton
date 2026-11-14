import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { API, scriptStub, type ApiSide } from '../src/api';

const prelude = readFileSync(new URL('../../../Packages/OmniScript/Sources/OmniScript/Resources/prelude.js', import.meta.url), 'utf8');
const parse = (name: string) => [...new RegExp(String.raw`var ${name} = \[([^\]]*)\]`).exec(prelude)![1]!.matchAll(/"(\w+)"/g)].map((m) => m[1]);

describe('script API table', () => {
  it('handler names equal prelude.js', () => {
    expect(API.client.handlers.map((h) => h.name)).toEqual(parse('CLIENT_HANDLERS'));
    expect(API.server.handlers.map((h) => h.name)).toEqual(parse('SERVER_HANDLERS'));
  });

  for (const side of ['client', 'server'] as ApiSide[]) {
    it(`${side} entries have a description and a parsing example`, () => {
      for (const h of API[side].handlers) {
        expect(h.description).not.toBe('');
        expect(() => new Function(`return ({ ${h.example} })`), h.name).not.toThrow();
      }
      for (const m of API[side].members) {
        expect(m.description).not.toBe('');
        expect(() => new Function('self', 'ctx', m.example), m.path).not.toThrow();
      }
    });
  }

  it('stubs use the right wrapper', () => {
    expect(scriptStub('client')).toContain('script({');
    expect(scriptStub('server')).toContain('serverScript({');
  });
});
