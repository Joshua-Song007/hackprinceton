// Account: dev sign-in (provider "dev", subject = name), server URL, game picker, Publish with the version shown.
// Only game content goes to the server (Network Rule); the token is kept in localStorage, or in memory for test-player tabs.
import { ApiError, CloudClient, type Account, type Game, type GameManifest, type GameVersion } from '@pear/cloud';
import type { PreferenceStore } from './preferences';
import { Project, type ProjectSnapshot } from './project';
import { openPublishSheet } from './publishView';
import { button, el, openSheet } from './ui';

const SESSION_KEY = 'pear.studio.session';
const GAME_KEY = 'pear.studio.game';
const PUBLISHED_KEY = 'pear.studio.lastPublished';
type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>;
const browserStorage = (): KeyValueStore | null => (typeof localStorage === 'undefined' ? null : localStorage);

/** The Vultr box set up by Deploy/vultr-bootstrap.sh. The publish sheet offers it when the server URL setting is still the default. */
export { VULTR_SERVER_URL } from './preferences';

/** Epoch ms of the last verified publish of this game, persisted per game in localStorage; null when never. */
export function readLastPublished(gameId: string | null | undefined, storage: KeyValueStore | null = browserStorage()): number | null {
  if (!gameId) return null;
  try {
    const at = (JSON.parse(storage?.getItem(PUBLISHED_KEY) ?? '{}') as Record<string, { at?: unknown }>)[gameId]?.at;
    return typeof at === 'number' ? at : null;
  } catch {
    return null;
  }
}

export type PublishStepId = 'signIn' | 'server' | 'upload' | 'verify';
export const PUBLISH_STEPS: { id: PublishStepId; label: string }[] = [
  { id: 'signIn', label: 'Sign in' },
  { id: 'server', label: 'Check the server' },
  { id: 'upload', label: 'Upload the version' },
  { id: 'verify', label: 'Verify the published version' },
];
export type PublishStepState = 'running' | 'done' | 'error';

/** What the server confirmed after the verify step. */
export interface PublishConfirmation { gameId: string; version: number; runMode: string; serverUrl: string; publishedAt: number }
/** What the publish sheet adds to the project's version: the ui.json asset and `metadata.manifest`, which `Project.toVersion` does not carry. */
export interface PublishExtra { assets?: Record<string, unknown>; metadata?: { manifest?: GameManifest; media?: unknown } }
export type PublishOutcome = { ok: true; confirmation: PublishConfirmation } | { ok: false; step: PublishStepId; reason: string };

/** JSON with object keys sorted, so a server that reorders keys (Postgres jsonb) still compares equal. */
const canonical = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));

/** One sentence naming what happened and the fix, for any failure of a cloud call. */
export function describeError(e: unknown, serverUrl: string): string {
  if (!(e instanceof ApiError)) return e instanceof Error ? e.message : String(e);
  const where = serverUrl || 'this page\'s origin';
  switch (e.kind) {
    case 'network': return `Cannot reach ${where}. Start the backend (Deploy/dev.sh) or correct the server URL in Settings.`;
    case 'unauthorized': return 'Your session ended or the name was rejected. Sign in again (the server needs PEAR_DEV_SIGNIN=1 for dev sign-in).';
    case 'forbidden': return 'This account does not own that game. Pick one of your games or create a new one.';
    case 'notFound': return 'The server has no such game or version. Refresh the game list and pick another.';
    case 'badRequest': return 'The server rejected the request (400). Check the display name and that the scene and scripts are valid.';
    case 'unavailable': return 'The server has no database configured (503). Start it with DATABASE_URL set or use the in-memory store.';
    default: return `The server failed (${e.status}). Try again in a moment.`;
  }
}

export class AccountController {
  client: CloudClient;
  account: Account | null = null;
  games: Game[] = [];
  gameId: string | null = null;
  lastPublished: { gameId: string; version: number } | null = null;
  private publishedJson: string | null = null;
  private listeners = new Set<() => void>();
  private url: string;
  private fetchFn?: typeof fetch;

  constructor(private prefs: PreferenceStore, private persist = true, private storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null = typeof localStorage === 'undefined' ? null : localStorage, fetchFn?: typeof fetch) {
    this.fetchFn = fetchFn;
    let saved: { token?: string; account?: Account } = {};
    try {
      if (persist) saved = JSON.parse(storage?.getItem(SESSION_KEY) ?? '{}');
    } catch {
      saved = {};
    }
    this.url = prefs.get().serverUrl;
    this.client = this.makeClient(saved.token);
    this.account = saved.token && saved.account ? saved.account : null;
    this.gameId = persist && this.account ? (storage?.getItem(GAME_KEY) ?? null) : null;
    prefs.onChange((p) => {
      if (this.url !== p.serverUrl) {
        this.url = p.serverUrl;
        // A session belongs to its server; never forward it to a newly configured backend.
        this.account = null;
        this.forget();
        this.client = this.makeClient();
        this.emit();
      }
    });
  }

  private makeClient(token?: string): CloudClient {
    return new CloudClient({
      baseUrl: this.url,
      ...(token ? { token } : {}),
      ...(this.fetchFn ? { fetch: this.fetchFn } : {}),
      onUnauthorized: () => {
        this.account = null;
        this.forget();
        this.emit();
      },
    });
  }

  get serverUrl(): string {
    return this.prefs.get().serverUrl;
  }

  get game(): Game | undefined {
    return this.games.find((g) => g.id === this.gameId);
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  private forget(): void {
    this.games = [];
    this.gameId = null;
    this.lastPublished = null;
    this.publishedJson = null;
    if (this.persist) {
      this.storage?.removeItem(SESSION_KEY);
      this.storage?.removeItem(GAME_KEY);
    }
  }

  async signIn(name: string): Promise<void> {
    if (!name) throw new Error('Enter a name to sign in.');
    const res = await this.client.signIn({ provider: 'dev', subject: name, display_name: name });
    this.account = res.account;
    if (this.persist) this.storage?.setItem(SESSION_KEY, JSON.stringify({ token: res.token, account: res.account }));
    this.emit();
    await this.refreshGames();
  }

  get isDeveloper(): boolean {
    return this.account?.role === 'developer';
  }

  async signInDeveloper(username: string, password: string): Promise<void> {
    if (!username || !password) throw new Error('Enter a username and password.');
    const res = await this.client.signIn({ provider: 'developer', subject: username, password });
    this.account = res.account;
    if (this.persist) this.storage?.setItem(SESSION_KEY, JSON.stringify({ token: res.token, account: res.account }));
    this.emit();
    await this.refreshGames();
  }

  /** Creates a password account (POST /api/accounts/signup) and signs in with it. */
  async signUp(username: string, displayName: string, password: string): Promise<void> {
    const res = await this.client.signUp({ username, password, display_name: displayName || username });
    this.account = res.account;
    if (this.persist) this.storage?.setItem(SESSION_KEY, JSON.stringify({ token: res.token, account: res.account }));
    this.emit();
    await this.refreshGames();
  }

  async signOut(): Promise<void> {
    try {
      await this.client.signOut();
    } finally {
      this.account = null;
      this.games = [];
      this.forget();
      this.emit();
    }
  }

  async refreshGames(): Promise<void> {
    // A developer sees (and may publish to) every game, so the selected game survives being someone else's.
    this.games = this.isDeveloper ? await this.client.listAllGames() : await this.client.listGames();
    if (this.gameId && !this.games.some((g) => g.id === this.gameId)) this.select(null);
    this.emit();
  }

  select(gameId: string | null): void {
    this.gameId = gameId;
    if (this.persist) gameId ? this.storage?.setItem(GAME_KEY, gameId) : this.storage?.removeItem(GAME_KEY);
    this.emit();
  }

  /** Deletes a cloud game. The list drops it, and when it was the selected game the selection clears. */
  async deleteGame(gameId: string): Promise<void> {
    await this.client.deleteGame(gameId);
    this.games = this.games.filter((g) => g.id !== gameId);
    if (this.gameId === gameId) this.select(null);
    else this.emit();
  }

  async createGame(title: string): Promise<void> {
    if (!title) throw new Error('Enter a title for the new game.');
    const game = await this.client.createGame(title);
    this.games = [game, ...this.games];
    this.select(game.id);
  }

  /** Publishes the project as a new version of the selected game and records the version on the project. */
  async publish(project: Project, extra: PublishExtra = {}): Promise<GameVersion> {
    if (!this.gameId) throw new Error('Pick or create a game first.');
    const base = project.toVersion();
    const body = { ...base, assets: { ...base.assets, ...extra.assets }, metadata: { ...base.metadata, ...extra.metadata } };
    const version = await this.client.publish(this.gameId, body);
    project.setCloud(this.gameId, version.version);
    project.markSaved();
    this.lastPublished = { gameId: this.gameId, version: version.version };
    this.publishedJson = JSON.stringify(body);
    this.emit();
    return version;
  }

  /** Version to join: the current one when nothing publishable changed since the last publish, else a new publish. */
  async publishIfChanged(project: Project): Promise<{ version: number; published: boolean }> {
    const last = this.lastPublished;
    if (last && last.gameId === this.gameId && project.gameId === this.gameId && project.version === last.version && this.publishedJson === JSON.stringify(project.toVersion())) {
      return { version: last.version, published: false };
    }
    return { version: (await this.publish(project)).version, published: true };
  }

  /**
   * Publish, then prove it: re-fetch the version the server stored and compare its number and scene with what was sent.
   * Never throws; the failing step and a plain-language reason come back in the outcome.
   */
  async publishVerified(project: Project, onStep: (step: PublishStepId, state: PublishStepState) => void = () => {}, extra: PublishExtra = {}): Promise<PublishOutcome> {
    let step: PublishStepId = 'signIn';
    const run = async <T>(id: PublishStepId, work: () => Promise<T>): Promise<T> => {
      step = id;
      onStep(id, 'running');
      const result = await work();
      onStep(id, 'done');
      return result;
    };
    try {
      await run('signIn', async () => {
        if (!this.account) throw new Error('You are not signed in. Close this and sign in from Account and publishing.');
      });
      await run('server', async () => {
        await this.client.me();
        await this.refreshGames();
        if (!this.gameId) throw new Error('Pick or create a game first.');
      });
      const gameId = this.gameId!;
      const sentScene = project.toVersion().scene;
      const published = await run('upload', () => this.publish(project, extra));
      const stored = await run('verify', async () => {
        const v = await this.client.fetchVersion(gameId, published.version);
        if (v.version !== published.version) throw new Error(`Verification failed: the server returned version ${v.version}, not ${published.version}.`);
        if (canonical(v.scene) !== canonical(sentScene)) throw new Error(`Verification failed: version ${v.version} on the server has a different scene than the one sent.`);
        return v;
      });
      const publishedAt = Date.now();
      this.recordPublished(gameId, publishedAt, stored.version);
      return { ok: true, confirmation: { gameId, version: stored.version, runMode: stored.run_mode, serverUrl: this.serverUrl, publishedAt } };
    } catch (e) {
      if (e instanceof ApiError && e.kind === 'unauthorized') step = 'signIn'; // a rejected session is a sign-in problem, wherever it surfaced
      onStep(step, 'error');
      return { ok: false, step, reason: describeError(e, this.serverUrl) };
    }
  }

  private recordPublished(gameId: string, at: number, version: number): void {
    if (!this.persist || !this.storage) return;
    let all: Record<string, unknown> = {};
    try {
      all = JSON.parse(this.storage.getItem(PUBLISHED_KEY) ?? '{}');
    } catch {
      all = {};
    }
    this.storage.setItem(PUBLISHED_KEY, JSON.stringify({ ...all, [gameId]: { at, version } }));
    this.emit();
  }

  async openLatest(gameId: string): Promise<ProjectSnapshot> {
    return Project.snapshotOfVersion(await this.client.fetchVersion(gameId, 'latest'));
  }
}

export function createHostedGameOpener(account: AccountController, hooks: {
  confirm(): Promise<boolean>;
  load(snapshot: ProjectSnapshot): void;
  opened(): void;
}): { open(gameId: string): Promise<boolean>; cancel(): void } {
  let request = 0;
  return {
    cancel: () => { request++; },
    async open(gameId) {
      const ticket = ++request;
      const client = account.client;
      const owner = account.account;
      const token = client.token;
      const current = () => ticket === request && client === account.client && owner === account.account && token === client.token;
      if (!(await hooks.confirm()) || !current()) return false;
      account.select(null);
      try {
        const version = await client.fetchVersion(gameId, 'latest');
        if (!current()) return false;
        if (version.game_id !== gameId) throw new Error('The server returned a different game. Refresh the game list and try again.');
        hooks.load(Project.snapshotOfVersion(version));
        account.select(gameId);
        hooks.opened();
        return true;
      } catch (error) {
        if (!current()) return false;
        throw error;
      }
    },
  };
}

/** Small "Developer" pill for the account UI. */
export const developerBadge = (): HTMLElement => el('span', { class: 'scr-tag', title: 'Developer account' }, ['Developer']);

export interface AccountSheetHooks {
  project: Project;
  /** Replace the open project; the caller confirms unsaved changes. */
  openSnapshot(snapshot: ProjectSnapshot): void;
  openHostedGame?(gameId: string): Promise<boolean>;
}

export function openAccountSheet(account: AccountController, prefs: PreferenceStore, hooks: AccountSheetHooks): void {
  openSheet('Account and publishing', (body, close) => {
    const status = el('p', { class: 'sheet-note', role: 'status' });
    const error = el('p', { class: 'sheet-error', role: 'alert' });
    const guarded = (work: () => Promise<void>, done?: string) => async () => {
      error.textContent = '';
      status.textContent = '';
      try {
        await work();
        if (done) status.textContent = done;
      } catch (e) {
        error.textContent = describeError(e, account.serverUrl);
      }
      render();
    };

    // Only `content` is rebuilt; the status and alert nodes stay in the DOM so their messages are announced.
    const content = el('div');
    const render = () => {
      const labelOf = (n: Element | null) => n?.getAttribute('aria-label') || n?.textContent || '';
      const had = content.contains(document.activeElement) ? labelOf(document.activeElement) : null;
      const url = el('input', { type: 'text', value: account.serverUrl, placeholder: 'Same origin as this page', 'aria-label': 'Server URL', spellcheck: 'false' });
      url.addEventListener('change', () => prefs.set({ serverUrl: url.value }));
      const rows: Node[] = [el('div', { class: 'om-prop' }, [el('label', {}, ['Server URL']), el('div', { class: 'om-field' }, [url])])];

      if (!account.account) {
        const name = el('input', { type: 'text', 'aria-label': 'Name', placeholder: 'Your name', spellcheck: 'false' });
        const signIn = guarded(() => account.signIn(name.value.trim()), 'Signed in.');
        name.addEventListener('keydown', (e) => e.key === 'Enter' && void signIn());
        rows.push(
          el('div', { class: 'om-prop' }, [el('label', {}, ['Name']), el('div', { class: 'om-field' }, [name])]),
          el('p', { class: 'sheet-note' }, ['Dev sign-in uses provider dev with your name as the subject. The server must run with PEAR_DEV_SIGNIN=1.']),
          el('div', { class: 'sheet-actions' }, [button('Close', close), button('Sign in', () => void signIn(), { variant: 'default' })]),
        );
      } else {
        const picker = el('select', { 'aria-label': 'Game', class: 'om-select' }, [
          el('option', { value: '' }, [account.games.length ? 'Choose a game' : 'No games yet']),
          ...account.games.map((g) => el('option', { value: g.id, selected: g.id === account.gameId }, [g.title])),
        ]);
        picker.addEventListener('change', () => account.select(picker.value || null));
        const title = el('input', { type: 'text', 'aria-label': 'New game title', placeholder: 'Game title' });
        const gameId = account.gameId;
        rows.push(
          el('div', { class: 'om-prop' }, [el('span', {}, ['Signed in as']), el('span', {}, [account.account.display_name || account.account.subject, ...(account.isDeveloper ? [' ', developerBadge()] : [])])]),
          el('div', { class: 'om-prop' }, [el('label', {}, ['Game']), picker]),
          el('div', { class: 'om-prop' }, [el('label', {}, ['New game']), el('div', { class: 'om-field' }, [title])]),
          el('div', { class: 'sheet-actions' }, [
            button('Create game', guarded(() => account.createGame(title.value.trim()), 'Game created.')),
            button('Open latest version', guarded(async () => {
              if (!gameId) throw new Error('Choose a game first.');
              if (hooks.openHostedGame) {
                if (await hooks.openHostedGame(gameId)) close();
              } else hooks.openSnapshot(await account.openLatest(gameId));
            }, 'Opened the latest version.')),
          ]),
          el('p', { class: 'om-num' }, [hooks.project.version && hooks.project.gameId === gameId ? `This project is at version ${hooks.project.version}.` : 'Not published yet.']),
          el('div', { class: 'sheet-actions' }, [
            button('Sign out', guarded(() => account.signOut())),
            button('Close', close),
            button('Publish to Vultr', () => openPublishSheet(account, prefs, hooks.project), { variant: 'default' }),
          ]),
        );
      }
      content.replaceChildren(...rows);
      if (had !== null) {
        const controls = [...content.querySelectorAll<HTMLElement>('input, select, button')];
        (controls.find((c) => labelOf(c) === had) ?? content.querySelector<HTMLElement>('select, input:not([aria-label="Server URL"])') ?? controls[0])?.focus();
      }
    };
    body.append(content, status, error);
    render();
  });
}
