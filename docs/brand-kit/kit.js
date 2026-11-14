// Brand kit page behavior: copy, theme, contrast, type scale, logo and media exports.
// Every color is read from tokens.css at runtime, so the page never drifts from the tokens.

const $ = (s, r = document) => r.querySelector(s);
const root = document.documentElement;
const css = (name, el = root) => getComputedStyle(el).getPropertyValue(name).trim();
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const ICON = id => `<svg class="icon" aria-hidden="true"><use href="#i-${id}"/></svg>`;

/* ---------- toast and copy ---------- */
const toast = $('#toast');
let toastTimer;
function say(msg) {
  toast.textContent = msg;
  toast.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-on'), 1800);
}
async function copy(text, label = text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const t = Object.assign(document.createElement('textarea'), { value: text });
    t.style.cssText = 'position:fixed;opacity:0';
    document.body.append(t); t.select();
    const ok = document.execCommand('copy'); t.remove();
    if (!ok) return say('The browser blocked copying. Select the text and copy it instead.');
  }
  say(`Copied ${label}`);
}
function save(blob, name) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-copy]');
  if (b) copy(b.dataset.copy);
});

/* ---------- theme ---------- */
const THEME_KEY = 'pear-kit-theme';
function setTheme(t, store = true) {
  root.dataset.theme = t;
  document.querySelectorAll('[data-set-theme]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.setTheme === t)));
  if (store) try { localStorage.setItem(THEME_KEY, t); } catch {}
}
try { const t = localStorage.getItem(THEME_KEY); if (t === 'paper' || t === 'emerald') setTheme(t, false); } catch {}
document.querySelectorAll('[data-set-theme]').forEach(b => b.addEventListener('click', () => setTheme(b.dataset.setTheme)));

/* ---------- color math (WCAG 2.x and OKLCH) ---------- */
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const lin = v => (v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const lum = h => { const [r, g, b] = rgb(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const fmt = r => (Math.floor(r * 100) / 100).toFixed(2); // never round a ratio up past its threshold
const grade = r => r >= 7 ? 'AAA' : r >= 4.5 ? 'AA' : r >= 3 ? 'Large' : 'Fail';
function oklch(hex) {
  const [r, g, b] = rgb(hex).map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const H = (Math.atan2(B, A) * 180 / Math.PI + 360) % 360;
  return `oklch(${(L * 100).toFixed(1)}% ${Math.hypot(A, B).toFixed(3)} ${H.toFixed(1)})`;
}
console.assert(fmt(ratio('#FFFFFF', '#000000')) === '21.00' && fmt(ratio('#285943', '#285943')) === '1.00', 'contrast math');
console.assert(oklch('#FFFFFF').startsWith('oklch(100.0% 0.000'), 'oklch math');

/* ---------- palette ---------- */
const COLORS = [
  { k: 'emerald', name: 'Emerald Depths', short: 'Emerald', core: true, role: 'The canvas. Dark ground for every surface, and the ink on Tea buttons.' },
  { k: 'tea', name: 'Tea Green', short: 'Tea', core: true, role: 'Primary accent: calls to action, display highlights, focus rings.' },
  { k: 'clay', name: 'Clay Soil', short: 'Clay', core: true, role: 'Raised surfaces: cards and containers. Always with a Sandy border on Emerald.' },
  { k: 'sandy', name: 'Sandy Clay', short: 'Sandy', core: true, role: 'Warm accent: badges, callouts, borders, rules.' },
  { k: 'powder', name: 'Powder Blue', short: 'Powder', core: true, role: 'Cool accent: tags, dividers, large links.' },
  { k: 'paper', name: 'Paper', short: 'Paper', role: 'Body text on dark. Light canvas.' },
  { k: 'ink', name: 'Ink', short: 'Ink', role: 'Text on light fills.' },
  { k: 'moss', name: 'Moss', short: 'Moss', role: 'Secondary text on dark.' },
  { k: 'powder-200', name: 'Powder 200', short: 'Powder 200', role: 'Links on dark.' },
  { k: 'sandy-200', name: 'Sandy 200', short: 'Sandy 200', role: 'Warnings on dark.' },
  { k: 'coral', name: 'Coral', short: 'Coral', role: 'Errors on dark.' },
  { k: 'powder-700', name: 'Powder 700', short: 'Powder 700', role: 'Links and info on Paper.' },
  { k: 'sandy-700', name: 'Sandy 700', short: 'Sandy 700', role: 'Warnings on Paper.' },
  { k: 'clay-700', name: 'Clay 700', short: 'Clay 700', role: 'Errors on Paper.' },
  { k: 'white', name: 'White', short: 'White', role: 'Raised surface on Paper.' },
];
const by = {};
for (const c of COLORS) { c.hex = css(`--pear-${c.k}`).toUpperCase(); by[c.k] = by[c.hex] = c; }
const hex = k => by[k].hex;

$('#swatches').innerHTML = COLORS.filter(c => c.core).map(c => {
  const best = ['paper', 'ink'].map(k => ({ c: by[k], r: ratio(by[k].hex, c.hex) })).sort((a, b) => b.r - a.r)[0];
  const values = [['HEX', c.hex], ['RGB', `rgb(${rgb(c.hex).join(' ')})`], ['OKLCH', oklch(c.hex)], ['Token', `var(--pear-${c.k})`]];
  return `<article class="swatch">
    <button type="button" class="swatch__chip" style="background:${c.hex};color:${best.c.hex}" data-copy="${c.hex}" aria-label="Copy ${c.name}, ${c.hex}">
      <span>${c.name}</span><span class="swatch__hint" aria-hidden="true">${ICON('copy')}Copy</span>
    </button>
    <div class="swatch__info">
      <p class="swatch__role">${c.role}</p>
      <ul class="values">${values.map(([k, v]) => `<li><button type="button" class="value" data-copy="${v}"><span class="value__k">${k}</span><span class="value__v">${v}</span>${ICON('copy')}</button></li>`).join('')}</ul>
      <p class="swatch__best">${best.c.name} text, ${fmt(best.r)} : 1, ${grade(best.r)}</p>
    </div>
  </article>`;
}).join('');

$('#chips').innerHTML = COLORS.filter(c => !c.core).map(c =>
  `<button type="button" class="chip" data-copy="${c.hex}" aria-label="Copy ${c.name}, ${c.hex}. ${c.role}">
    <span class="chip__dot" style="background:${c.hex}"></span><span><span class="chip__name">${c.name}</span><span class="chip__hex">${c.hex}</span></span>
  </button>`).join('');

/* ---------- contrast tester and matrix ---------- */
const fg = $('#fg'), bg = $('#bg'), sample = $('#sample');
fg.innerHTML = bg.innerHTML = COLORS.map(c => `<option value="${c.hex}">${c.name}, ${c.hex}</option>`).join('');
fg.value = hex('paper'); bg.value = hex('emerald');
const CHECKS = [['AAA', 'body text', 7], ['AA', 'body text', 4.5], ['AA', 'large text, 24 px and up', 3], ['UI', 'icons, borders, focus', 3]];
function test() {
  const r = ratio(fg.value, bg.value);
  sample.style.background = bg.value;
  sample.style.color = fg.value;
  $('#ratio').textContent = fmt(r);
  $('#badges').innerHTML = CHECKS.map(([lvl, what, min]) => {
    const ok = r >= min;
    return `<li class="${ok ? 'is-pass' : 'is-fail'}">${ICON(ok ? 'check' : 'x')}<b>${ok ? 'Pass' : 'Fail'}</b><span>${lvl} ${what}, ${min} : 1</span></li>`;
  }).join('');
}
fg.addEventListener('change', test);
bg.addEventListener('change', test);
$('#swap').addEventListener('click', () => { [fg.value, bg.value] = [bg.value, fg.value]; test(); });
test();

const TEXT = ['paper', 'ink', 'moss', 'tea', 'sandy', 'powder', 'powder-200', 'sandy-200', 'coral', 'emerald', 'powder-700', 'sandy-700', 'clay-700'];
const GROUND = ['emerald', 'clay', 'paper', 'white', 'tea', 'sandy', 'powder'];
$('#matrix').innerHTML = `<caption class="sr-only">Contrast ratio of each text color on each ground</caption>
  <thead><tr><th scope="col">Text on</th>${GROUND.map(g => `<th scope="col">${by[g].short}</th>`).join('')}</tr></thead>
  <tbody>${TEXT.map(t => `<tr><th scope="row">${by[t].short}</th>${GROUND.map(g => {
    if (t === g) return '<td></td>';
    const r = ratio(hex(t), hex(g)), gr = grade(r);
    const said = gr === 'Large' ? 'large text and UI only' : gr === 'Fail' ? 'fails' : gr;
    return `<td><button type="button" class="cell" data-fg="${t}" data-bg="${g}" data-grade="${gr}" aria-label="${by[t].short} on ${by[g].short}, ${fmt(r)} to 1, ${said}">
      <span class="cell__aa" style="color:${hex(t)};background:${hex(g)}" aria-hidden="true">Aa</span><span class="cell__r" aria-hidden="true">${fmt(r)}</span><span class="cell__g" aria-hidden="true">${gr}</span></button></td>`;
  }).join('')}</tr>`).join('')}</tbody>`;
$('#matrix').addEventListener('click', e => {
  const c = e.target.closest('.cell');
  if (!c) return;
  fg.value = hex(c.dataset.fg); bg.value = hex(c.dataset.bg); test();
  $('#tester-title').scrollIntoView({ behavior: reduced.matches ? 'auto' : 'smooth', block: 'start' });
});

/* ---------- type scale ---------- */
const STEPS = [['xs', 'Captions, legal'], ['sm', 'Labels, buttons, table cells'], ['md', 'Body'], ['lg', 'Lead paragraphs'], ['xl', 'Subheads'],
  ['2xl', 'Section titles'], ['3xl', 'Page titles'], ['4xl', 'Cover'], ['5xl', 'Hero, once per surface']];
const sampleText = $('#sample-text');
$('#scale').innerHTML = STEPS.map(([s, use]) => {
  const rem = parseFloat(css(`--text-${s}`)), px = Math.round(rem * 16);
  const cls = px >= 48 ? 'is-display is-wonk' : px >= 28 ? 'is-display' : '';
  return `<li><button type="button" class="scale__meta" data-copy="var(--text-${s})" aria-label="Copy token --text-${s}, ${px} pixels, ${use}">
      <code>--text-${s}</code><span>${px} px, ${rem} rem</span><span>${use}</span></button>
    <p class="scale__sample ${cls}" style="font-size:var(--text-${s})">${esc(sampleText.value)}</p></li>`;
}).join('');
sampleText.addEventListener('input', () => {
  const t = sampleText.value.trim() || 'Lantern Hunt listens for your heartbeat';
  document.querySelectorAll('.scale__sample').forEach(p => { p.textContent = t; });
});

/* ---------- logo ---------- */
const LOGOS = [
  ['pear-lockup', 'Lockup, color', 'lockup', 'emerald'], ['pear-lockup-emerald', 'Lockup, one color', 'lockup', 'paper'],
  ['pear-lockup-stacked', 'Stacked, color', 'stacked', 'emerald'], ['pear-lockup-stacked-emerald', 'Stacked, one color', 'stacked', 'paper'],
  ['pear-mark', 'Mark, color', 'mark', 'emerald'], ['pear-mark-emerald', 'Mark, one color', 'mark', 'paper'],
];
$('#logos').innerHTML = LOGOS.map(([f, name, kind, ground]) => `<article class="logo-plate">
  <div class="logo-plate__stage logo-plate__stage--${kind}" style="background:var(--pear-${ground})"><img src="assets/logo/${f}.svg" alt="${name}"></div>
  <div class="logo-plate__info">
    <div><p class="logo-plate__name">${name}</p><p class="logo-plate__file">${f}.svg, for ${by[ground].short} grounds</p></div>
    <div class="row">
      <a class="pear-button pear-button--secondary" href="assets/logo/${f}.svg" download>${ICON('download')}SVG</a>
      <button type="button" class="pear-button pear-button--secondary" data-png="${f}">${ICON('download')}PNG</button>
    </div>
  </div></article>`).join('');

async function svgToPng(svgText, w, h, name) {
  const sized = svgText.replace('<svg ', `<svg width="${w}" height="${h}" `);
  const url = URL.createObjectURL(new Blob([sized], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    await new Promise(r => setTimeout(r, 150)); // let embedded fonts settle before rasterizing
    const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    save(await new Promise(r => c.toBlob(r, 'image/png')), name);
  } finally { URL.revokeObjectURL(url); }
}
$('#logos').addEventListener('click', async e => {
  const b = e.target.closest('[data-png]');
  if (!b) return;
  try {
    const text = await (await fetch(`assets/logo/${b.dataset.png}.svg`)).text();
    const [, , vw, vh] = text.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
    await svgToPng(text, Math.round(vw / vh * 1024), 1024, `${b.dataset.png}.png`);
    say(`Saved ${b.dataset.png}.png`);
  } catch { say('PNG export needs the kit served over http. Use the SVG instead.'); }
});

const space = $('#clearspace'), spaceBtn = $('#toggle-space');
spaceBtn.addEventListener('click', () => {
  const hidden = space.classList.toggle('is-hidden');
  spaceBtn.textContent = hidden ? 'Show clear space' : 'Hide clear space';
});

/* ---------- tokens ---------- */
const SEM = [
  ['surface-canvas', 'Page and app ground'], ['surface-raised', 'Cards and containers'], ['surface-accent', 'Accent fills'],
  ['ink-primary', 'Body text and headings'], ['ink-secondary', 'Secondary text, captions, hints'], ['ink-on-accent', 'Text on accent fills'],
  ['ink-on-warm', 'Text on Sandy and Powder fills'], ['accent', 'Calls to action, highlights'], ['accent-warm', 'Badges, callouts, rules'],
  ['accent-cool', 'Tags, dividers, large links'], ['link', 'Links at body size'], ['border-strong', 'Fields and cards'],
  ['border-subtle', 'Dividers and decoration'], ['focus', 'Focus rings'], ['state-ok', 'Success'], ['state-warn', 'Warnings'],
  ['state-error', 'Errors'], ['state-info', 'Information'],
];
const probes = ['emerald', 'paper'].map(t => { const d = document.createElement('div'); d.hidden = true; d.dataset.theme = t; document.body.append(d); return d; });
function tokenValue(raw) {
  const mix = raw.match(/color-mix\(in srgb,\s*(#[0-9a-f]{6})\s+(\d+)%/i);
  const h = (mix ? mix[1] : raw).toUpperCase();
  const label = by[h] ? `${by[h].short}${mix ? ` ${mix[2]}%` : ''}` : raw;
  return `<span class="token-val"><i style="background:${esc(raw)}"></i>${esc(label)}${mix ? '' : ` <span>${h}</span>`}</span>`;
}
$('#token-table tbody').innerHTML = SEM.map(([n, use]) => `<tr>
  <td><button type="button" class="token-name" data-copy="var(--${n})">--${n}${ICON('copy')}</button></td>
  ${probes.map(p => `<td>${tokenValue(css(`--${n}`, p))}</td>`).join('')}
  <td>${use}</td></tr>`).join('');
probes.forEach(p => p.remove());

$('#spaces').innerHTML = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32].map(n => {
  const px = parseFloat(css(`--space-${n}`)) * 16;
  return `<li><code>--space-${n}</code><span>${px} px</span><i style="width:var(--space-${n})"></i></li>`;
}).join('');

function dedent(html) {
  const lines = html.replace(/^\s*\n|\n\s*$/g, '').split('\n');
  const pad = Math.min(...lines.filter(l => l.trim()).map(l => l.match(/^\s*/)[0].length));
  return lines.map(l => l.slice(pad)).join('\n');
}
document.querySelectorAll('.copy-html').forEach(b => b.addEventListener('click', () =>
  copy(dedent(b.closest('.specimen').querySelector('.specimen__stage').innerHTML), 'HTML')));

/* ---------- contours ---------- */
function rng(seed) { return () => (seed = seed * 16807 % 2147483647) / 2147483647; }
function contours(cx, cy, r0, step, n, seed = 7) {
  const R = rng(seed);
  const waves = [1, 2, 3, 5].map(k => ({ k, a: (R() * 0.5 + 0.2) / k, p: R() * Math.PI * 2 }));
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = r0 + i * step;
    let d = '';
    for (let j = 0; j <= 120; j++) {
      const t = j / 120 * Math.PI * 2;
      let f = 1;
      for (const w of waves) f += w.a * 0.35 * Math.sin(w.k * t + w.p + i * 0.09);
      d += `${j ? 'L' : 'M'}${(cx + Math.cos(t) * r * f).toFixed(1)} ${(cy + Math.sin(t) * r * f).toFixed(1)}`;
    }
    out.push(d + 'Z');
  }
  return out;
}
const cover = $('[data-contours="cover"]');
cover.setAttribute('viewBox', '0 0 1200 800');
cover.setAttribute('preserveAspectRatio', 'xMidYMid slice');
cover.innerHTML = contours(900, 330, 36, 34, 24).map(d => `<path d="${d}"/>`).join('');

/* ---------- media templates ---------- */
const FORMATS = [
  { id: 'og', name: 'Link preview', w: 1200, h: 630 }, { id: 'banner', name: 'Profile banner', w: 1500, h: 500 },
  { id: 'square', name: 'Square post', w: 1080, h: 1080 }, { id: 'story', name: 'Story', w: 1080, h: 1920 },
];
const mctx = document.createElement('canvas').getContext('2d');
function wrap(text, font, maxW, track) {
  mctx.font = font;
  const width = s => mctx.measureText(s).width + track * s.length;
  const lines = [];
  let line = '';
  for (const word of text.trim().split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && width(next) > maxW) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}
function templateSvg(f, head, sub, fontCss = '') {
  const { w, h } = f, m = Math.min(w, h), wide = w / h > 1.5;
  const pad = Math.round(m * 0.085), bottom = f.id === 'story' ? Math.round(h * 0.12) : pad;
  const P = { em: hex('emerald'), tea: hex('tea'), sandy: hex('sandy'), powder: hex('powder'), paper: hex('paper'), moss: hex('moss') };

  const rings = contours(wide ? w * 0.8 : w * 0.78, wide ? h * 0.5 : h * 0.24, m * 0.05, m * 0.055, 22, 11)
    .map(d => `<path d="${d}"/>`).join('');
  const markH = wide ? h * 0.6 : w * (f.id === 'story' ? 0.42 : 0.34), ms = markH / 512;
  const mx = w - pad - markH, my = wide ? (h - markH) / 2 : pad;
  const body = 'M262 127C290 127 312 148 310 178C308 226 381 250 381 322C381 394 322 445 256 445C190 445 131 394 131 322C131 250 216 226 214 178C212 148 234 127 262 127Z', leaf = 'M270 132C270 94 298 68 346 62C346 106 314 136 270 132Z';
  const mark = `<defs><mask id="pm-t" maskUnits="userSpaceOnUse" x="100" y="30" width="340" height="440"><rect x="100" y="30" width="340" height="440" fill="#fff"/><path d="${leaf}" fill="#000" stroke="#000" stroke-width="22" stroke-linejoin="round"/></mask></defs>
    <g transform="translate(${mx.toFixed(1)} ${my.toFixed(1)}) scale(${ms.toFixed(4)})"><g transform="translate(256 256) rotate(12) scale(1.12) translate(-256 -252)"><path d="${body}" fill="${P.tea}" mask="url(#pm-t)"/><path d="${leaf}" fill="${P.sandy}"/></g></g>`;
  const wsz = m * 0.06;
  const word = `<text x="${pad}" y="${(pad + wsz * 0.75).toFixed(1)}" font-family="Fraunces" font-weight="600" font-size="${wsz.toFixed(1)}" letter-spacing="${(-0.02 * wsz).toFixed(2)}" fill="${P.paper}">Pear</text>`;

  const maxW = wide ? (w - pad * 2) * 0.6 : w - pad * 2;
  let size = wide ? h * 0.115 : w * 0.098, lines;
  do { size *= 0.94; lines = wrap(head, `600 ${size}px Fraunces`, maxW, -0.02 * size); } while (lines.length > 3 && size > m * 0.05);
  const subSize = Math.max(m * 0.036, 18), subLines = wrap(sub, `400 ${subSize}px Geist`, maxW * 0.95, 0).slice(0, 2);
  const readSize = Math.max(m * 0.026, 13);

  let y = h - bottom;
  const read = `<text x="${pad}" y="${y.toFixed(1)}" font-family="Geist Mono" font-size="${readSize.toFixed(1)}" fill="${P.sandy}" letter-spacing="${(readSize * 0.02).toFixed(2)}" xml:space="preserve" style="white-space:pre">AirPods 50 Hz    iPhone 100 Hz    Watch 1–10 Hz</text>`;
  y -= readSize * 2.4;
  const subY0 = y - (subLines.length - 1) * subSize * 1.35;
  const subT = `<text font-family="Geist" font-size="${subSize.toFixed(1)}" fill="${P.moss}">${subLines.map((l, i) =>
    `<tspan x="${pad}" y="${(subY0 + i * subSize * 1.35).toFixed(1)}">${esc(l)}</tspan>`).join('')}</text>`;
  y = subY0 - subSize * 1.5 - size * 0.35;
  const headY0 = y - (lines.length - 1) * size * 1.02;
  const headT = `<text font-family="Fraunces" font-weight="600" font-size="${size.toFixed(1)}" letter-spacing="${(-0.02 * size).toFixed(2)}" fill="${P.paper}" style="font-variation-settings:'SOFT' 100,'WONK' 1">${lines.map((l, i) =>
    `<tspan x="${pad}" y="${(headY0 + i * size * 1.02).toFixed(1)}">${esc(l)}</tspan>`).join('')}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(f.name)}: ${esc(head)}">${fontCss ? `<style>${fontCss}</style>` : ''}
  <rect width="${w}" height="${h}" fill="${P.em}"/><g fill="none" stroke="${P.powder}" stroke-opacity="0.22" stroke-width="${(m / 600).toFixed(2)}">${rings}</g>
  ${mark}${word}${headT}${subT}${read}</svg>`;
}

const tHead = $('#t-head'), tSub = $('#t-sub');
const words = () => [tHead.value.trim() || 'Everything you carry is a controller.', tSub.value.trim()];
const tplCard = f => `<article class="template template--${f.id}">
  <div class="template__frame" data-frame="${f.id}"></div>
  <div class="template__meta"><p><span class="template__name">${f.name}</span><span class="template__size">${f.w} × ${f.h}</span></p>
    <div class="row"><button type="button" class="pear-button pear-button--secondary" data-tpl="${f.id}" data-as="svg">${ICON('download')}SVG</button>
    <button type="button" class="pear-button pear-button--secondary" data-tpl="${f.id}" data-as="png">${ICON('download')}PNG</button></div></div></article>`;
$('#templates').innerHTML = `<div class="templates__col">${tplCard(FORMATS[0])}${tplCard(FORMATS[1])}</div>${tplCard(FORMATS[2])}${tplCard(FORMATS[3])}`;
function renderTemplates() {
  const [head, sub] = words();
  for (const f of FORMATS) $(`[data-frame="${f.id}"]`).innerHTML = templateSvg(f, head, sub);
}
tHead.addEventListener('input', renderTemplates);
tSub.addEventListener('input', renderTemplates);
renderTemplates();
document.fonts.ready.then(() => Promise.all(['600 40px Fraunces', '400 20px Geist', '400 16px "Geist Mono"'].map(s => document.fonts.load(s)))).then(renderTemplates, () => {});

let fontCss;
function embeddedFonts() {
  return fontCss ??= (async () => {
    const sheet = await (await fetch($('#font-css').href)).text();
    const faces = [...sheet.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g)]
      .filter(([, subset, body]) => subset === 'latin' && !/font-style:\s*italic/.test(body));
    const out = await Promise.all(faces.map(async ([, , body]) => {
      const bytes = new Uint8Array(await (await fetch(body.match(/url\(([^)]+)\)/)[1])).arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return `@font-face{${body.replace(/url\([^)]+\)/, `url(data:font/woff2;base64,${btoa(bin)})`)}}`;
    }));
    if (!out.length) throw new Error('no fonts');
    return out.join('');
  })().catch(() => { fontCss = undefined; return ''; });
}
$('#templates').addEventListener('click', async e => {
  const b = e.target.closest('[data-tpl]');
  if (!b) return;
  const f = FORMATS.find(x => x.id === b.dataset.tpl), [head, sub] = words();
  b.disabled = true;
  try {
    const fonts = await embeddedFonts();
    const svg = templateSvg(f, head, sub, fonts);
    const name = `pear-${f.id}-${f.w}x${f.h}`;
    if (b.dataset.as === 'svg') save(new Blob([svg], { type: 'image/svg+xml' }), `${name}.svg`);
    else await svgToPng(svg, f.w, f.h, `${name}.png`);
    say(fonts ? `Saved ${name}.${b.dataset.as}` : `Saved ${name}.${b.dataset.as} without embedded fonts (fonts could not be fetched)`);
  } catch { say('Export failed. Try the SVG, or serve the kit over http.'); }
  finally { b.disabled = false; }
});

/* ---------- press ---------- */
const boiler = () => $('#boilerplate').textContent.trim();
$('#copy-boilerplate').addEventListener('click', () => copy(boiler(), 'boilerplate'));
$('#download-press').addEventListener('click', () => {
  const facts = [...document.querySelectorAll('#facts div')].map(d => `${d.querySelector('dt').textContent}: ${d.querySelector('dd').textContent}`);
  save(new Blob([`Pear\n\n${boiler()}\n\nFacts\n${facts.join('\n')}\n`], { type: 'text/plain' }), 'pear-press.txt');
  say('Saved pear-press.txt');
});
