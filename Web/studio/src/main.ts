// Composition root: wires the SDK packages (core, runtime, script, sim, cloud) to the panels.
import { flattenScene } from '@omni/runtime';
import './theme.css';
import { AccountController, describeError, openAccountSheet } from './account';
import { createInspectorPanel } from './inspector';
import { DebugStore, createOutputPanel, createPacketsPanel, createServerPanel, createStatePanel } from './debug-panel';
import { EditorBus, createEditorPanel } from './editor';
import { Selection, createExplorerPanel } from './explorer';
import { LayoutManager, type PanelSpec } from './layout';
import { PreferenceStore, bindPreferences, inDesktopApp, openSettingsSheet } from './preferences';
import { Project, TEMPLATES, attachAutosave, loadDraft, templateSnapshot, type ProjectSnapshot } from './project';
import { RunController, ViewportHost, createDevicesPanel, createViewportPanel } from './run';
import { announce, button, el, openMenu, promptSheet } from './ui';

const params = new URLSearchParams(location.search);
/** A test-player tab (opened by "Add test player"): its own dev account, no autosave, no stored session. */
const testPlayer = params.has('join') ? { gameId: params.get('join')!, version: Number(params.get('version')) || undefined, name: params.get('as') || 'test-player' } : null;

const prefs = new PreferenceStore();
bindPreferences(prefs);

const project = new Project();
const selection = new Selection();
const editor = new EditorBus();
const debug = new DebugStore();
const account = new AccountController(prefs, !testPlayer);
const viewport = new ViewportHost();
debug.onServerError = (message) => editor.reportServerError(project, message);

let layout: LayoutManager;
const run = new RunController({ project, debug, account, viewport, editor, reveal: (id) => layout.show(id) });

const panels: PanelSpec[] = [
  { id: 'explorer', title: 'Explorer', create: () => createExplorerPanel(project, selection, editor) },
  { id: 'viewport', title: 'Viewport', create: () => createViewportPanel(viewport, run) },
  { id: 'inspector', title: 'Inspector', create: () => createInspectorPanel(project, selection) },
  { id: 'editor', title: 'Script editor', create: () => createEditorPanel(project, editor) },
  { id: 'output', title: 'Output', create: () => createOutputPanel(debug) },
  { id: 'server', title: 'Server', create: () => createServerPanel(debug) },
  { id: 'state', title: 'State', create: () => createStatePanel(debug) },
  { id: 'packets', title: 'Packets', create: () => createPacketsPanel(debug) },
  { id: 'devices', title: 'Devices', create: () => createDevicesPanel(run) },
];
// Desktop: a dockview popout window (window.open, same JS context) keeps the panel live with the main window's state.
layout = new LayoutManager(document.getElementById('dock')!, panels, inDesktopApp() ? {
  popOut: (id) => {
    const panel = layout.api.getPanel(id);
    if (panel) void layout.api.addPopoutGroup(panel, { popoutUrl: '/popout.html' });
  },
} : {});

// Viewport follows the scene and the selection; a scene that does not parse leaves the last good drawing.
const refreshScene = () => {
  try {
    viewport.setScene(flattenScene(project.description()));
  } catch (e) {
    debug.addOutput('error', `Scene is invalid: ${e instanceof Error ? e.message : String(e)}`);
  }
};
project.onChange((c) => {
  if (c === 'open') selection.set(null);
  if (c === 'open' || c === 'scene') refreshScene();
});
selection.onChange((id) => viewport.select(id));
prefs.onChange(() => viewport.refreshColors());

// Actions
const activity = el('div', { class: 'om-activity' });
const status = (text: string) => {
  activity.replaceChildren(el('span', {}, [text]));
  announce(text);
};

const confirmDiscard = () => !project.dirty || confirm('This project has unsaved changes. Discard them?');
const openSnapshot = (snapshot: ProjectSnapshot) => {
  if (!confirmDiscard()) return;
  run.stop();
  project.load(snapshot);
  status(`Opened ${project.name}`);
};

const save = () => {
  project.markSaved();
  status(`Saved ${project.name} locally`);
};

const guard = (work: () => Promise<void> | void) => async () => {
  try {
    await work();
  } catch (e) {
    const message = describeError(e, account.serverUrl);
    debug.addOutput('error', message);
    status(message);
  }
};

const publish = guard(async () => {
  if (!account.account || !account.gameId) return openAccountSheet(account, prefs, { project, openSnapshot });
  const v = await account.publish(project);
  debug.addOutput('log', `Published version ${v.version} of ${account.game?.title ?? 'the game'}.`);
  status(`Published version ${v.version}`);
});

// Toolbar
const toolbar = document.getElementById('toolbar')!;
const runLocal = button('Run local', guard(() => run.runLocal()), { icon: 'play', variant: 'borderless', ariaLabel: 'Run local (F5)' });
const runServer = button('Run on server', guard(() => run.runServer()), { icon: 'play', variant: 'borderless' });
const stop = button('Stop', () => run.stop(), { icon: 'stop', variant: 'borderless', ariaLabel: 'Stop (Shift+F5)' });
const testPlayerButton = button('Add test player', guard(() => run.addTestPlayer()), { variant: 'borderless' });
const projectButton = button('', () => {
  const items = TEMPLATES.map((t) => ({ label: `Open template: ${t.label}`, run: () => openSnapshot(templateSnapshot(t.id)) }));
  openMenu(projectButton, [
    ...items,
    { label: 'Open from cloud (latest version)...', run: () => openAccountSheet(account, prefs, { project, openSnapshot }) },
    { separator: true },
    { label: 'Save (Ctrl+S)', run: save },
  ]);
}, { variant: 'borderless' });
projectButton.classList.add('om-scheme');
const publishButton = button('Publish', publish, { variant: 'default' });
const windowButton = button('Window', () =>
  layout.openMenu(windowButton, () => promptSheet('Save layout', 'Layout name', '', 'Save', (name) => {
    if (!name) return 'Enter a name for this layout.';
    layout.saveNamed(name);
    status(`Saved layout ${name}`);
    return undefined;
  }), (name) => layout.deleteNamed(name)), { variant: 'borderless' });
const accountButton = button('Sign in', () => openAccountSheet(account, prefs, { project, openSnapshot }), { variant: 'borderless' });
const settingsButton = button('Settings', () => openSettingsSheet(prefs), { variant: 'borderless' });
const sep = () => el('span', { class: 'om-sep', 'aria-hidden': 'true' });
toolbar.append(runLocal, runServer, stop, testPlayerButton, sep(), projectButton, activity, publishButton, windowButton, accountButton, settingsButton);

// Status bar
const statusbar = document.getElementById('statusbar')!;
let lastRunText = '';
const renderActivity = () => {
  if (!run.running) {
    lastRunText = '';
    return void activity.replaceChildren(el('span', {}, [`Editing ${project.name}${project.version ? `, version ${project.version}` : ''}`]));
  }
  if (run.status.text !== lastRunText) status(run.status.text);
  lastRunText = run.status.text;
};
const renderState = () => {
  const s = run.status;
  stop.disabled = !run.running;
  runLocal.disabled = runServer.disabled = run.running;
  testPlayerButton.disabled = !project.gameId || !project.version;
  renderActivity();
  statusbar.replaceChildren(
    el('span', {}, [s.text]), el('span', { class: 'om-spacer' }),
    el('span', {}, [`Rate ${s.rateHz} Hz`]),
    el('span', {}, [s.latencyMs === null ? 'Latency none yet' : `Latency ${s.latencyMs} ms`]),
    ...(s.serverLatencyMs === null ? [] : [el('span', {}, [`Server ${s.serverLatencyMs} ms`])]),
    ...(s.players === null ? [] : [el('span', {}, [`Players ${s.players}`])]),
  );
};
const renderChrome = () => {
  const label = project.name + (project.dirty ? ' (unsaved)' : '');
  projectButton.replaceChildren(label);
  projectButton.setAttribute('aria-label', `${label}, project menu`);
  accountButton.textContent = account.account ? `Account: ${account.account.display_name || account.account.subject}` : 'Sign in';
  document.title = `${testPlayer ? 'Test player: ' : ''}${project.dirty ? '* ' : ''}${project.name} - Omni Studio`;
  testPlayerButton.disabled = !project.gameId || !project.version;
  renderActivity();
};
run.onChange(renderState);
project.onChange(renderChrome);
account.onChange(renderChrome);
renderState();
renderChrome();

// Keyboard: Ctrl+S saves, F5 runs locally, Shift+F5 stops.
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    save();
  } else if (e.key === 'F5') {
    e.preventDefault();
    if (e.shiftKey) run.stop();
    else if (!run.running) void guard(() => run.runLocal())();
  }
});
window.addEventListener('beforeunload', (e) => {
  if (project.dirty && !testPlayer) e.preventDefault();
});

// Desktop auto-update: one check at startup. The plugin is imported only here so the browser build never loads it.
// The capability grants updater but not process, so installing ends with "close and reopen" instead of a relaunch.
const checkForUpdate = async () => {
  const { check } = await import('@tauri-apps/plugin-updater');
  const update = await check();
  if (!update) return;
  const install = button('Restart to install', guard(async () => {
    install.disabled = true;
    status(`Downloading update ${update.version}`);
    try {
      await update.downloadAndInstall();
    } catch (e) {
      install.disabled = false; // let the user retry
      throw e;
    }
    install.remove();
    status(`Update ${update.version} installed. Close and reopen Omni Studio to finish.`);
  }), { variant: 'small' });
  activity.after(install);
  status(`Update ${update.version} available`);
};
if (inDesktopApp() && !testPlayer) checkForUpdate().catch((e) => debug.addOutput('warn', `Update check failed: ${e instanceof Error ? e.message : String(e)}`));

// Start
layout.start();
refreshScene();
if (testPlayer) {
  document.title = `Test player ${testPlayer.name} - Omni Studio`;
  void guard(async () => {
    status(`Signing in as ${testPlayer.name}`);
    await account.signIn(testPlayer.name);
    const v = await account.client.fetchVersion(testPlayer.gameId, testPlayer.version ?? 'latest');
    project.load(Project.snapshotOfVersion(v));
    await run.join(v.game_id, v.version);
  })();
} else {
  attachAutosave(project, (message) => debug.addOutput('warn', message));
  loadDraft().then((draft) => {
    if (draft && !project.dirty) project.load(draft);
  }).catch(() => {});
  if (account.account) void account.refreshGames().catch(() => {});
}
