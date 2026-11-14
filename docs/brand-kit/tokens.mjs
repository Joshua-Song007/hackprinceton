// Builds tokens.json from tokens.css and fails if any brand contrast pair misses its WCAG target.
// Run: node docs/brand-kit/tokens.mjs   (tokens.css is the source; never edit tokens.json by hand)
import { readFileSync, writeFileSync } from 'node:fs';

const dir = new URL('.', import.meta.url);
const css = readFileSync(new URL('tokens.css', dir), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// Each rule block: selector -> { --name: raw value }
const blocks = {};
for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const vars = Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
  blocks[sel.trim()] = { ...blocks[sel.trim()], ...vars };
}
const base = blocks[':root'];
const themes = { emerald: blocks[':root, [data-theme="emerald"]'], paper: blocks['[data-theme="paper"]'] };
if (!base || !themes.emerald || !themes.paper) throw new Error('tokens.css: expected :root, emerald and paper blocks');

const resolve = (v, scope) => v.replace(/var\((--[\w-]+)\)/g, (_, n) => {
  const r = scope[n] ?? base[n];
  if (r === undefined) throw new Error(`tokens.css: ${n} is not defined`);
  return resolve(r, scope);
});

// WCAG 2.x relative luminance and contrast
const lum = hex => {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

// [foreground, background, minimum]: 7 = AAA body, 4.5 = AA body, 3 = UI and graphics
const pairs = {
  emerald: [
    ['--ink-primary', '--surface-canvas', 7], ['--ink-primary', '--surface-raised', 7],
    ['--ink-secondary', '--surface-canvas', 4.5], ['--ink-secondary', '--surface-raised', 4.5],
    ['--ink-on-accent', '--surface-accent', 4.5],
    ['--link', '--surface-canvas', 4.5], ['--link', '--surface-raised', 4.5],
    ['--state-ok', '--surface-canvas', 4.5], ['--state-warn', '--surface-canvas', 4.5],
    ['--state-error', '--surface-canvas', 4.5], ['--state-info', '--surface-canvas', 4.5],
    ['--state-warn', '--surface-raised', 4.5], ['--state-error', '--surface-raised', 4.5],
    ['--border-strong', '--surface-canvas', 3], ['--border-strong', '--surface-raised', 3],
    ['--focus', '--surface-canvas', 3], ['--focus', '--surface-raised', 3],
    ['--accent-warm', '--surface-canvas', 3], ['--accent-cool', '--surface-canvas', 3],
    ['--accent-warm', '--surface-raised', 3], ['--accent-cool', '--surface-raised', 3],
  ],
  paper: [
    ['--ink-primary', '--surface-canvas', 7], ['--ink-primary', '--surface-raised', 7],
    ['--ink-secondary', '--surface-canvas', 7], ['--ink-secondary', '--surface-raised', 7],
    ['--ink-on-accent', '--surface-accent', 7],
    ['--link', '--surface-canvas', 4.5], ['--link', '--surface-raised', 4.5],
    ['--state-ok', '--surface-canvas', 4.5], ['--state-warn', '--surface-canvas', 4.5],
    ['--state-error', '--surface-canvas', 4.5], ['--state-info', '--surface-canvas', 4.5],
    ['--border-strong', '--surface-canvas', 3], ['--focus', '--surface-canvas', 3],
    ['--accent-warm', '--surface-canvas', 3], ['--accent-cool', '--surface-canvas', 3],
  ],
  // Badges and tags use Sandy and Powder fills with Ink text in both themes.
  fills: [['--pear-ink', '--pear-sandy', 7], ['--pear-ink', '--pear-powder', 7], ['--pear-ink', '--pear-tea', 7]],
};

let failed = 0;
for (const [theme, list] of Object.entries(pairs)) {
  const scope = themes[theme] ?? base;
  for (const [fg, bg, min] of list) {
    const r = contrast(resolve(`var(${fg})`, scope), resolve(`var(${bg})`, scope));
    if (r < min) { failed++; console.error(`FAIL ${theme}: ${fg} on ${bg} = ${r.toFixed(2)} (needs ${min})`); }
  }
}

// tokens.json in the Design Tokens Community Group shape
const tok = (value, type) => ({ $value: value, $type: type });
const group = (prefix, type, scope = base) => Object.fromEntries(Object.entries(scope)
  .filter(([n]) => n.startsWith(prefix)).map(([n, v]) => [n.slice(prefix.length), tok(resolve(v, scope), type)]));
const semantic = scope => Object.fromEntries(Object.keys(themes.emerald).filter(n => n !== 'color-scheme')
  .map(n => [n.slice(2), tok(resolve(scope[n], scope), 'color')]));

const json = {
  $description: 'Pear brand tokens, generated from tokens.css by tokens.mjs. Do not edit by hand.',
  palette: group('--pear-', 'color'),
  theme: { emerald: semantic(themes.emerald), paper: semantic(themes.paper) },
  font: group('--font-', 'fontFamily'),
  text: group('--text-', 'dimension'),
  leading: group('--leading-', 'number'),
  space: group('--space-', 'dimension'),
  radius: group('--radius-', 'dimension'),
  duration: group('--duration-', 'duration'),
  easing: { out: tok(base['--ease-out'], 'cubicBezier') },
};
writeFileSync(new URL('tokens.json', dir), JSON.stringify(json, null, 2) + '\n');
console.log(failed ? `${failed} contrast pair(s) failed` : `tokens.json written; all contrast pairs pass`);
process.exit(failed ? 1 : 0);
