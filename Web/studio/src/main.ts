// Composition root: wires the SDK packages (core, runtime, script, sim, cloud) to the panels.
import { flattenScene } from '@omni/runtime';
import './theme.css';
import { AccountController, describeError, openAccountSheet } from './account';
import { createInspectorPanel } from './inspector';
import { DebugStore, createConsolePanel } from './debug-panel';
import { EditorBus, createEditorPanel, openApiSheet } from './editor';
import { Selection, createExplorerPanel } from './explorer';
import { LayoutManager, type PanelSpec } from './layout';
import { MarketplaceController, openScriptAndReveal, runtimePort } from './marketplace/controller';
import { BrowserInstaller, TauriInstaller } from './marketplace/installer';
import { MARKETPLACE_PANEL_ID, marketplacePanel } from './marketplace/panel';
import { RegistryClient } from './marketplace/registry';
import { deepAgentPanel } from './panels/deep-agent';
import { PreferenceStore, bindPreferences, inDesktopApp, openSettingsSheet } from './preferences';
import { createTestPanel } from './testPanel';
import { openNewGameSheet } from './newGame';
import { walkEntities, Project, TEMPLATES, attachAutosave, templateSnapshot, type ProjectSnapshot } from './project';
import { RunController, ViewportHost, createViewportPanel } from './run';
import { announce, button, el, openMenu, openSheet, promptSheet, rovingToolbar, type MenuItem } from './ui';
import { installShortcuts, mod, mountMenuBar } from './menubar';
import { renderLoginScreen } from './loginScreen';
import { renderProjectsScreen } from './projectsScreen';
import { nextScreen, type Screen } from './screens';
import { rememberRecent } from './recent';
import { openProjectFile, safeFileName, saveProjectFile, type SavedFile } from './projectFile';

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
debug.testPlayer = testPlayer?.name ?? null;
// A test player tab: fetch a version, load it into the project and join it (at startup and on a server `_reload`).
const joinVersion = async (version: number | 'latest') => {
  const v = await account.client.fetchVersion(testPlayer!.gameId, version);
  project.load(Project.snapshotOfVersion(v));
  history.replaceState(null, '', `${location.pathname}?${new URLSearchParams({ join: v.game_id, version: String(v.version), as: testPlayer!.name })}`);
  await run.join(v.game_id, v.version);
};
const run = new RunController({ project, debug, account, viewport, editor, reveal: (id) => layout.show(id), onReload: testPlayer ? joinVersion : undefined });

const marketplace = new MarketplaceController({
  registry: new RegistryClient(() => prefs.get().serverUrl),
  installer: inDesktopApp() ? new TauriInstaller() : new BrowserInstaller(),
  host: { register: (spec) => layout.register(spec), unregister: (id) => layout.unregister(id), openRight: (id) => layout.openRight(id) },
  panels: { 'langchain-deepagents': (manifest) => deepAgentPanel({ url: `ws://localhost:${runtimePort(manifest)}/ws`, project, openScript: openScriptAndReveal(editor, (id) => layout.show(id)) }) },
  projectId: () => (project.gameId ?? 'local').replace(/[^A-Za-z0-9_-]/g, '_'),
  storage: localStorage,
});

const panels: PanelSpec[] = [
  marketplacePanel(marketplace),
  { id: 'explorer', title: 'Explorer', create: () => createExplorerPanel(project, selection, editor) },
  { id: 'viewport', title: 'Viewport', create: () => createViewportPanel(viewport, run) },
  { id: 'inspector', title: 'Inspector', create: () => createInspectorPanel(project, selection) },
  { id: 'editor', title: 'Script editor', create: () => createEditorPanel(project, editor) },
  { id: 'console', title: 'Console', create: () => createConsolePanel(debug) },
  { id: 'test', title: 'Test', create: () => createTestPanel(project, run) },
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
viewport.onPick = (id) => selection.set(id);
viewport.selectedId = () => selection.entityId;
viewport.entityY = (id) => { let y: number | undefined; walkEntities(project.scene, (e, eid) => { if (eid === id && Array.isArray(e.position)) y = Number(e.position[1]); }); return y; };
viewport.onMove = (id, x, z) => project.updateEntity(id, (e) => { const p = (e.position as number[] | undefined) ?? [0, 0, 0]; e.position = [x, p[1] ?? 0, z]; });
prefs.onChange(() => viewport.refreshColors());

// Actions
const activity = el('div', { class: 'om-activity' });
const status = (text: string) => {
  activity.replaceChildren(el('span', {}, [text]));
  announce(text);
};

const confirmDiscard = (): Promise<boolean> => new Promise((resolve) => {
  if (!project.dirty) return resolve(true);
  let answer = false;
  openSheet('Discard unsaved changes?', (body, close) => {
    const keep = button('Keep editing', close);
    const discard = button('Discard changes', () => {
      answer = true;
      close();
    }, { variant: 'default' });
    body.append(el('p', {}, [`${project.name} has changes you have not saved.`]), el('div', { class: 'sheet-actions' }, [keep, discard]));
    // Escape and the backdrop also close the sheet, which keeps editing.
    const dialog = body.parentElement as HTMLDialogElement;
    dialog.addEventListener('close', () => resolve(answer), { once: true });
    queueMicrotask(() => keep.focus());
  });
});
/** The file this project was opened from / last saved to; Save overwrites it, Save as picks a new one. */
let projectFile: SavedFile | null = null;
const openSnapshot = async (snapshot: ProjectSnapshot): Promise<boolean> => {
  if (!(await confirmDiscard())) return false;
  run.stop();
  project.load(snapshot);
  projectFile = null;
  status(`Opened ${project.name}`);
  return true;
};

// Screens: login and projects are full-window overlays; the editor stays mounted underneath.
const screenEl = document.getElementById('screen')!;
const studioEl = document.getElementById('studio')!;
let hasProject = false;
const showScreen = (s: Screen) => {
  const overlay = s !== 'editor';
  screenEl.hidden = !overlay;
  studioEl.inert = overlay;
  if (overlay) document.title = `${s === 'login' ? 'Sign in' : 'Projects'} - Omni Studio`;
  else renderChrome();
  if (s === 'login') renderLoginScreen(screenEl, account, prefs, () => showScreen(nextScreen(true, hasProject)));
  else if (s === 'projects') {
    renderProjectsScreen(screenEl, {
      account,
      open: (snapshot, file) => void openSnapshot(snapshot).then((ok) => {
        if (!ok) return;
        if (file) projectFile = file;
        hasProject = true;
        showScreen('editor');
      }),
      signOut: () => void account.signOut().catch(() => showScreen('login')),
      back: hasProject ? () => showScreen('editor') : undefined,
    });
  }
};
if (!testPlayer) account.onChange(() => !account.account && showScreen('login'));

const guard = (work: () => Promise<void> | void) => async () => {
  try {
    await work();
  } catch (e) {
    const message = describeError(e, account.serverUrl);
    debug.addOutput('error', message);
    status(message);
  }
};

const saveTo = (asNew: boolean) => guard(async () => {
  const saved = await saveProjectFile(project.snapshot(), projectFile?.name ?? safeFileName(project.name), asNew ? null : (projectFile?.handle ?? null));
  if (!saved) return; // picker cancelled
  projectFile = saved;
  project.markSaved();
  void rememberRecent(saved.name, project.snapshot());
  status(`Saved ${project.name} to ${saved.name}`);
});
const save = saveTo(false);
const saveAs = saveTo(true);

const openFile = guard(async () => {
  if (!(await confirmDiscard())) return;
  const opened = await openProjectFile();
  if (!opened) return;
  run.stop();
  project.load(opened.snapshot);
  projectFile = { name: opened.name, handle: opened.handle };
  void rememberRecent(opened.name, opened.snapshot);
  status(`Opened ${opened.name}`);
});

const publish = guard(async () => {
  if (!account.account || !account.gameId) return openAccountSheet(account, prefs, { project, openSnapshot });
  const v = await account.publish(project);
  debug.addOutput('log', `Published version ${v.version} of ${account.game?.title ?? 'the game'}.`);
  status(`Published version ${v.version}`);
});

// Toolbar
const toolbar = document.getElementById('toolbar')!;
const runLocal = button('Play', guard(() => run.runLocal()), { icon: 'play', variant: 'borderless', ariaLabel: 'Play (F5)' });
// Less common ways to run sit behind one menu so the toolbar stays Play, Stop, Publish.
const runServer = button('', () => openMenu(runServer, [
  { label: 'Play locally', shortcut: 'F5', disabled: run.running, run: () => void guard(() => run.runLocal())() },
  { label: 'Play on server', disabled: run.running, run: () => void guard(() => run.runServer())() },
  { label: 'Add test player (new tab)', disabled: !project.gameId || !project.version, run: () => void guard(() => run.addTestPlayer())() },
]), { icon: 'chev', variant: 'borderless', ariaLabel: 'More ways to play' });
const stop = button('Stop', () => run.stop(), { icon: 'stop', variant: 'borderless', ariaLabel: 'Stop (Shift+F5)' });
const projectButton = button('', () => {
  const items = TEMPLATES.map((t) => ({ label: `Open template: ${t.label}`, run: () => openSnapshot(templateSnapshot(t.id)) }));
  openMenu(projectButton, [
    ...items,
    { label: 'Open from cloud (latest version)...', run: () => openAccountSheet(account, prefs, { project, openSnapshot }) },
    { separator: true },
    { label: 'Save', shortcut: mod('Ctrl+S'), run: save },
    { label: 'Save as...', shortcut: mod('Ctrl+Shift+S'), run: saveAs },
  ]);
}, { variant: 'borderless' });
projectButton.classList.add('om-scheme');
const publishButton = button('Publish', publish, { variant: 'default' });
const saveLayoutAs = () => promptSheet('Save layout', 'Layout name', '', 'Save', (name) => {
  if (!name) return 'Enter a name for this layout.';
  layout.saveNamed(name);
  status(`Saved layout ${name}`);
  return undefined;
});
const sep = () => el('span', { class: 'om-sep', 'aria-hidden': 'true' });
toolbar.append(runLocal, runServer, stop, sep(), projectButton, activity, publishButton);
rovingToolbar(toolbar);

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
  runLocal.disabled = run.running;
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
  if (screenEl.hidden) document.title = `${testPlayer ? 'Test player: ' : ''}${project.dirty ? '* ' : ''}${project.name} - Omni Studio`;
  renderActivity();
};
run.onChange(renderState);
project.onChange(renderChrome);
account.onChange(renderChrome);
renderState();
renderChrome();

// Menu bar and the shortcut table behind it. Text fields and the script editor keep their own Ctrl+Z / Ctrl+Y.
const startLocal = () => {
  if (!run.running) void guard(() => run.runLocal())();
};
const startServer = () => {
  if (!run.running) void guard(() => run.runServer())();
};
const undo = () => {
  project.undo();
  status('Undo');
};
const redo = () => {
  project.redo();
  status('Redo');
};
const frame = () => {
  if (!viewport.frameSelected()) status('Select an entity to frame it');
};
const deleteSelected = () => {
  const id = selection.entityId;
  if (id) status(project.deleteEntity(id) ? `Deleted ${id}` : `Could not delete ${id}`);
};
installShortcuts([
  { key: 's', ctrl: true, inText: true, run: () => void save() },
  { key: 's', ctrl: true, shift: true, inText: true, run: () => void saveAs() },
  { key: 'o', ctrl: true, inText: true, run: () => void openFile() },
  { key: 'z', ctrl: true, run: undo },
  { key: 'z', ctrl: true, shift: true, run: redo },
  { key: 'y', ctrl: true, run: redo },
  { key: 'f5', inText: true, run: startLocal },
  { key: 'f5', shift: true, inText: true, run: () => run.stop() },
]);
const layoutLabel = (id: 'default' | 'script-focus' | 'debug-focus', label: string): MenuItem => ({ label, run: () => layout.applyPreset(id) });
mountMenuBar(document.getElementById('menubar')!, [
  {
    label: 'File',
    items: () => [
      { label: 'Projects...', run: () => showScreen('projects') },
      { label: 'New game...', run: () => openNewGameSheet((snap) => void openSnapshot(snap)) },
      ...TEMPLATES.map((t) => ({ label: `Open template: ${t.label}`, run: () => void openSnapshot(templateSnapshot(t.id)) })),
      { label: 'Open from cloud...', run: () => openAccountSheet(account, prefs, { project, openSnapshot }) },
      { label: 'Open file...', shortcut: mod('Ctrl+O'), run: () => void openFile() },
      { separator: true },
      { label: 'Save', shortcut: mod('Ctrl+S'), run: () => void save() },
      { label: 'Save as...', shortcut: mod('Ctrl+Shift+S'), run: () => void saveAs() },
      { separator: true },
      { label: 'Publish', run: () => void publish() },
      { label: 'Account and games...', run: () => openAccountSheet(account, prefs, { project, openSnapshot }) },
      { label: 'Settings...', run: () => openSettingsSheet(prefs) },
      { label: 'Sign out', run: () => void account.signOut().catch(() => showScreen('login')) },
    ],
  },
  {
    label: 'Edit',
    items: () => [
      { label: 'Undo', shortcut: mod('Ctrl+Z'), disabled: !project.canUndo, run: undo },
      { label: 'Redo', shortcut: mod('Ctrl+Shift+Z'), disabled: !project.canRedo, run: redo },
      { separator: true },
      { label: 'Delete selected entity', disabled: !selection.entityId, run: deleteSelected },
    ],
  },
  {
    label: 'View',
    items: () => [
      { label: 'Frame selected', shortcut: 'F', run: frame },
      { label: 'Reset camera', run: () => viewport.resetCamera() },
      { separator: true },
      layoutLabel('default', 'Layout: default'),
      layoutLabel('script-focus', 'Layout: script focus'),
      layoutLabel('debug-focus', 'Layout: debug focus'),
      { label: 'Reset layout', run: () => layout.reset() },
    ],
  },
  { label: 'Window', items: () => layout.menuItems(saveLayoutAs, (name) => layout.deleteNamed(name)) },
  {
    label: 'Run',
    items: () => [
      { label: 'Play locally', shortcut: 'F5', disabled: run.running, run: startLocal },
      { label: 'Play on server', disabled: run.running, run: startServer },
      { label: 'Stop', shortcut: 'Shift+F5', disabled: !run.running, run: () => run.stop() },
      { label: 'Add player', disabled: !run.running, run: () => void guard(() => run.addPlayer())() },
      { label: 'Add test player', disabled: !project.gameId || !project.version, run: () => void guard(() => run.addTestPlayer())() },
    ],
  },
  {
    label: 'Help',
    items: () => [{ label: 'API reference...', run: () => openApiSheet() }, {
      label: 'Viewport controls...',
      run: () => openSheet('Viewport controls', (body, close) => body.append(
        el('ul', {}, [
          'Right drag: rotate (hold Alt to rotate around the vertical axis only)',
          'Middle drag, or Shift + left drag: pan',
          'Scroll wheel: zoom',
          'W A S D: fly forward, left, back, right (hold Shift to go faster)',
          'Q / E: fly down / up',
          'Left click: select',
          'F: frame the selected entity',
        ].map((t) => el('li', {}, [t]))),
        el('div', { class: 'sheet-actions' }, [button('Close', close, { variant: 'default' })]),
      )),
    }],
  },
]);
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
marketplace.registerInstalled(); // before start(), so a saved layout that names an installed plugin's panel loads
layout.start();
refreshScene();
if (testPlayer) {
  document.title = `Test player ${testPlayer.name} - Omni Studio`;
  void guard(async () => {
    status(`Signing in as ${testPlayer.name}`);
    await account.signIn(testPlayer.name);
    await joinVersion(testPlayer.version ?? 'latest');
  })();
} else {
  attachAutosave(project, (message) => debug.addOutput('warn', message));
  if (account.account) void account.refreshGames().catch(() => {});
  showScreen(nextScreen(!!account.account, false));
  void marketplace.boot();
}
