// Current-source browser regression. Uses the QA runner's external Playwright; no backend credentials or native-executable claims.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const base = process.env.QA_STUDIO_URL || 'http://127.0.0.1:5173';
  const out = process.env.QA_SMOKE_OUTPUT || path.join(process.env.TEMP, 'pear-hosted-layout');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROMIUM ? { executablePath: process.env.QA_CHROMIUM } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(6000);
  const results = [];
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  async function check(name, work) {
    try { await work(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, error: error.message }); }
    await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
    console.log(JSON.stringify(results.at(-1)));
  }
  const menu = async (top, item, role = 'menuitem') => {
    await page.getByRole('menuitem', { name: top, exact: true }).click();
    await page.getByRole(role, { name: item, exact: true }).click();
  };
  const tab = (name) => page.locator('.dv-tab').filter({ hasText: name });
  try {
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      const games = [{ id: 'chosen', owner_id: 'qa', title: 'Hosted chosen', created_at: '', updated_at: '' }];
      let body = {};
      let status = 200;
      if (url.pathname.endsWith('/games')) body = games;
      else if (url.pathname.endsWith('/versions/latest')) body = await page.evaluate(async () => {
        const { Project, templateSnapshot } = await import('/src/project.ts');
        return { ...new Project(templateSnapshot('tapcounter')).toVersion(), id: 'v-chosen', game_id: 'chosen', version: 7, published_at: '' };
      });
      else status = 404;
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto(base);
    await page.evaluate(() => localStorage.setItem('pear.studio.session', JSON.stringify({ token: 'qa-offline', account: { id: 'qa', username: 'qa' } })));
    await page.reload();
    await check('01-hosted-tile-matching-selection', async () => {
      await page.getByRole('button', { name: 'Open Hosted chosen', exact: true }).click();
      await page.getByRole('button', { name: 'Play (F5)', exact: true }).waitFor();
      await page.waitForFunction(() => localStorage.getItem('pear.studio.game') === 'chosen');
      assert.equal(await page.evaluate(() => localStorage.getItem('pear.studio.game')), 'chosen');
      assert.equal(await tab('Live Preview').getAttribute('aria-selected'), 'true');
    });
    await check('02-explorer-activates-editor', async () => {
      const scripts = page.getByRole('listbox', { name: 'client scripts', exact: true });
      await scripts.getByRole('option').first().dblclick();
      assert.equal(await tab('Script editor').getAttribute('aria-selected'), 'true');
      assert.equal(await page.locator('.cm-editor').isVisible(), true);
      assert.equal(await page.locator('.ed-body').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    });
    await check('03-window-close-reopen-reset', async () => {
      await menu('Window', 'Script editor', 'menuitemcheckbox');
      assert.equal(await tab('Script editor').count(), 0);
      await menu('Window', 'Script editor', 'menuitemcheckbox');
      assert.equal(await tab('Script editor').getAttribute('aria-selected'), 'true');
      await menu('View', 'Reset layout');
      assert.equal(await tab('Live Preview').getAttribute('aria-selected'), 'true');
    });
    // Isolate Dockview with real DOM and pointer input; the production manager is imported unchanged.
    await page.goto(`${base}/popout.html`);
    await page.evaluate(async () => {
      await import('/src/theme.css');
      const { LayoutManager } = await import('/src/layout.ts');
      const host = document.createElement('div');
      host.id = 'dock';
      const shell = document.createElement('div');
      shell.id = 'studio';
      shell.style.gridTemplateRows = 'minmax(0, 1fr)';
      shell.append(host);
      document.body.append(shell);
      const ids = ['livePreview', 'editor', 'explorer', 'peripherals', 'test', 'inspector', 'console', 'viewport'];
      const specs = ids.map(id => ({ id, title: id, create: () => {
        const element = document.createElement('div');
        element.textContent = id;
        return { element };
      } }));
      localStorage.removeItem('pear.studio.layout.current');
      window.qaLayout = new LayoutManager(host, specs);
      window.qaLayout.start();
    });
    const panels = () => page.evaluate(() => window.qaLayout.api.toJSON());
    await check('04-pointer-tab-reorder', async () => {
      const editor = tab('editor');
      const preview = tab('livePreview');
      const from = await editor.boundingBox();
      const to = await preview.boundingBox();
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(to.x + 4, to.y + to.height / 2, { steps: 16 });
      await page.mouse.up();
      assert.equal(await page.evaluate(() => window.qaLayout.api.getPanel('editor').group.panels[0].id), 'editor');
    });
    await check('05-pointer-split', async () => {
      const editor = await tab('editor').boundingBox();
      const group = await page.evaluate(() => {
        const r = window.qaLayout.api.getPanel('livePreview').group.element.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
      await page.mouse.move(editor.x + editor.width / 2, editor.y + editor.height / 2);
      await page.mouse.down();
      await page.mouse.move(group.x + group.width - 8, group.y + group.height / 2, { steps: 24 });
      await page.mouse.up();
      assert.equal(await page.evaluate(() => window.qaLayout.api.getPanel('editor').group !== window.qaLayout.api.getPanel('livePreview').group), true);
    });
    await check('06-pointer-resize', async () => {
      const sash = page.locator('.dv-sash.dv-enabled').filter({ visible: true }).first();
      const box = await sash.boundingBox();
      const before = JSON.stringify(await panels());
      const horizontal = await sash.evaluate(el => el.closest('.dv-split-view-container').classList.contains('dv-horizontal'));
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + (horizontal ? 60 : 0), box.y + box.height / 2 + (horizontal ? 0 : 60), { steps: 12 });
      await page.mouse.up();
      assert.notEqual(JSON.stringify(await panels()), before);
    });
    await check('07-persist-restore-close-reopen', async () => {
      await page.waitForTimeout(400);
      const before = await panels();
      await page.evaluate(() => window.qaLayout.saveNamed('QA saved'));
      await page.evaluate(() => window.qaLayout.reset());
      assert.equal(await page.evaluate(() => window.qaLayout.loadNamed('QA saved')), true);
      assert.deepEqual(await panels(), before);
      await page.evaluate(() => window.qaLayout.togglePanel('editor'));
      assert.equal(await tab('editor').count(), 0);
      await page.evaluate(() => window.qaLayout.show('editor'));
      assert.equal(await tab('editor').getAttribute('aria-selected'), 'true');
    });
    await check('08-old-serialized-constraints', async () => {
      await page.evaluate(() => {
        window.qaLayout.applyPreset('script-focus');
        const old = window.qaLayout.api.toJSON();
        localStorage.setItem('pear.studio.layouts', JSON.stringify({ Old: old }));
        window.qaLayout.reset();
        window.qaLayout.loadNamed('Old');
      });
      const sizes = await page.evaluate(() => ({ inspector: window.qaLayout.api.getPanel('inspector').group.minimumHeight, editor: window.qaLayout.api.getPanel('editor').group.minimumWidth }));
      assert.ok(sizes.inspector >= 180, JSON.stringify(sizes));
      assert.ok(sizes.editor >= 280, JSON.stringify(sizes));
    });
    await check('09-minimum-and-scaled-window', async () => {
      for (const [width, height, scale] of [[2880, 1684, 1], [1024, 640, 1], [1024, 640, 1.5], [1024, 640, 2]]) {
        await page.setViewportSize({ width, height });
        await page.evaluate(async scale => {
          document.documentElement.style.setProperty('--ui-scale', scale);
          await new Promise(requestAnimationFrame);
          window.qaLayout.reset();
          await new Promise(requestAnimationFrame);
        }, scale);
        const geometry = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
          groups: window.qaLayout.api.groups.map(g => { const r = g.element.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom }; }),
        }));
        assert.equal(geometry.overflow, false, JSON.stringify({ width, height, scale, geometry }));
        assert.ok(geometry.groups.every(g => g.x >= 0 && g.y >= 0 && g.right <= width + 2 && g.bottom <= height + 2), JSON.stringify({ width, height, scale, geometry }));
      }
    });
    await check('10-scaled-sash-distance', async () => {
      const sash = page.locator('.dv-sash.dv-enabled[aria-orientation="vertical"]').filter({ visible: true }).first();
      const box = await sash.boundingBox();
      const before = await page.evaluate(() => window.qaLayout.api.getPanel('explorer').group.element.getBoundingClientRect().width);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 - 30, box.y + box.height / 2, { steps: 12 });
      await page.mouse.up();
      const after = await page.evaluate(() => window.qaLayout.api.getPanel('explorer').group.element.getBoundingClientRect().width);
      assert.ok(Math.abs(Math.abs(after - before) - 30) < 6, JSON.stringify({ before, after, expectedPhysicalDelta: 30 }));
    });
    assert.deepEqual(errors, []);
  } finally {
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ evidence: 'Current-source browser, mocked hosted APIs; no credentials, physical hardware or native executable evidence', results, errors }, null, 2));
    await browser.close();
  }
  if (results.some(result => !result.passed)) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
