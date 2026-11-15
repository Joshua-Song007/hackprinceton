// "Publish to Vultr" sheet: the server URL, a stepwise progress list, and a confirmation card shown only after the server's copy was verified.
import { PUBLISH_STEPS, VULTR_SERVER_URL, type AccountController, type PublishConfirmation, type PublishStepId, type PublishStepState } from './account';
import { defaultServerUrl, type PreferenceStore } from './preferences';
import type { Project } from './project';
import { announce, button, el, openSheet } from './ui';

/** The two phone links for a published game (Quick Draw is two phones, no referee: #175). */
export function publishLinks(serverUrl: string, gameId: string): { label: string; url: string }[] {
  const base = (serverUrl || globalThis.location?.origin || '').replace(/\/+$/, '');
  const game = encodeURIComponent(gameId);
  return [
    { label: 'Phone 1', url: `${base}/qd-phone.html?game=${game}&name=Player1` },
    { label: 'Phone 2', url: `${base}/qd-phone.html?game=${game}&name=Player2` },
  ];
}

const MARK: Record<PublishStepState | 'pending', string> = { pending: '\u25CB', running: '\u27F3', done: '\u2713', error: '\u2717' };

export function openPublishSheet(account: AccountController, prefs: PreferenceStore, project: Project): void {
  openSheet('Publish to Vultr', (body, close) => {
    // Still on the stock default: offer the Vultr host. Any URL the user chose is kept as is.
    const url = el('input', { type: 'text', value: account.serverUrl === defaultServerUrl() ? VULTR_SERVER_URL : account.serverUrl, placeholder: 'Same origin as this page', 'aria-label': 'Server URL', spellcheck: 'false' });
    const steps = el('ul', { class: 'pn-list', 'aria-label': 'Publish progress' });
    const failure = el('p', { class: 'sheet-error', role: 'alert' });
    const result = el('div');
    const states = new Map<PublishStepId, PublishStepState>();
    const drawSteps = () => steps.replaceChildren(...PUBLISH_STEPS.map((s) => {
      const state = states.get(s.id) ?? 'pending';
      return el('li', { 'data-state': state }, [`${MARK[state]} ${s.label}`]);
    }));

    const copyRow = (label: string, link: string) => el('div', { class: 'om-prop' }, [
      el('span', {}, [label]),
      el('div', { class: 'om-field' }, [
        // shortcut: no QR image, the studio has no QR dependency and the link must not go to an external QR service; add a local encoder to render one here.
        el('a', { href: link, target: '_blank', rel: 'noreferrer' }, [link]),
        button('Copy', () => void navigator.clipboard.writeText(link).then(() => announce(`Copied ${label} link`)), { variant: 'small', ariaLabel: `Copy ${label} link` }),
      ]),
    ]);
    const card = (c: PublishConfirmation) => el('div', { role: 'status', 'aria-label': 'Published' }, [
      el('h3', {}, ['Published and verified']),
      ...[['Game id', c.gameId], ['Version', String(c.version)], ['Run mode', c.runMode], ['Server', c.serverUrl || globalThis.location?.origin || ''], ['Published at', new Date(c.publishedAt).toLocaleString()]]
        .map(([k, v]) => el('div', { class: 'om-prop' }, [el('span', {}, [k!]), el('span', {}, [v!])])),
      ...publishLinks(c.serverUrl, c.gameId).map((l) => copyRow(l.label, l.url)),
    ]);

    const publish: HTMLButtonElement = button('Publish', () => void run(), { variant: 'default' });
    const run = async () => {
      publish.disabled = true;
      failure.textContent = '';
      result.replaceChildren();
      states.clear();
      drawSteps();
      prefs.set({ serverUrl: url.value }); // rebuilds the account's client for the URL shown here
      const outcome = await account.publishVerified(project, (id, state) => {
        states.set(id, state);
        drawSteps();
      });
      if (outcome.ok) result.replaceChildren(card({ ...outcome.confirmation }));
      else failure.textContent = `${PUBLISH_STEPS.find((s) => s.id === outcome.step)?.label} failed. ${outcome.reason}`;
      publish.textContent = outcome.ok ? 'Publish again' : 'Retry';
      publish.disabled = false;
    };

    drawSteps();
    body.append(
      el('div', { class: 'om-prop' }, [el('label', {}, ['Server URL']), el('div', { class: 'om-field' }, [url])]),
      steps, failure, result,
      el('div', { class: 'sheet-actions' }, [button('Close', close), publish]),
    );
  });
}
