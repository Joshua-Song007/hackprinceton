// Login page: required before the editor. Dev sign-in (a name) until real auth exists; the server URL lives in Settings because a wrong one blocks everything.
import { announce, button, el } from './ui';
import { ApiError } from '@pear/cloud';
import { describeError, type AccountController } from './account';
import { openSettingsSheet, type PreferenceStore } from './preferences';

const NAME_KEY = 'pear.studio.lastName';

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
  const devUser = el('input', { type: 'text', 'aria-label': 'Developer username', placeholder: 'Username', spellcheck: 'false', autocomplete: 'username' });
  const devPass = el('input', { type: 'password', 'aria-label': 'Developer password', placeholder: 'Password', autocomplete: 'current-password' });
  const devError = el('p', { class: 'sheet-error', role: 'alert' });
  const goDev = async () => {
    devError.textContent = '';
    try {
      await account.signInDeveloper(devUser.value.trim(), devPass.value);
      devPass.value = '';
      onDone();
    } catch (e) {
      devPass.value = '';
      devError.textContent = e instanceof ApiError && e.kind === 'unauthorized' ? 'Wrong username or password' : describeError(e, account.serverUrl);
      announce(devError.textContent);
    }
  };
  for (const f of [devUser, devPass]) f.addEventListener('keydown', (e) => e.key === 'Enter' && void goDev());
  name.addEventListener('keydown', (e) => e.key === 'Enter' && void go());
  root.replaceChildren(el('div', { class: 'scr-card scr-login' }, [
    el('img', { src: '/pear-lockup.svg', alt: 'Pear', width: '160', class: 'scr-logo scr-logo-dark' }),
    el('img', { src: '/pear-lockup-emerald.svg', alt: 'Pear', width: '160', class: 'scr-logo scr-logo-light' }),
    el('h1', { class: 'sr-only' }, ['Pear Studio']),
    el('div', { class: 'om-prop' }, [el('label', {}, ['Name']), el('div', { class: 'om-field' }, [name])]),
    error,
    el('div', { class: 'sheet-actions' }, [button('Sign in', () => void go(), { variant: 'default' })]),
    el('p', { class: 'sheet-note' }, ['Dev sign-in uses your name as the account.']),
    el('h2', {}, ['Developer sign-in']),
    el('div', { class: 'om-prop' }, [el('label', {}, ['Username']), el('div', { class: 'om-field' }, [devUser])]),
    el('div', { class: 'om-prop' }, [el('label', {}, ['Password']), el('div', { class: 'om-field' }, [devPass])]),
    devError,
    el('div', { class: 'sheet-actions' }, [button('Sign in as developer', () => void goDev())]),
    server,
  ]));
  queueMicrotask(() => name.focus());
}
