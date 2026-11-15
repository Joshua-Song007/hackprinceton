// Login page: required before the editor. Dev sign-in (a name) until real auth exists; the server URL lives in Settings because a wrong one blocks everything.
import { announce, button, el } from './ui';
import { ApiError } from '@pear/cloud';
import { describeError, type AccountController } from './account';
import { openSettingsSheet, type PreferenceStore } from './preferences';
import { renderSignupForm } from './signupScreen';

// Now: username + password sign-in and Create account on one screen; the name-only dev sign-in is gone from the UI (the backend keeps it for sims).

export function renderLoginScreen(root: HTMLElement, account: AccountController, prefs: PreferenceStore, onDone: () => void): void {
  const server = button('', () => openSettingsSheet(prefs), { variant: 'borderless' });
  server.title = 'Change the server in Settings';
  const showServer = () => { server.textContent = `Server: ${account.serverUrl || 'this page'} · Change`; };
  showServer();
  prefs.onChange(showServer);
  const user = el('input', { type: 'text', 'aria-label': 'Username', spellcheck: 'false', autocomplete: 'username' });
  const pass = el('input', { type: 'password', 'aria-label': 'Password', autocomplete: 'current-password' });
  const error = el('p', { class: 'sheet-error', role: 'alert' });
  const go = async () => {
    error.textContent = '';
    try {
      await account.signInDeveloper(user.value.trim(), pass.value);
      pass.value = '';
      onDone();
    } catch (e) {
      pass.value = '';
      error.textContent = e instanceof ApiError && e.kind === 'unauthorized' ? 'Wrong username or password' : describeError(e, account.serverUrl);
      announce(error.textContent);
    }
  };
  for (const f of [user, pass]) f.addEventListener('keydown', (e) => e.key === 'Enter' && void go());
  const signIn = el('div', {}, [
    el('div', { class: 'om-prop' }, [el('label', {}, ['Username']), el('div', { class: 'om-field' }, [user])]),
    el('div', { class: 'om-prop' }, [el('label', {}, ['Password']), el('div', { class: 'om-field' }, [pass])]),
    error,
    el('div', { class: 'sheet-actions' }, [button('Sign in', () => void go(), { variant: 'default' })]),
  ]);
  const signUp = renderSignupForm(account, onDone);
  const panes = [signIn, signUp];
  const tabs: HTMLElement[] = [];
  const pick = (n: number) => {
    panes.forEach((p, i) => { p.hidden = i !== n; });
    tabs.forEach((t, i) => { t.setAttribute('aria-pressed', String(i === n)); });
    (n === 0 ? user : signUp.querySelector<HTMLElement>('input'))?.focus();
  };
  tabs.push(button('Sign in', () => pick(0), { variant: 'small' }), button('Create account', () => pick(1), { variant: 'small' }));
  root.replaceChildren(el('div', { class: 'scr-card scr-login' }, [
    el('img', { src: '/pear-lockup.svg', alt: 'Pear', width: '160', class: 'scr-logo scr-logo-dark' }),
    el('img', { src: '/pear-lockup-emerald.svg', alt: 'Pear', width: '160', class: 'scr-logo scr-logo-light' }),
    el('p', { class: 'scr-product', 'aria-hidden': 'true' }, ['Studio']),
    el('h1', { class: 'sr-only' }, ['Pear Studio']),
    el('div', { class: 'sheet-actions' }, tabs),
    ...panes,
    server,
  ]));
  pick(0);
}
