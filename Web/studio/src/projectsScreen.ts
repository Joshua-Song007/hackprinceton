// Projects screen: a gallery of tiles (preview, name, last opened, last edited, Open) for cloud games, projects saved on this computer and the autosaved draft; New project starts from a template.
import { announce, button, el, openSheet } from './ui';
import { describeError, type AccountController } from './account';
import { TEMPLATES, loadDraft, loadDraftAt, templateSnapshot, type ProjectSnapshot } from './project';
import { dropThumb, forgetOpened, forgetRecent, formatWhen, loadOpened, loadRecent, loadThumbs, markOpened, mergeProjects, saveThumb, thumbHit, type RecentEntry, type Thumb } from './recent';
import { openProjectFile, type SavedFile } from './projectFile';
import { renderThumbnail, ThumbnailQueue } from './thumbnail';

export interface ProjectsHooks {
  account: AccountController;
  open(snapshot: ProjectSnapshot, file?: SavedFile): void;
  signOut(): void;
  /** Set when an editor session already exists, so the screen can offer a way back. */
  back?: (() => void) | undefined;
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

  const list = el('ul', { class: 'scr-grid', role: 'list' });
  let draft: ProjectSnapshot | undefined;
  let draftAt: number | undefined;
  let recents: RecentEntry[] = [];
  let opened: Record<string, number> = {};
  let thumbs: Record<string, Thumb> = {};
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
    const rows = mergeProjects(account.games, recents, !!draft, opened, draftAt).map((p) => {
      const id = `${p.kind}:${p.key}`;
      const where = p.kind === 'cloud' ? 'Cloud' : p.kind === 'draft' ? 'Unsaved draft' : 'This computer';
      const open = p.kind === 'cloud'
        ? run(async () => { const snapshot = await account.openLatest(p.key); void markOpened('cloud', p.key); h.open(snapshot); })
        : () => { void markOpened(p.kind, p.key); h.open(p.kind === 'draft' ? draft! : p.recent!.snapshot); };

      const thumb = el('div', { class: 'scr-thumb' }, [el('span', { class: 'scr-thumb-none' }, ['No preview'])]);
      const show = (url: string) => thumb.replaceChildren(el('img', { src: url, alt: '', 'aria-hidden': 'true' }));
      const cached = thumbHit(thumbs, id, p.stamp);
      if (cached) show(cached);
      const scene = async () => (p.kind === 'cloud' ? (await account.openLatest(p.key)).scene : p.kind === 'draft' ? draft!.scene : p.recent!.snapshot.scene);
      const start = () => queue.add(async () => {
        const url = renderThumbnail(await scene());
        if (url) await saveThumb(id, p.stamp, url);
        return url;
      }, (url) => { if (url) { thumbs[id] = { stamp: p.stamp, url }; show(url); } });

      const info = el('div', { class: 'scr-info' }, [
        el('span', { class: 'scr-name', title: p.title }, [p.title]),
        el('span', { class: 'scr-meta' }, [where]),
        el('span', { class: 'scr-meta' }, [formatWhen(p.opened, 'Opened')]),
        el('span', { class: 'scr-meta' }, [formatWhen(p.time, 'Edited')]),
        el('div', { class: 'scr-actions' }, [
          button('Open', open, { ariaLabel: `Open ${p.title}` }),
          ...(p.kind === 'local' ? [button('Remove', async () => { await forgetRecent(p.key); await dropThumb(id); await forgetOpened('local', p.key); recents = recents.filter((r) => r.id !== p.key); render(); }, { variant: 'small', ariaLabel: `Remove ${p.title} from recent` })] : []),
        ]),
      ]);
      const li = el('li', { class: 'scr-tile' }, [thumb, info]);
      li.addEventListener('click', (e) => { if (!(e.target as HTMLElement).closest('button')) open(); });
      if (!cached && ready) {
        if (seen) { starts.set(li, start); seen.observe(li); } else start();
      }
      return li;
    });
    list.replaceChildren(...(rows.length ? rows : [el('li', { class: 'om-sub scr-empty' }, ['No projects yet. Create one with New project.'])]));
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
        button(`Create ${t.label}`, () => { close(); h.open(templateSnapshot(t.id)); }, { variant: 'small' }),
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

  const who = account.account?.display_name || account.account?.subject || '';
  root.replaceChildren(el('div', { class: 'scr-card scr-wide' }, [
    el('div', { class: 'scr-head' }, [
      el('h1', {}, ['Projects']),
      el('span', { class: 'om-secondary' }, [`Signed in as ${who}`]),
      ...(h.back ? [button('Back to editor', h.back, { variant: 'small' })] : []),
      button('Sign out', h.signOut, { variant: 'small' }),
      button('New project', newProject, { variant: 'default' }),
    ]),
    error,
    el('section', { class: 'scr-section' }, [el('h2', {}, ['Your projects']), list, button('Open file...', run(async () => {
      const opened = await openProjectFile();
      if (opened) { void markOpened('local', opened.name); h.open(opened.snapshot, { name: opened.name, handle: opened.handle }); }
    }), { variant: 'small' })]),
  ]));
}
