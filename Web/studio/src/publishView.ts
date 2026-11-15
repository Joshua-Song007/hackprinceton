// "Publish to Vultr" sheet: the server URL, a stepwise progress list, and a confirmation card shown only after the server's copy was verified.
import { ApiError, type CloudClient } from '@pear/cloud';
import { validate } from '@pear/ui';
import qrcode from 'qrcode-generator';
import { PUBLISH_STEPS, VULTR_SERVER_URL, describeError, type AccountController, type PublishConfirmation, type PublishExtra, type PublishStepId, type PublishStepState } from './account';
import { openAboutPanel } from './aboutPanel';
import { checkGame } from './gamePanel';
import { clearDraft, loadDraft, mediaAssets, mediaMetadata, missingMedia } from './mediaDraft';
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

/** Local QR code (GIF data URL) for a link, so scanning works without any external service. */
export function qrDataUrl(text: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createDataURL(6, 8);
}

/** Labels of the checks that stop a publish: failing, not optional, and not the run/publish state rows. */
export function publishBlockers(project: Project): string[] {
  return checkGame(project, '', null).checks.filter((c) => !c.ok && !c.optional && !c.kind).map((c) => (c.hint ? `${c.label} (${c.hint})` : c.label));
}

/** The `ui.json` asset in the inline form the server stores: `{contentType, data}` with base64 data. Throws a sentence when the text is not a valid PearUI. */
export function uiJsonAsset(text: string): Record<string, unknown> {
  let ui: unknown;
  try {
    ui = JSON.parse(text);
  } catch {
    throw new Error('ui.json is not valid JSON.');
  }
  const problems = validate(ui);
  if (problems.length) throw new Error(`ui.json is invalid: ${problems[0]}`);
  let bin = '';
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return { 'ui.json': { contentType: 'application/json', data: btoa(bin) } };
}

/**
 * What an update carries over from the game's latest version so republishing from Studio does not drop it:
 * `metadata.manifest` and the ui.json asset. A game with no versions yet has nothing to carry.
 */
export async function carriedOver(client: CloudClient, gameId: string): Promise<PublishExtra> {
  let latest;
  try {
    latest = await client.fetchVersion(gameId, 'latest');
  } catch (e) {
    if (e instanceof ApiError && e.kind === 'notFound') return {};
    throw e;
  }
  const ui = Object.entries(latest.assets ?? {}).find(([name]) => name === 'ui.json' || name.endsWith('/ui.json'));
  return {
    ...(ui ? { assets: { [ui[0]]: ui[1] } } : {}),
    ...(latest.metadata?.manifest ? { metadata: { manifest: latest.metadata.manifest } } : {}),
  };
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

    const blocked = publishBlockers(project);
    const blockers = el('ul', { class: 'pn-list', 'aria-label': 'Checks that block publishing', role: 'alert' }, blocked.map((b) => el('li', { 'data-state': 'error' }, [`${MARK.error} ${b}`])));
    const mode = el('select', { 'aria-label': 'Publish as' });
    const fillMode = () => {
      mode.replaceChildren(
        ...(account.gameId ? [el('option', { value: 'update' }, [`Update game: ${account.game?.title ?? account.gameId}`])] : []),
        el('option', { value: 'new' }, ['New game']),
      );
    };
    fillMode();
    const title = el('input', { type: 'text', value: project.name, 'aria-label': 'New game title', placeholder: 'Title of the new game' });
    const uiFile = el('input', { type: 'file', accept: '.json,application/json', 'aria-label': 'ui.json to publish' });
    const titleRow = el('div', { class: 'om-prop' }, [el('label', {}, ['Title']), el('div', { class: 'om-field' }, [title])]);
    const syncMode = () => { titleRow.hidden = mode.value !== 'new'; };
    mode.addEventListener('change', syncMode);
    syncMode();

    const copyRow = (label: string, link: string) => el('div', { class: 'om-prop' }, [
      el('span', {}, [label]),
      el('div', { class: 'om-field' }, [
        el('img', { src: qrDataUrl(link), alt: `QR code for ${label}`, width: '120', height: '120' }),
        el('a', { href: link, target: '_blank', rel: 'noreferrer' }, [link]),
        button('Copy', () => void navigator.clipboard.writeText(link).then(() => announce(`Copied ${label} link`)), { variant: 'small', ariaLabel: `Copy ${label} link` }),
      ]),
    ]);
    const card = (c: PublishConfirmation & { created: boolean; ui: boolean }) => el('div', { role: 'status', 'aria-label': 'Published' }, [
      el('h3', {}, [`${c.created ? 'New game published' : 'Game updated'} and verified`]),
      ...[['Game id', c.gameId], ['Version', String(c.version)], ['Checks', 'Passed'], ['ui.json', c.ui ? 'Included' : 'None'], ['Run mode', c.runMode], ['Server', c.serverUrl || globalThis.location?.origin || ''], ['Published at', new Date(c.publishedAt).toLocaleString()]]
        .map(([k, v]) => el('div', { class: 'om-prop' }, [el('span', {}, [k!]), el('span', {}, [v!])])),
      ...publishLinks(c.serverUrl, c.gameId).map((l) => copyRow(l.label, l.url)),
    ]);

    const publish: HTMLButtonElement = button('Publish', () => void run(), { variant: 'default' });
    publish.disabled = blocked.length > 0;
    const run = async () => {
      publish.disabled = true;
      failure.textContent = '';
      result.replaceChildren();
      states.clear();
      drawSteps();
      const fail = (reason: string) => {
        failure.textContent = reason;
        publish.textContent = 'Retry';
        publish.disabled = false;
      };
      const stillBlocked = publishBlockers(project);
      if (stillBlocked.length) return fail(`Fix ${stillBlocked.length} failing check${stillBlocked.length === 1 ? '' : 's'} before publishing.`);
      prefs.set({ serverUrl: url.value }); // rebuilds the account's client for the URL shown here
      let extra: PublishExtra = {};
      let created = false;
      try {
        const picked = uiFile.files?.[0];
        const asset = picked ? uiJsonAsset(await picked.text()) : undefined;
        created = mode.value === 'new';
        if (created) {
          await account.createGame(title.value.trim());
          fillMode(); // a retry after this publishes to the game just created, not a second one
          syncMode();
        } else extra = await carriedOver(account.client, account.gameId!);
        if (asset) extra = { ...extra, assets: { ...extra.assets, ...asset } };
        const draft = await loadDraft(account.client, account.gameId!);
        if (draft.thumbnail || draft.carousel.length) extra = { assets: { ...extra.assets, ...mediaAssets(draft) }, metadata: { ...extra.metadata, media: mediaMetadata(draft) } };
      } catch (e) {
        return fail(describeError(e, account.serverUrl));
      }
      const outcome = await account.publishVerified(project, (id, state) => {
        states.set(id, state);
        drawSteps();
      }, extra);
      if (outcome.ok && account.gameId) clearDraft(account.gameId);
      if (outcome.ok) result.replaceChildren(card({ ...outcome.confirmation, created, ui: !!extra.assets }));
      else failure.textContent = `${PUBLISH_STEPS.find((s) => s.id === outcome.step)?.label} failed. ${outcome.reason}`;
      publish.textContent = outcome.ok ? 'Publish again' : 'Retry';
      publish.disabled = false;
    };

    // Missing or new media: say so before publishing; never blocks.
    const mediaNote = el('p', { class: 'sheet-note', role: 'status' });
    const aboutLink = button('Add media...', () => openAboutPanel(account, account.gameId), { variant: 'small' });
    aboutLink.hidden = true;
    if (account.gameId) {
      loadDraft(account.client, account.gameId).then((d) => {
        const missing = missingMedia(d);
        mediaNote.textContent = missing.length ? `Game page media: ${missing.join(' ')}` : d.dirty ? 'New media will be included in this version.' : '';
        aboutLink.hidden = !missing.length && !d.dirty;
      }).catch(() => { /* advisory only; publishing reports real failures */ });
    }

    drawSteps();
    body.append(
      el('div', { class: 'om-prop' }, [el('label', {}, ['Server URL']), el('div', { class: 'om-field' }, [url])]),
      el('div', { class: 'om-prop' }, [el('label', {}, ['Publish as']), el('div', { class: 'om-field' }, [mode])]),
      titleRow,
      el('div', { class: 'om-prop' }, [el('label', {}, ['ui.json (optional)']), el('div', { class: 'om-field' }, [uiFile])]),
      mediaNote, aboutLink, blockers, steps, failure, result,
      el('div', { class: 'sheet-actions' }, [button('Close', close), publish]),
    );
  });
}
