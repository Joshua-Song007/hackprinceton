// Projects screen: one list of cloud games, projects saved on this computer and the autosaved draft; New project starts from a template.
import { announce, button, el, openSheet } from './ui';
import { describeError, type AccountController } from './account';
import { TEMPLATES, loadDraft, templateSnapshot, type ProjectSnapshot } from './project';
import { forgetRecent, loadRecent, mergeProjects, type RecentEntry } from './recent';
import { openProjectFile, type SavedFile } from './projectFile';

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

  const list = el('ul', { class: 'scr-list' });
  let draft: ProjectSnapshot | undefined;
  let recents: RecentEntry[] = [];
  const render = () => {
    const rows = mergeProjects(account.games, recents, !!draft).map((p) => {
      const where = p.kind === 'cloud' ? 'Cloud' : p.kind === 'draft' ? 'Unsaved draft' : 'This computer';
      const open = p.kind === 'cloud' ? run(async () => h.open(await account.openLatest(p.key))) : () => h.open(p.kind === 'draft' ? draft! : p.recent!.snapshot);
      const sub = p.time ? `${where}, ${new Date(p.time).toLocaleString()}` : where;
      const li = el('li', { class: 'scr-row', style: 'cursor:pointer' }, [
        el('span', { class: 'om-name' }, [p.title, el('span', { class: 'om-sub' }, [sub])]),
        button('Open', open, { variant: 'small', ariaLabel: `Open ${p.title}` }),
        ...(p.kind === 'local' ? [button('Remove', async () => { await forgetRecent(p.key); recents = recents.filter((r) => r.id !== p.key); render(); }, { variant: 'small', ariaLabel: `Remove ${p.title} from recent` })] : []),
      ]);
      li.addEventListener('click', (e) => { if (!(e.target as HTMLElement).closest('button')) open(); });
      return li;
    });
    list.replaceChildren(...(rows.length ? rows : [el('li', { class: 'om-sub' }, ['No projects yet. Create one with New project.'])]));
  };
  render();
  account.refreshGames().then(render, fail);
  void Promise.all([loadDraft().catch(() => undefined), loadRecent().catch(() => [] as RecentEntry[])]).then(([d, r]) => { draft = d; recents = r; render(); });

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
  root.replaceChildren(el('div', { class: 'scr-card' }, [
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
      if (opened) h.open(opened.snapshot, { name: opened.name, handle: opened.handle });
    }), { variant: 'small' })]),
  ]));
}
