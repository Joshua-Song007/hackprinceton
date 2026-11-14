// Generates docs/creators/scripting-api.md from src/api.ts.
// Run: node --experimental-strip-types studio/scripts/gen-api-doc.mjs (Node 22.17; type stripping is default from 22.18).
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { API, handlerSignature } from '../src/api.ts';

const esc = (s) => s.replace(/\|/g, '\|');
const out = ['# Scripting API', '', 'Generated from `Web/studio/src/api.ts` by `Web/studio/scripts/gen-api-doc.mjs`. Do not edit by hand.', ''];
for (const side of ['client', 'server']) {
  const { handlers, members } = API[side];
  out.push(`## ${side === 'client' ? 'Client' : 'Server'} scripts`, '', side === 'client'
    ? '`export default script({ ... })`. Handlers receive `(self, ctx, ...args)` and run on each player\'s machine.'
    : '`export default serverScript({ ... })`. Handlers receive `(ctx, ...args)` and run once per game session on the game server. They run only on a join, leave, remote event or timer; there are no ticks.', '',
    '### Handlers', '', '| Handler | Description |', '|---|---|',
    ...handlers.map((h) => `| \`${esc(handlerSignature(h))}\` | ${esc(h.description)} |`), '');
  for (const h of handlers) out.push(`\`${h.name}\` parameters: ${h.params.map((q) => `\`${q.name}: ${esc(q.type)}\``).join(', ')}`, '', '```js', h.example, '```', '');
  out.push('### Members', '', '| Member | Description |', '|---|---|', ...members.map((m) => `| \`${esc(m.signature)}\` | ${esc(m.description)} |`), '');
  for (const m of members) out.push(`\`${m.path}\``, '', '```js', m.example, '```', '');
}
out.push('## Limits and sandbox', '',
  '- A client handler is stopped after 250 ms (watchdog); the error appears in the Output tab.',
  '- A server call gets 1 s of CPU and 32 MiB of memory.',
  '- No `fetch`, DOM, timers or files. The network is reachable only through remote events.',
  '- Client scripts never see raw USIS packets; the server never sees input, only what clients send in remote events.',
  '- `ctx.state` lives in the hosted session and resets when a new version is published.',
  '- Gestures: `tap`, `doubleTap`, `flick` (with `dir`), `squeeze`, `pinch`.', '');
const file = fileURLToPath(new URL('../../../docs/creators/scripting-api.md', import.meta.url));
mkdirSync(new URL('../../../docs/creators/', import.meta.url), { recursive: true });
writeFileSync(file, out.join('\n'));
console.log('wrote', file);
