// Login page: required before the editor. Dev sign-in (a name) until real auth exists; the server URL lives in Settings because a wrong one blocks everything.
import { announce, button, el } from './ui';
import { describeError, type AccountController } from './account';
import { openSettingsSheet, type PreferenceStore } from './preferences';

const NAME_KEY = 'omni.studio.lastName';

export function renderLoginScreen(root: HTMLElement, account: AccountController, prefs: PreferenceStore, onDone: () => void): void {
  let last = '';
  try { last = localStorage.getItem(NAME_KEY) ?? ''; } catch { /* no storage */ }
  const name = el('input', { type: 'text', 'aria-label': 'Name', placeholder: 'Your name', value: last, spellcheck: 'false', autocomplete: 'username' });
  const error = el('p', { class: 'sheet-error', role: 'alert' });
  const server = button('', () => openSettingsSheet(prefs), { variant: 'borderless' });
  const showServer = () => { server.textContent = `Server: ${account.serverUrl || 'this page'}`; };
  showServer();
  prefs.onChange(showServer);
  const go = async () => {
    error.textContent = '';
    try {
      await account.signIn(name.value.trim());
      try { localStorage.setItem(NAME_KEY, name.value.trim()); } catch { /* ignore */ }
      onDone();
    } catch (e) {
      error.textContent = describeError(e, account.serverUrl);
      announce(error.textContent);
    }
  };
  name.addEventListener('keydown', (e) => e.key === 'Enter' && void go());
  root.replaceChildren(el('div', { class: 'scr-card scr-login' }, [
    el('h1', {}, ['Omni Studio']),
    el('div', { class: 'om-prop' }, [el('label', {}, ['Name']), el('div', { class: 'om-field' }, [name])]),
    error,
    el('div', { class: 'sheet-actions' }, [button('Sign in', () => void go(), { variant: 'default' })]),
    el('p', { class: 'sheet-note' }, ['Dev sign-in uses your name as the account.']),
    server,
  ]));
  queueMicrotask(() => name.focus());
}
