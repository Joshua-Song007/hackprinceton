// Game About editor: title, description and cover of the cloud game the open project is linked to. Owner or developer only; the server enforces the same.
import { ApiError, type Game } from '@pear/cloud';
import { describeError, type AccountController } from './account';
import { mountMediaEditor } from './mediaEditor';
import { announce, button, el, openSheet } from './ui';

export const DESCRIPTION_MAX = 4000;
export const COVER_MAX_BYTES = 2 * 1024 * 1024;
const COVER_TYPES = ['image/jpeg', 'image/png'];

/** Why a file cannot be a cover, or null when it can. */
export function coverProblem(file: { type: string; size: number }): string | null {
  if (!COVER_TYPES.includes(file.type)) return 'The cover must be a JPEG or PNG image.';
  if (file.size > COVER_MAX_BYTES) return 'The cover must be 2 MB or smaller.';
  return null;
}

export const canEditAbout = (account: AccountController, game: Game | undefined): game is Game =>
  !!game && !!account.account && (account.isDeveloper || game.owner_id === account.account.id);

export function openAboutPanel(account: AccountController, gameId: string | null): void {
  const game = account.games.find((g) => g.id === gameId);
  openSheet('Game About', (body, close) => {
    if (!canEditAbout(account, game)) {
      body.append(el('p', { class: 'sheet-note' }, ['Link this project to one of your cloud games (Publish it) to edit its About page.']), el('div', { class: 'sheet-actions' }, [button('Close', close)]));
      return;
    }
    const status = el('p', { class: 'sheet-note', role: 'status' });
    const error = el('p', { class: 'sheet-error', role: 'alert' });
    const fail = (e: unknown) => {
      error.textContent = e instanceof ApiError && e.status === 413 ? 'The server says the image is too large (2 MB limit).'
        : e instanceof ApiError && e.status === 415 ? 'The server only accepts JPEG or PNG covers.' : describeError(e, account.serverUrl);
      announce(error.textContent);
    };
    const title = el('input', { type: 'text', 'aria-label': 'Title', value: game.title });
    const description = el('textarea', { 'aria-label': 'Description', rows: '6', maxlength: String(DESCRIPTION_MAX), style: 'width:100%;box-sizing:border-box' });
    description.value = game.description ?? '';
    const counter = el('span', { class: 'om-secondary' });
    const count = () => { counter.textContent = `${description.value.length} / ${DESCRIPTION_MAX}`; };
    description.addEventListener('input', count);
    count();

    let hasCover = !!game.has_cover;
    let stamp = game.updated_at;
    const preview = el('div', { class: 'scr-thumb' });
    const showCover = () => preview.replaceChildren(hasCover
      ? el('img', { src: account.client.coverUrl(game.id, stamp), alt: 'Cover preview' })
      : el('span', { class: 'scr-thumb-none' }, ['No cover']));
    showCover();
    const file = el('input', { type: 'file', accept: 'image/jpeg,image/png', 'aria-label': 'Cover image' });
    const remove = button('Remove cover', async () => {
      error.textContent = '';
      try { await account.client.deleteCover(game.id); hasCover = false; showCover(); status.textContent = 'Cover removed.'; } catch (e) { fail(e); }
    }, { variant: 'small', danger: true });
    file.addEventListener('change', async () => {
      error.textContent = '';
      const f = file.files?.[0];
      if (!f) return;
      const problem = coverProblem(f);
      if (problem) { error.textContent = problem; file.value = ''; announce(problem); return; }
      try { await account.client.uploadCover(game.id, f); hasCover = true; stamp = String(Date.now()); showCover(); status.textContent = 'Cover uploaded.'; } catch (e) { fail(e); }
      file.value = '';
    });

    const save = async () => {
      error.textContent = '';
      status.textContent = '';
      const t = title.value.trim();
      if (!t) { error.textContent = 'The title cannot be empty.'; return; }
      try {
        const updated = await account.client.updateGame(game.id, { title: t, description: description.value });
        Object.assign(game, updated);
        account.select(account.gameId); // notifies listeners so the lists show the new title
        status.textContent = 'Saved.';
      } catch (e) { fail(e); }
    };
    body.append(
      el('div', { class: 'om-prop' }, [el('label', {}, ['Title']), el('div', { class: 'om-field' }, [title])]),
      el('div', { class: 'om-prop om-prop--vec' }, [el('label', {}, ['Description']), description, counter]),
      el('div', { class: 'om-prop om-prop--vec' }, [el('span', {}, ['Cover (JPEG or PNG, 2 MB)']), preview, file, remove]),
      status, error,
      el('div', { class: 'sheet-actions' }, [button('Close', close), button('Save', () => void save(), { variant: 'default' })]),
    );
    void mountMediaEditor(body, account.client, game.id, fail, (s) => { status.textContent = s; });
  });
}
