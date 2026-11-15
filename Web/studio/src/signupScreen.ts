// Create-account form for the login screen. Validation mirrors the backend (POST /api/accounts/signup) so the user sees the fix before a round trip.
import { announce, button, el } from './ui';
import { ApiError } from '@pear/cloud';
import { describeError, type AccountController } from './account';

/** Backend rules: username 3-32 of [a-z0-9_-], password at least 10 characters, confirmation must match. Returns one sentence per problem. */
export function validateSignup(username: string, password: string, confirm: string): string[] {
  const problems: string[] = [];
  if (!/^[a-z0-9_-]{3,32}$/.test(username)) problems.push('Username must be 3-32 characters: lowercase letters, digits, - or _.');
  if (password.length < 10) problems.push('Password must be at least 10 characters.');
  if (confirm !== password) problems.push('Passwords do not match.');
  return problems;
}

export function signupError(e: unknown, serverUrl: string): string {
  if (e instanceof ApiError && e.status === 409) return 'That username is taken. Pick another.';
  if (e instanceof ApiError && e.kind === 'badRequest') return 'The server rejected those details. Check the username and password rules.';
  return describeError(e, serverUrl);
}

export function renderSignupForm(account: AccountController, onDone: () => void): HTMLElement {
  const field = (label: string, input: HTMLInputElement) => el('div', { class: 'om-prop' }, [el('label', {}, [label]), el('div', { class: 'om-field' }, [input])]);
  const username = el('input', { type: 'text', 'aria-label': 'Username', placeholder: 'username', spellcheck: 'false', autocomplete: 'username' });
  const display = el('input', { type: 'text', 'aria-label': 'Display name', placeholder: 'Display name', autocomplete: 'name' });
  const password = el('input', { type: 'password', 'aria-label': 'Password', placeholder: 'At least 10 characters', autocomplete: 'new-password' });
  const confirm = el('input', { type: 'password', 'aria-label': 'Confirm password', placeholder: 'Repeat password', autocomplete: 'new-password' });
  const error = el('p', { class: 'sheet-error', role: 'alert' });
  const show = (text: string) => { error.textContent = text; if (text) announce(text); };
  const go = async () => {
    show('');
    const problems = validateSignup(username.value.trim(), password.value, confirm.value);
    if (problems.length) return show(problems.join(' '));
    try {
      await account.signUp(username.value.trim(), display.value.trim(), password.value);
      password.value = confirm.value = '';
      onDone();
    } catch (e) {
      password.value = confirm.value = '';
      show(signupError(e, account.serverUrl));
    }
  };
  for (const f of [username, display, password, confirm]) f.addEventListener('keydown', (e) => e.key === 'Enter' && void go());
  username.addEventListener('blur', () => { if (username.value && !/^[a-z0-9_-]{3,32}$/.test(username.value.trim())) show(validateSignup(username.value.trim(), 'x'.repeat(10), 'x'.repeat(10))[0]!); });
  return el('div', {}, [field('Username', username), field('Display name', display), field('Password', password), field('Confirm password', confirm), error,
    el('div', { class: 'sheet-actions' }, [button('Create account', () => void go(), { variant: 'default' })])]);
}
