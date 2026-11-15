// Read-only public deployment probe and current-source browser player with mock cloud transport.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const out = path.join(__dirname, 'qa-deadline-evidence');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const results = [], errors = [], frames = [], sockets = [];
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5000);
  page.on('pageerror', e => errors.push(e.message));
  async function check(name, fn) {
    try { await fn(); results.push({ name, passed: true }); }
    catch (e) { results.push({ name, passed: false, error: e.message }); }
    await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
    console.log(JSON.stringify(results.at(-1)));
  }
  try {
    await check('01-public-player-entry', async () => {
      await page.goto('https://155-138-208-146.sslip.io/player.html?game=qa-readonly&lobby=QATEST&kind=phone&role=phone');
      await page.waitForTimeout(1200);
      assert.equal(await page.getByRole('button', { name: 'Join lobby', exact: true }).count(), 1, 'Public /player.html must render the player, not Studio SPA fallback');
    });
    const gamesResponse = await page.request.get('https://155-138-208-146.sslip.io/api/games');
    results.push({ name: 'public-hosted-game-access', status: gamesResponse.status(), note: 'No credentials or remote writes used; 401 blocks authentic hosted game selection.' });
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/accounts/signin') return route.fulfill({ json: { token: 'qa-mocked', account: { id: 'qa-player', display_name: 'QA phone' } } });
      if (url.pathname === '/api/games') return route.fulfill({ json: [{ id: 'qa-game', owner_id: 'qa', title: 'QA hosted fixture', created_at: '', updated_at: '' }] });
      if (url.pathname.endsWith('/versions/latest')) {
        const template = await page.evaluate(async () => {
          const { Project, templateSnapshot } = await import('/src/project.ts');
          return new Project(templateSnapshot('tapcounter')).toVersion();
        });
        template.scene.name = 'QA imported scene sentinel';
        template.scene.peripherals = ['phone'];
        template.client_scripts.qaImported = '// QA imported client sentinel\nexport default script({});';
        template.server_scripts.qaImportedServer = '// QA imported server sentinel\nexport default serverScript({});';
        return route.fulfill({ json: { ...template, id: 'v1', game_id: 'qa-game', version: 1, metadata: { ...template.metadata, qaPublishedSentinel: 'must survive' }, assets: { 'ui.json': { data: Buffer.from(fs.readFileSync(path.join(__dirname, 'fixtures/livepreview-ui.json'))).toString('base64') }, 'qa-image.png': { sha256: 'a'.repeat(64), contentType: 'image/png' } } } });
      }
      return route.fulfill({ status: 404, json: {} });
    });
    await page.routeWebSocket('**/play/**', socket => {
      sockets.push(socket.url());
      socket.onMessage(data => frames.push(JSON.parse(data)));
      socket.send(JSON.stringify({ name: '_welcome', data: { id: 'qa-player', name: 'QA phone', lobby: 'QATEST' } }));
      socket.send(JSON.stringify({ name: 'state', data: { phase: 'ready', needs: 'QA hosted fixture' } }));
    });
    await check('02-local-invalid-link', async () => {
      await page.goto('http://localhost:5173/player.html?game=qa-game&lobby=bad-lobby&kind=phone&role=phone');
      await page.getByRole('heading', { name: 'Open a Live Preview link' }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Join lobby', exact: true }).count(), 0);
    });
    await check('03-local-join-render-role', async () => {
      await page.goto('http://localhost:5173/player.html?game=qa-game&lobby=QATEST&kind=phone&role=phone');
      assert.equal(await page.getByRole('button', { name: 'Enable motion', exact: true }).isDisabled(), true);
      await page.getByRole('textbox', { name: 'Player name' }).fill('QA phone');
      await page.getByRole('button', { name: 'Join lobby', exact: true }).click();
      await page.getByRole('button', { name: 'Ready', exact: true }).waitFor();
      await page.getByText('Connected · QA phone · lobby QATEST · phone', { exact: true }).waitFor();
      assert.equal(new URL(sockets.at(-1)).searchParams.get('lobby'), 'QATEST');
      assert.ok(frames.some(f => f.name === 'role' && f.data.role === 'phone' && f.data.kind === 'phone'));
      assert.equal(await page.locator('html').evaluate(el => el.scrollWidth <= innerWidth), true);
    });
    await check('04-local-button-local-state', async () => {
      await page.getByRole('button', { name: 'Ready', exact: true }).click();
      await page.getByRole('button', { name: 'Toggle note', exact: true }).click();
      await page.getByText('tapped', { exact: true }).waitFor();
      assert.ok(frames.some(f => f.name === 'ready' && f.data.ready === true));
    });
    await check('05-local-pointer-stop-leave', async () => {
      await page.getByRole('button', { name: 'Enable Touch / Pencil pad', exact: true }).click();
      const pad = page.getByLabel('Touch and Pencil input pad', { exact: true });
      await pad.click({ position: { x: 40, y: 30 } });
      await page.waitForTimeout(100);
      assert.ok(frames.some(f => f.name === 'pointer' && f.data.phase === 'down' && f.data.x >= 0 && f.data.x <= 1));
      await page.getByRole('button', { name: 'Stop sharing inputs', exact: true }).click();
      assert.equal(await pad.isVisible(), false);
      await page.getByRole('button', { name: 'Leave lobby', exact: true }).click();
      await page.getByText('You left the lobby. Inputs stopped.', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Ready', exact: true }).count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Enable motion', exact: true }).isDisabled(), true);
    });
    await check('06-local-ipad-independent-role', async () => {
      await page.goto('http://localhost:5173/player.html?game=qa-game&lobby=QATEST&kind=ipad&role=phone');
      await page.getByRole('button', { name: 'Join lobby', exact: true }).click();
      await page.getByText('Referee', { exact: true }).waitFor();
      assert.ok(frames.some(f => f.name === 'role' && f.data.kind === 'ipad' && f.data.role === 'phone'));
    });
    await page.routeWebSocket('**/debug/**', () => {});
    await check('07-studio-hosted-device-render', async () => {
      await page.goto('http://localhost:5173');
      await page.evaluate(() => localStorage.setItem('pear.studio.session', JSON.stringify({ token: 'qa-mocked', account: { id: 'qa', username: 'qa' } })));
      await page.reload();
      await page.getByRole('button', { name: 'Open QA hosted fixture', exact: true }).click();
      await page.getByRole('button', { name: 'Play (F5)', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Apply lobby / reconnect', exact: true }).click();
      await page.locator('.lp-phone .lp-canvas').getByRole('button', { name: 'Ready', exact: true }).waitFor();
      await page.locator('.lp-ipad .lp-canvas').getByText('Referee', { exact: true }).waitFor();
      assert.equal(await page.locator('.lp-device').count(), 2);
      assert.ok(frames.some(f => f.name === 'role' && f.data.kind === 'ipad' && f.data.role === 'referee'));
    });
    await check('08-hosted-explorer-script-selection-edit', async () => {
      await page.setViewportSize({ width: 1440, height: 1000 });
      const clients = page.getByRole('listbox', { name: 'client scripts', exact: true });
      await clients.getByRole('option').filter({ hasText: 'qaImported' }).dblclick();
      await page.locator('.cm-content').getByText('// QA imported client sentinel', { exact: true }).waitFor();
      await page.locator('.cm-content').click();
      await page.keyboard.press('Control+End');
      await page.keyboard.insertText('\n// QA local edit only');
      await page.locator('.cm-content').getByText('// QA local edit only', { exact: true }).waitFor();
      await page.getByRole('listbox', { name: 'server scripts', exact: true }).getByRole('option').filter({ hasText: 'qaImportedServer' }).dblclick();
      await page.locator('.cm-content').getByText('// QA imported server sentinel', { exact: true }).waitFor();
      assert.ok(await page.getByRole('listbox', { name: 'Peripherals', exact: true }).getByRole('option').count() > 0);
      await page.getByRole('listbox', { name: 'Scene entities', exact: true }).getByRole('option').first().click();
      assert.equal(await page.locator('.dv-tab').filter({ hasText: 'Inspector' }).getAttribute('aria-selected'), 'true', 'Entity selection must reveal Inspector');
    });
    await check('09-fetched-version-roundtrip-fidelity', async () => {
      const fidelity = await page.evaluate(async () => {
        const { Project } = await import('/src/project.ts');
        const published = await (await fetch('/api/games/qa-game/versions/latest')).json();
        const reconstructed = new Project(Project.snapshotOfVersion(published)).toVersion();
        return {
          scenePreserved: JSON.stringify(published.scene) === JSON.stringify(reconstructed.scene),
          clientScriptsPreserved: JSON.stringify(published.client_scripts) === JSON.stringify(reconstructed.client_scripts),
          serverScriptsPreserved: JSON.stringify(published.server_scripts) === JSON.stringify(reconstructed.server_scripts),
          publishedAssetKeys: Object.keys(published.assets), reconstructedAssetKeys: Object.keys(reconstructed.assets),
          assetsPreserved: JSON.stringify(published.assets) === JSON.stringify(reconstructed.assets),
          publishedMetadata: published.metadata, reconstructedMetadata: reconstructed.metadata,
          expectedMetadata: { ...published.metadata, name: published.scene.name, source: 'pear-studio' },
        };
      });
      fs.writeFileSync(path.join(out, 'import-fidelity.json'), JSON.stringify(fidelity, null, 2));
      assert.equal(fidelity.scenePreserved, true);
      assert.equal(fidelity.clientScriptsPreserved, true);
      assert.equal(fidelity.serverScriptsPreserved, true);
      assert.deepEqual(fidelity.reconstructedAssetKeys, fidelity.publishedAssetKeys, 'Published UI/image assets must survive hosted import and reconstruction');
      assert.equal(fidelity.assetsPreserved, true, 'Published asset contents must survive, not only their keys');
      // Studio already derives publishing name from the edited scene and records its own source.
      assert.deepEqual(fidelity.reconstructedMetadata, fidelity.expectedMetadata);
    });
    await check('10-no-runtime-errors', async () => assert.deepEqual(errors, []));
  } finally {
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ timestamp: new Date().toISOString(), evidence: 'Real Chrome; public deployment read-only; current-source localhost player uses mocked HTTP/WebSocket, not backend end-to-end', results, errors, sentFrames: frames }, null, 2));
    await browser.close();
  }
  if (results.some(r => r.passed === false)) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
