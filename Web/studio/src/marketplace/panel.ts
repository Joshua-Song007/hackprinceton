// Marketplace panel: one card per registry plugin with its state, install progress and Install / Uninstall / Reinstall buttons.
import type { PanelSpec, PanelView } from '../layout';
import { button, el } from '../ui';
import type { MarketplaceController, PluginCard } from './controller';
import type { ModelProvider } from './registry';
import './marketplace.css';

export const MARKETPLACE_PANEL_ID = 'panel.marketplace';

const STATE_LABEL: Record<PluginCard['state'], string> = { available: 'Not installed', installed: 'Installed', uninstalled: 'Uninstalled' };

function renderCard(c: PluginCard, controller: MarketplaceController): HTMLElement {
  const update = c.updateAvailable ? [button(`Update to ${c.version}`, () => void controller.reinstall(c.id), { variant: 'default', ariaLabel: `Update ${c.name} from ${c.installedVersion} to ${c.version}` })] : [];
  const actions = c.state === 'installed'
    ? [...update, button('Uninstall', () => void controller.uninstall(c.id), { variant: 'small', ariaLabel: `Uninstall ${c.name}` }), button('Reinstall', () => void controller.reinstall(c.id), { variant: 'small', ariaLabel: `Reinstall ${c.name}` })]
    : [button('Install', () => void controller.install(c.id), { variant: 'default', ariaLabel: `Install ${c.name}` })];
  for (const a of actions) a.disabled = c.busy;
  return el('li', { class: 'mk-item', 'aria-busy': String(c.busy) }, [
    el('div', { class: 'mk-head' }, [
      el('h3', { class: 'mk-name' }, [c.name]),
      el('span', { class: 'mk-version' }, [c.updateAvailable ? `${c.installedVersion} installed, ${c.version} available` : c.version]),
      el('span', { class: 'mk-state', 'data-state': c.state }, [STATE_LABEL[c.state]]),
    ]),
    el('span', { class: 'mk-meta' }, [`${c.author} \u00b7 ${c.category} \u00b7 ${c.installs} installs`]),
    el('p', { class: 'mk-desc' }, [c.description]),
    el('p', { class: 'mk-progress', role: 'status' }, [c.progress]),
    ...(c.error ? [el('p', { class: 'mk-error', role: 'alert' }, [c.error])] : []),
    el('div', { class: 'mk-actions' }, actions),
  ]);
}

const PROVIDERS: [ModelProvider, string][] = [['anthropic', 'Anthropic'], ['openai', 'OpenAI'], ['google', 'Google']];

/** Model API key for the hosted agent runtime, stored encrypted on the account. The key is write-only here. */
function renderModelKey(controller: MarketplaceController): HTMLElement {
  if (!controller.signedIn) return el('p', { class: 'mk-meta mk-key' }, ['Sign in to store a model API key for the hosted agent.']);
  const k = controller.modelKey;
  const provider = el('select', { 'aria-label': 'Model provider' }, PROVIDERS.map(([v, label]) => el('option', { value: v, ...(k?.provider === v ? { selected: '' } : {}) }, [label])));
  const key = el('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: k?.set ? 'Key saved - paste a new one to replace it' : 'Paste API key', 'aria-label': 'Model API key' });
  const save = button('Save key', () => {
    if (key.value.trim()) void controller.saveModelKey(provider.value as ModelProvider, key.value.trim());
  }, { variant: 'small' });
  const status = k === null ? 'Key status not loaded.' : k.set ? `Key saved for ${PROVIDERS.find(([v]) => v === k.provider)?.[1] ?? k.provider}.` : 'No key saved.';
  return el('div', { class: 'mk-key', role: 'group', 'aria-label': 'Model API key' }, [
    el('span', { class: 'mk-meta' }, [`Hosted agent model key. ${status}`]),
    el('div', { class: 'mk-actions' }, [provider, key, save, ...(k?.set ? [button('Remove key', () => void controller.removeModelKey(), { variant: 'small' })] : [])]),
    ...(controller.modelKeyError ? [el('p', { class: 'mk-error', role: 'alert' }, [controller.modelKeyError])] : []),
  ]);
}

export function createMarketplacePanel(controller: MarketplaceController): PanelView {
  const root = el('div', { class: 'pn mk', role: 'region', 'aria-label': 'Marketplace', tabindex: -1 });
  const render = () => {
    const cards = controller.cards();
    const hadFocus = root.contains(document.activeElement);
    root.replaceChildren(
      el('div', { class: 'pn-bar' }, [button('Refresh', () => void controller.refresh(), { variant: 'small', ariaLabel: 'Refresh plugin list' })]),
      renderModelKey(controller),
      ...(controller.listError ? [el('p', { class: 'pn-empty', role: 'alert' }, [controller.listError])] : []),
      ...(cards.length || controller.listError ? [] : [el('p', { class: 'pn-empty' }, ['No plugins loaded yet. Press Refresh to load the registry.'])]),
      el('ul', { class: 'mk-list', 'aria-label': 'Plugins' }, cards.map((c) => renderCard(c, controller))),
    );
    if (hadFocus) root.focus(); // the focused button was just replaced
  };
  const off = controller.onChange(render);
  render();
  void controller.refresh();
  void controller.loadModelKey();
  return { element: root, focus: () => root.focus(), dispose: off };
}

export function marketplacePanel(controller: MarketplaceController): PanelSpec {
  return { id: MARKETPLACE_PANEL_ID, title: 'Marketplace', create: () => createMarketplacePanel(controller) };
}
