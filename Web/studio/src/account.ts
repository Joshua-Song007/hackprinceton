// Account: dev sign-in (provider "dev", subject = name), server URL, game picker, Publish with the version shown.
// Only game content goes to the server (Network Rule); the token is kept in localStorage, or in memory for test-player tabs.
import { ApiError, CloudClient, type Account, type Game, type GameVersion } from '@pear/cloud';
import type { PreferenceStore } from './preferences';
import { Project, type ProjectSnapshot } from './project';
import { button, el, openSheet } from './ui';

const SESSION_KEY = 'pear.studio.session';
const GAME_KEY = 'pear.studio.game';

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

  constructor(private prefs: PreferenceStore, private persist = true, private storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null = typeof localStorage === 'undefined' ? null : localStorage) {
    let saved: { token?: string; account?: Account } = {};
    try {
      if (persist) saved = JSON.parse(storage?.getItem(SESSION_KEY) ?? '{}');
    } catch {
      saved = {};
    }
    this.url = prefs.get().serverUrl;
    this.client = this.makeClient(saved.token);
    this.account = saved.token && saved.account ? saved.account : null;
    this.gameId = persist ? (storage?.getItem(GAME_KEY) ?? null) : null;
    prefs.onChange((p) => {
      if (this.url !== p.serverUrl) {
        this.url = p.serverUrl;
        this.client = this.makeClient(this.client.token ?? undefined);
        this.emit();
      }
    });
  }

  private makeClient(token?: string): CloudClient {
    return new CloudClient({
      baseUrl: this.url,
      ...(token ? { token } : {}),
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
    if (this.persist) this.storage?.removeItem(SESSION_KEY);
  }

  async signIn(name: string): Promise<void> {
    if (!name) throw new Error('Enter a name to sign in.');
    const res = await this.client.signIn({ provider: 'dev', subject: name, display_name: name });
    this.account = res.account;
    if (this.persist) this.storage?.setItem(SESSION_KEY, JSON.stringify({ token: res.token, account: res.account }));
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
    this.games = await this.client.listGames();
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
  async publish(project: Project): Promise<GameVersion> {
    if (!this.gameId) throw new Error('Pick or create a game first.');
    const body = project.toVersion();
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

  async openLatest(gameId: string): Promise<ProjectSnapshot> {
    return Project.snapshotOfVersion(await this.client.fetchVersion(gameId, 'latest'));
  }
}

export interface AccountSheetHooks {
  project: Project;
  /** Replace the open project; the caller confirms unsaved changes. */
  openSnapshot(snapshot: ProjectSnapshot): void;
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
          el('div', { class: 'om-prop' }, [el('span', {}, ['Signed in as']), el('span', {}, [account.account.display_name || account.account.subject])]),
          el('div', { class: 'om-prop' }, [el('label', {}, ['Game']), picker]),
          el('div', { class: 'om-prop' }, [el('label', {}, ['New game']), el('div', { class: 'om-field' }, [title])]),
          el('div', { class: 'sheet-actions' }, [
            button('Create game', guarded(() => account.createGame(title.value.trim()), 'Game created.')),
            button('Open latest version', guarded(async () => {
              if (!gameId) throw new Error('Choose a game first.');
              hooks.openSnapshot(await account.openLatest(gameId));
            }, 'Opened the latest version.')),
          ]),
          el('p', { class: 'om-num' }, [hooks.project.version && hooks.project.gameId === gameId ? `This project is at version ${hooks.project.version}.` : 'Not published yet.']),
          el('div', { class: 'sheet-actions' }, [
            button('Sign out', guarded(() => account.signOut())),
            button('Close', close),
            button('Publish', guarded(async () => {
              const v = await account.publish(hooks.project);
              status.textContent = `Published version ${v.version}.`;
            }), { variant: 'default' }),
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
