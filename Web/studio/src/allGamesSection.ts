// "All hosted games" section of the Projects screen, shown to developer accounts: every game on the server with its owner and cover, and Open for the latest version.
import { developerBadge, type AccountController } from './account';
import type { ProjectSnapshot } from './project';
import { button, el } from './ui';

/** Null for non-developers. Open selects the game on the account so Publish then targets that same game id. */
export function allGamesSection(account: AccountController, open: (snapshot: ProjectSnapshot) => void, run: (work: () => Promise<void>) => () => void, openHostedGame?: (gameId: string) => Promise<boolean>): HTMLElement | null {
  if (!account.isDeveloper) return null;
  const list = el('ul', { class: 'scr-grid', role: 'list', 'aria-label': 'All hosted games' });
  const count = el('span', { class: 'om-secondary' });
  const section = el('section', { class: 'scr-section' }, [el('h2', {}, ['All hosted games ', developerBadge(), count]), list]);
  let off = () => {};
  const render = () => {
    if (!section.isConnected && list.childElementCount) return off(); // the screen was replaced
    count.textContent = String(account.games.length);
    list.replaceChildren(...(account.games.length ? account.games.map((g) => {
      const cover = el('div', { class: 'scr-thumb' }, [g.has_cover
        ? el('img', { src: account.client.coverUrl(g.id, g.updated_at), alt: '', 'aria-hidden': 'true' })
        : el('span', { class: 'scr-thumb-none' }, ['No cover'])]);
      const go = run(async () => {
        if (openHostedGame) await openHostedGame(g.id);
        else { const snapshot = await account.openLatest(g.id); account.select(g.id); open(snapshot); }
      });
      return el('li', { class: 'scr-tile' }, [cover, el('div', { class: 'scr-info' }, [
        el('span', { class: 'scr-name', title: g.title }, [g.title]),
        el('span', { class: 'scr-meta' }, [`Owner: ${g.owner_name || g.owner_id}`]),
        el('div', { class: 'scr-actions' }, [button('Open', go, { ariaLabel: `Open ${g.title}` })]),
      ])]);
    }) : [el('li', { class: 'om-sub scr-empty' }, ['No hosted games.'])]));
  };
  off = account.onChange(render);
  render();
  return section;
}
