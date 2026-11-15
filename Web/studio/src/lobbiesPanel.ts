// Lobbies panel: every live lobby on the server grouped by game, with its players (kick) and version, and a hand-off into Live Preview.
// Developer accounts only (the server answers 403 to players). Menu: View > Lobbies.
import { ApiError, type Instance } from '@pear/cloud';
import type { AccountController } from './account';
import type { PanelSpec, PanelView } from './layout';
import { openInLivePreview } from './livePreview/panel';
import { button, el } from './ui';
import './lobbiesPanel.css';

export interface GameLobbies { gameId: string; title: string; lobbies: Instance[] }

/** Lobbies grouped per game (titled games A-Z, untitled last by id), each group's lobbies by code. */
export function groupByGame(instances: Instance[]): GameLobbies[] {
  const groups = new Map<string, GameLobbies>();
  for (const i of instances) {
    const g = groups.get(i.game_id) ?? { gameId: i.game_id, title: i.title ?? i.game_id, lobbies: [] };
    g.lobbies.push(i);
    groups.set(i.game_id, g);
  }
  const rank = (g: GameLobbies) => (g.title === g.gameId ? 1 : 0);
  return [...groups.values()]
    .map((g) => ({ ...g, lobbies: [...g.lobbies].sort((a, b) => a.lobby.localeCompare(b.lobby)) }))
    .sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title) || a.gameId.localeCompare(b.gameId));
}

export const versionLabel = (version: number | null | undefined): string => (version == null ? 'unversioned' : `v${version}`);

/** Whether a lobby has reached the game's newest published version: '' when either side is unknown. */
export function reachLabel(lobbyVersion: number | null | undefined, latest: number | undefined): string {
  if (lobbyVersion == null || latest === undefined) return '';
  return lobbyVersion >= latest ? 'on latest' : `behind (latest v${latest})`;
}

export const playersLabel = (n: number): string => `${n} ${n === 1 ? 'player' : 'players'}`;

/** "just now", "5 min ago", "2 h ago", "3 d ago"; '' when the timestamp does not parse. */
export function ageLabel(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/** The empty/error line for a failed list request. */
export function listError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.kind === 'unauthorized') return 'Sign in (File > Account and publishing) to see live lobbies.';
    if (e.kind === 'forbidden') return 'Only developer accounts can see live lobbies.';
    if (e.kind === 'network') return 'Cannot reach the server.';
  }
  return `Could not load lobbies: ${e instanceof Error ? e.message : String(e)}`;
}

const REFRESH_MS = 5000;

export const lobbiesPanel = (account: AccountController, show: (id: string) => void): PanelSpec =>
  ({ id: 'lobbies', title: 'Lobbies', create: () => createLobbiesPanel(account, show) });

export function createLobbiesPanel(account: AccountController, show: (id: string) => void): PanelView {
  const root = el('div', { class: 'lb-root' });
  const status = el('span', { class: 'lb-status', role: 'status' });
  const refreshBtn = button('Refresh', () => void load(), { variant: 'small' });
  const list = el('div', { class: 'lb-list' });
  root.append(el('div', { class: 'lb-toolbar' }, [refreshBtn, status]), list);

  let latest = new Map<string, number>();
  let disposed = false;
  let loading = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const message = (text: string) => list.replaceChildren(el('p', { class: 'lb-empty' }, [text]));

  async function kick(i: Instance, id: string, name: string): Promise<void> {
    try {
      await account.client.kickPlayer(i.game_id, i.lobby, id);
    } catch (e) {
      // 404 means the player already left; anything else is worth showing.
      if (!(e instanceof ApiError && e.kind === 'notFound')) status.textContent = `Kick ${name} failed: ${e instanceof Error ? e.message : String(e)}`;
    }
    void load();
  }

  function lobbyEl(i: Instance): HTMLElement {
    const players = i.players.length
      ? el('ul', { class: 'lb-players' }, i.players.map((p) => el('li', {}, [
        el('span', { class: 'lb-player' }, [p.name || p.id]),
        button('Kick', () => void kick(i, p.id, p.name || p.id), { variant: 'small', danger: true, ariaLabel: `Kick ${p.name || p.id} from ${i.lobby}` }),
      ])))
      : el('p', { class: 'lb-none' }, ['No players connected.']);
    return el('section', { class: 'lb-lobby' }, [
      el('header', {}, [
        el('strong', { class: 'lb-code' }, [i.lobby]),
        el('span', { class: 'lb-meta' }, [`${[versionLabel(i.version), reachLabel(i.version, latest.get(i.game_id))].filter(Boolean).join(' ')} · ${playersLabel(i.players.length)} · active ${ageLabel(i.last_activity_at, Date.now())}`]),
        button('Open in Live Preview', () => {
          openInLivePreview(account, i.game_id, i.lobby);
          show('livePreview');
        }, { variant: 'small', ariaLabel: `Open lobby ${i.lobby} in Live Preview` }),
      ]),
      players,
    ]);
  }

  function render(instances: Instance[]): void {
    const groups = groupByGame(instances);
    if (!groups.length) return message('No live lobbies right now.');
    list.replaceChildren(...groups.map((g) => el('section', { class: 'lb-game' }, [el('h3', {}, [g.title]), ...g.lobbies.map(lobbyEl)])));
  }

  async function load(): Promise<void> {
    if (loading || disposed) return;
    if (!account.account) return message(listError(new ApiError('unauthorized', 401, '')));
    loading = true;
    try {
      const instances = await account.client.listInstances();
      const ids = [...new Set(instances.map((i) => i.game_id))];
      const got = await Promise.allSettled(ids.map((id) => account.client.fetchVersion(id)));
      if (disposed) return;
      // A game whose latest version cannot be fetched just shows no reach label.
      latest = new Map(got.flatMap((r, n) => (r.status === 'fulfilled' ? [[ids[n]!, r.value.version] as const] : [])));
      render(instances);
      status.textContent = `${instances.length} live ${instances.length === 1 ? 'lobby' : 'lobbies'} · updated ${new Date().toLocaleTimeString()}`;
    } catch (e) {
      if (!disposed) {
        message(listError(e));
        status.textContent = '';
      }
    } finally {
      loading = false;
    }
  }

  const unsub = account.onChange(() => void load());
  timer = setInterval(() => void load(), REFRESH_MS);
  void load();

  return {
    element: root,
    focus: () => refreshBtn.focus(),
    dispose() {
      disposed = true;
      unsub();
      if (timer) clearInterval(timer);
    },
  };
}
