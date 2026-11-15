// Projects screen: a sticky top bar (search, sort, New project), a profile and statistics column, and Solo and Shared sections of tiles (preview, name, last opened, last edited, Open) for cloud games, projects saved on this computer and the autosaved draft; New project starts from a template.
import { announce, button, el, openSheet } from './ui';
import { describeError, type AccountController } from './account';
import { TEMPLATES, deleteDraft, loadDraft, loadDraftAt, type ProjectSnapshot, type TemplateId } from './project';
import { SORT_KEYS, SORT_LABELS, dropThumb, filterProjects, forgetOpened, forgetRecent, formatWhen, loadOpened, loadRecent, loadSort, loadThumbs, markOpened, mergeProjects, projectStats, rowAction, saveSort, saveThumb, sortProjects, thumbHit, type ProjectRow, type RecentEntry, type SortKey, type Thumb } from './recent';
import { openProjectFile, type SavedFile } from './projectFile';
import { allGamesSection } from './allGamesSection';
import { renderThumbnail, thumbStamp, ThumbnailQueue } from './thumbnail';

export interface ProjectsHooks {
  account: AccountController;
  open(snapshot: ProjectSnapshot, file?: SavedFile): void;
  openHostedGame?(gameId: string): Promise<boolean>;
  /** Starts the New game form (the instructions come first), optionally with a template chosen. */
  newGame(template?: TemplateId): void;
  signOut(): void;
  /** Set when an editor session already exists, so the screen can offer a way back. */
  back?: (() => void) | undefined;
  /** A cloud game was deleted from this screen; the editor unlinks it if it was open. */
  deleted?(gameId: string): void;
}

export function renderProjectsScreen(root: HTMLElement, h: ProjectsHooks): void {
  const { account } = h;
  const error = el('p', { class: 'sheet-error', role: 'alert' });
  const fail = (e: unknown) => {
    error.textContent = describeError(e, account.serverUrl);
    announce(error.textContent);
  };
  const run = (work: () => Promise<void>) => () => {
    error.textContent = '';
    void work().catch(fail);
  };

  const soloList = el('ul', { class: 'scr-grid', role: 'list', 'aria-label': 'Solo projects' });
  const sharedList = el('ul', { class: 'scr-grid', role: 'list', 'aria-label': 'Shared projects' });
  const soloCount = el('span', { class: 'om-secondary' });
  const sharedCount = el('span', { class: 'om-secondary' });
  const stats = el('div', { class: 'scr-stats' });
  let draft: ProjectSnapshot | undefined;
  let draftAt: number | undefined;
  let recents: RecentEntry[] = [];
  let opened: Record<string, number> = {};
  let thumbs: Record<string, Thumb> = {};
  let query = '';
  let sort: SortKey = loadSort();
  let shownCount = 0;
  // Previews start only after the cached ones are loaded, one render at a time, for tiles that scroll into view.
  let ready = false;
  const queue = new ThumbnailQueue();
  let watcher: IntersectionObserver | undefined;
  const render = () => {
    queue.cancel();
    watcher?.disconnect();
    const starts = new Map<Element, () => void>();
    const seen = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver((hits) => {
      for (const hit of hits) if (hit.isIntersecting) { seen?.unobserve(hit.target); starts.get(hit.target)?.(); }
    });
    watcher = seen;

    // The sheet is modal and would hide the page's error line, so it closes first and the work reports on the page.
    const confirm = (title: string, text: string, label: string, work: () => Promise<void>) =>
      openSheet(title, (body, close) => {
        body.append(
          el('p', {}, [text]),
          el('div', { class: 'sheet-actions' }, [
            button('Cancel', close, { variant: 'default' }),
            button(label, () => { close(); run(work)(); }, { danger: true }),
          ]),
        );
      });
    const deleteGame = (p: ProjectRow) => confirm(`Delete ${p.title}?`, 'Deletes this game and every published version from the cloud and disconnects anyone playing it. This cannot be undone.', 'Delete game', async () => {
      await account.deleteGame(p.key);
      await dropThumb(`cloud:${p.key}`);
      await forgetOpened('cloud', p.key);
      delete thumbs[`cloud:${p.key}`];
      h.deleted?.(p.key);
      announce(`Deleted ${p.title}.`);
      render();
    });
    const discardDraft = () => confirm('Discard the draft?', 'Removes the autosaved draft. The editor keeps its current project and saves a new draft when you change it.', 'Discard draft', async () => {
      await deleteDraft();
      await dropThumb('draft:draft');
      await forgetOpened('draft', 'draft');
      delete thumbs['draft:draft'];
      draft = undefined;
      draftAt = undefined;
      announce('Discarded the draft.');
      render();
    });
    const tile = (p: ProjectRow) => {
      const id = `${p.kind}:${p.key}`;
      const stamp = thumbStamp(p.stamp);
      const where = p.kind === 'cloud' ? 'Cloud' : p.kind === 'draft' ? 'Draft' : 'This computer';
      const open = p.kind === 'cloud'
        ? run(async () => {
          if (h.openHostedGame) await h.openHostedGame(p.key);
          else { const snapshot = await account.openLatest(p.key); void markOpened('cloud', p.key); h.open(snapshot); }
        })
        : () => { void markOpened(p.kind, p.key); h.open(p.kind === 'draft' ? draft! : p.recent!.snapshot); };

      const thumb = el('div', { class: 'scr-thumb' }, [el('span', { class: 'scr-thumb-none' }, ['No preview'])]);
      const show = (url: string) => thumb.replaceChildren(el('img', { src: url, alt: '', 'aria-hidden': 'true' }));
      const cached = thumbHit(thumbs, id, stamp);
      if (cached) show(cached);
      const scene = async () => (p.kind === 'cloud' ? (await account.openLatest(p.key)).scene : p.kind === 'draft' ? draft!.scene : p.recent!.snapshot.scene);
      const start = () => queue.add(async () => {
        const url = renderThumbnail(await scene(), root);
        if (url) await saveThumb(id, stamp, url);
        return url;
      }, (url) => { if (url) { thumbs[id] = { stamp, url }; show(url); } });

      const when = (ms: number | undefined, label: 'Opened' | 'Edited') => el('span', { class: ms === undefined ? 'scr-meta scr-dim' : 'scr-meta', title: formatWhen(ms, label) }, [formatWhen(ms, label, undefined, undefined, Date.now())]);
      // Opened right when it was edited says nothing new, so that line is left out.
      const openedAdds = p.opened === undefined || p.time === undefined || Math.abs(p.opened - p.time) >= 60_000;
      const info = el('div', { class: 'scr-info' }, [
        el('span', { class: 'scr-name', title: p.title }, [p.title]),
        el('span', { class: 'scr-tag' }, [where]),
        ...(openedAdds ? [when(p.opened, 'Opened')] : []),
        when(p.time, 'Edited'),
        el('div', { class: 'scr-actions' }, [
          button('Open', open, { ariaLabel: `Open ${p.title}` }),
          ...(rowAction(p) === 'delete' ? [button('Delete', () => deleteGame(p), { variant: 'borderless', danger: true, ariaLabel: `Delete ${p.title} from the cloud` })] : []),
          ...(rowAction(p) === 'discard' ? [button('Discard draft', discardDraft, { variant: 'borderless', danger: true, ariaLabel: 'Discard the autosaved draft' })] : []),
          ...(rowAction(p) === 'remove' ? [button('Remove', async () => { await forgetRecent(p.key); await dropThumb(id); await forgetOpened('local', p.key); recents = recents.filter((r) => r.id !== p.key); render(); }, { variant: 'borderless', ariaLabel: `Remove ${p.title} from recent` })] : []),
        ]),
      ]);
      const li = el('li', { class: 'scr-tile' }, [thumb, info]);
      li.addEventListener('click', (e) => { if (!(e.target as HTMLElement).closest('button')) open(); });
      if (!cached && ready) {
        if (seen) { starts.set(li, start); seen.observe(li); } else start();
      }
      return li;
    };
    const empty = (name: 'solo' | 'shared') => {
      const q = query.trim();
      return el('li', { class: 'om-sub scr-empty' }, [q ? `No ${name} projects match “${q}”.` : name === 'solo' ? 'No solo projects yet. Create one with New project.' : 'Nothing shared with you yet.']);
    };
    const fill = (list: HTMLElement, count: HTMLElement, rows: ProjectRow[], name: 'solo' | 'shared') => {
      count.textContent = String(rows.length);
      list.replaceChildren(...(rows.length ? rows.map(tile) : [empty(name)]));
    };

    const all = mergeProjects(account.games, recents, !!draft, opened, draftAt, account.account?.id, typeof draft?.scene.name === 'string' ? draft.scene.name : undefined);
    const shown = sortProjects(filterProjects(all, query), sort);
    shownCount = shown.length;
    fill(soloList, soloCount, shown.filter((r) => r.scope === 'solo'), 'solo');
    fill(sharedList, sharedCount, shown.filter((r) => r.scope === 'shared'), 'shared');
    const s = projectStats(all);
    stats.replaceChildren(
      el('span', { class: 'scr-stats-total om-num' }, [`${s.total} ${s.total === 1 ? 'project' : 'projects'}`]),
      el('span', { class: 'scr-meta scr-dim om-num' }, [`${s.cloud} in the cloud · ${s.local} on this computer`]),
    );
  };
  render();
  account.refreshGames().then(render, fail);
  void Promise.all([
    loadDraft().catch(() => undefined),
    loadRecent().catch(() => [] as RecentEntry[]),
    loadDraftAt().catch(() => undefined),
    loadOpened().catch(() => ({}) as Record<string, number>),
    loadThumbs().catch(() => ({}) as Record<string, Thumb>),
  ]).then(([d, r, at, o, t]) => { draft = d; recents = r; draftAt = at; opened = o; thumbs = t; ready = true; render(); });

  const newProject = () => openSheet('New project', (body, close) => {
    for (const t of TEMPLATES) {
      body.append(el('div', { style: 'padding:6px 0' }, [
        el('strong', {}, [t.label]), el('p', { class: 'om-sub', style: 'margin:2px 0 4px' }, [t.blurb]),
        button(`New game from ${t.label}`, () => { close(); h.newGame(t.id); }, { variant: 'small' }),
      ]));
    }
    const title = el('input', { type: 'text', 'aria-label': 'Cloud game title', placeholder: 'Optional title' });
    const create = run(async () => { await account.createGame(title.value.trim()); close(); render(); });
    title.addEventListener('keydown', (e) => e.key === 'Enter' && create());
    body.append(
      el('div', { class: 'om-prop' }, [el('label', {}, ['Or an empty cloud game']), el('div', { class: 'om-field' }, [title])]),
      el('div', { class: 'sheet-actions' }, [button('Create cloud game', create), button('Cancel', close)]),
    );
  });

  // Typing waits a moment before redrawing, so each key does not restart the preview queue; the result count is announced once it settles.
  let renderTimer: ReturnType<typeof setTimeout> | undefined;
  let noteTimer: ReturnType<typeof setTimeout> | undefined;
  const note = () => {
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => announce(`${shownCount} ${shownCount === 1 ? 'project' : 'projects'}`), 400);
  };
  const search = el('input', { type: 'search', 'aria-label': 'Search projects', placeholder: 'Search projects', autocomplete: 'off' });
  search.addEventListener('input', () => {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => { query = search.value; render(); note(); }, 150);
  });
  const order = el('select', { 'aria-label': 'Sort projects' }, SORT_KEYS.map((k) => el('option', { value: k, selected: k === sort }, [SORT_LABELS[k]])));
  order.addEventListener('change', () => {
    sort = SORT_KEYS.find((k) => k === order.value) ?? 'activity';
    saveSort(sort);
    render();
    note();
  });
  const create = button('New project', newProject, { variant: 'default', icon: 'plus' });
  create.classList.add('scr-new');

  const who = account.account?.display_name || account.account?.subject || '';
  const avatar = el('span', { class: 'scr-avatar', 'aria-hidden': 'true' }, [(who.trim()[0] ?? '?').toUpperCase()]);
  const side = el('aside', { class: 'scr-side', 'aria-label': 'Profile and statistics' }, [
    el('div', { class: 'scr-profile' }, [
      avatar,
      el('div', { class: 'scr-who' }, [el('span', { class: 'scr-name', title: who }, [who])]),
    ]),
    button('Sign out', h.signOut, { variant: 'small' }),
    stats,
    el('div', { class: 'scr-side-actions' }, [
      button('Open file...', run(async () => {
        const opened = await openProjectFile();
        if (opened) { void markOpened('local', opened.name); h.open(opened.snapshot, { name: opened.name, handle: opened.handle }); }
      }), { variant: 'small' }),
    ]),
  ]);
  const section = (title: string, count: HTMLElement, list: HTMLElement) => el('section', { class: 'scr-section' }, [el('h2', {}, [title, count]), list]);
  const all = allGamesSection(account, (snapshot) => h.open(snapshot), run, h.openHostedGame);
  root.replaceChildren(el('div', { class: 'scr-card scr-wide' }, [
    el('div', { class: 'scr-bar' }, [
      el('div', { class: 'scr-title' }, [el('h1', {}, ['Projects']), ...(h.back ? [button('Back to editor', h.back)] : [])]),
      el('div', { class: 'scr-find' }, [el('div', { class: 'om-field scr-search' }, [search]), el('div', { class: 'om-field' }, [el('span', { class: 'om-unit scr-sortlabel' }, ['Sort']), order])]),
      create,
    ]),
    error,
    el('div', { class: 'scr-shell' }, [side, el('div', { class: 'scr-main' }, [section('Solo', soloCount, soloList), section('Shared', sharedCount, sharedList), ...(all ? [all] : [])])]),
  ]));
}
