// Smoke with an isolated offline session, not cloud authentication evidence.
// QA_NATIVE_CDP attaches to a separately launched native app with a temporary WebView2 profile.
// Run with NODE_PATH pointing to an external Playwright installation; no project dependency changes.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const out = process.env.QA_SMOKE_OUTPUT || path.join(process.env.TEMP || '/tmp', 'pear-qa-smoke');
  fs.mkdirSync(out, { recursive: true });
  const native = Boolean(process.env.QA_NATIVE_CDP);
  const browser = native ? await chromium.connectOverCDP(process.env.QA_NATIVE_CDP) : await chromium.launch({ headless: true, ...(process.env.QA_CHROMIUM ? { executablePath: process.env.QA_CHROMIUM } : {}) });
  const page = native ? browser.contexts()[0].pages()[0] : await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(4000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const results = [];
  async function check(name, fn) {
    try { await fn(); results.push({ name, passed: true }); }
    catch (e) { results.push({ name, passed: false, error: e.message }); }
    console.log(JSON.stringify(results[results.length - 1]));
    await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
  }
  async function menu(top, item) {
    await page.getByRole('menuitem', { name: top, exact: true }).click();
    await page.getByRole('menuitem', { name: item, exact: true }).click();
  }
  try {
    if (!native) await page.goto(process.env.QA_STUDIO_URL || 'http://127.0.0.1:5173');
    await check('01-launch-login', async () => {
      await page.getByRole('button', { name: 'Sign in', exact: true }).first().waitFor();
      assert.equal(await page.getByRole('button', { name: 'Sign in', exact: true }).first().isVisible(), true);
    });
    // Synthetic offline session lets local editor flows run without credentials or backend mutations.
    await page.evaluate(() => localStorage.setItem('pear.studio.session', JSON.stringify({ token: 'qa-offline', account: { id: 'qa', username: 'qa' } })));
    await page.reload();
    await check('02-open-template', async () => {
      await page.getByRole('button', { name: 'New project', exact: true }).click();
      await page.getByRole('button', { name: 'New game from Tap counter (example)', exact: true }).click();
      await page.getByPlaceholder('The name players see, e.g. Relay Race').fill('QA offline smoke');
      await page.getByPlaceholder('What the game is, in a few sentences').fill('Offline local editor smoke');
      await page.getByPlaceholder('e.g. The first team across the line wins').fill('Reach ten taps');
      await page.getByPlaceholder('e.g. Drop the baton and you are out').fill('Run out of time');
      await page.getByRole('spinbutton', { name: 'Fewest players', exact: true }).fill('2');
      await page.getByRole('spinbutton', { name: 'Most players', exact: true }).fill('4');
      await page.getByRole('button', { name: 'Create game', exact: true }).click();
      await page.getByRole('button', { name: 'New project', exact: true }).waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: 'Play (F5)', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'New project', exact: true }).isVisible(), false);
    });
    await check('03-reset-layout', async () => { await menu('View', 'Reset layout'); });
    await check('04-reopen-preview', async () => { await menu('View', 'Layout: script focus'); await menu('View', 'Live Preview'); assert.equal(await page.getByRole('button', { name: 'Reconnect simulators', exact: true }).isVisible(), true); });
    await check('05-preview-offline', async () => {
      await page.getByRole('button', { name: 'Reconnect simulators', exact: true }).click();
      assert.match(await page.locator('body').innerText(), /Open a cloud game first|No cloud game open/);
    });
    await check('05b-relay-error-retry', async () => {
      await page.getByText('Connect real peripherals', { exact: true }).click();
      assert.match(await page.locator('body').innerText(), /local Test runner, not these cloud UI simulators/);
      await page.getByRole('button', { name: 'Connect device relay', exact: true }).click();
      await page.waitForTimeout(1500);
      assert.match(await page.locator('body').innerText(), /Device relay unavailable|No devices|connected|Connecting/);
      await page.getByRole('button', { name: 'Disconnect relay', exact: true }).click();
      await page.getByRole('button', { name: 'Connect device relay', exact: true }).click();
      await page.getByRole('button', { name: 'Disconnect relay', exact: true }).click();
    });
    await check('06-settings', async () => { await menu('File', 'Settings...'); await page.getByRole('button', { name: 'Done', exact: true }).click(); });
    await check('06b-api-key-validation', async () => {
      await page.getByRole('menuitem', { name: 'Window', exact: true }).click();
      await page.getByRole('menuitemcheckbox', { name: 'Marketplace', exact: true }).click();
      const key = page.getByRole('textbox', { name: 'Model API key', exact: true });
      await key.fill('not a real key');
      await page.getByRole('button', { name: 'Save key', exact: true }).click();
      await page.getByText('Enter a model API key without whitespace.', { exact: true }).waitFor();
      await key.fill('');
    });
    await check('07-editor-selection', async () => {
      await menu('View', 'Reset layout');
      const scripts = page.getByRole('listbox', { name: 'client scripts', exact: true });
      await scripts.getByRole('option').first().dblclick();
      await page.locator('.cm-editor').first().waitFor();
    });
    await check('08-small-window', async () => {
      await page.setViewportSize({ width: 900, height: 650 });
      await menu('View', 'Reset layout');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'document must not overflow horizontally');
    });
    await check('09-images', async () => {
      const images = await page.locator('img').evaluateAll(imgs => imgs.map(i => ({ src: i.src, loaded: i.complete && i.naturalWidth > 0 })));
      assert.ok(images.every(i => i.loaded), JSON.stringify(images.filter(i => !i.loaded)));
      results.push({ name: 'image-count', count: images.length, note: 'Zero images does not validate carousel or marketplace assets.' });
    });
    await check('10-runtime-errors', async () => assert.deepEqual(errors, []));
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ evidence: `${native ? 'native WebView2 CDP; existing binary, not current source build' : 'browser-only'}; synthetic offline session; no backend`, results, errors }, null, 2));
    console.log(JSON.stringify({ out, results, errors }, null, 2));
    if (results.some(r => r.passed === false)) process.exitCode = 1;
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
