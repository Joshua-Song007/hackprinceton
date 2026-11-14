// Marketplace panel: one card per registry plugin with its state, install progress and Install / Uninstall / Reinstall buttons.
import type { PanelSpec, PanelView } from '../layout';
import { button, el } from '../ui';
import type { MarketplaceController, PluginCard } from './controller';
import './marketplace.css';

export const MARKETPLACE_PANEL_ID = 'panel.marketplace';

const STATE_LABEL: Record<PluginCard['state'], string> = { available: 'Not installed', installed: 'Installed', uninstalled: 'Uninstalled' };

function renderCard(c: PluginCard, controller: MarketplaceController): HTMLElement {
  const actions = c.state === 'installed'
    ? [button('Uninstall', () => void controller.uninstall(c.id), { variant: 'small', ariaLabel: `Uninstall ${c.name}` }), button('Reinstall', () => void controller.reinstall(c.id), { variant: 'small', ariaLabel: `Reinstall ${c.name}` })]
    : [button('Install', () => void controller.install(c.id), { variant: 'default', ariaLabel: `Install ${c.name}` })];
  for (const a of actions) a.disabled = c.busy;
  return el('li', { class: 'mk-item', 'aria-busy': String(c.busy) }, [
    el('div', { class: 'mk-head' }, [
      el('h3', { class: 'mk-name' }, [c.name]),
      el('span', { class: 'mk-version' }, [c.version]),
      el('span', { class: 'mk-state', 'data-state': c.state }, [STATE_LABEL[c.state]]),
    ]),
    el('span', { class: 'mk-meta' }, [`${c.author} \u00b7 ${c.category} \u00b7 ${c.installs} installs`]),
    el('p', { class: 'mk-desc' }, [c.description]),
    el('p', { class: 'mk-progress', role: 'status' }, [c.progress]),
    ...(c.error ? [el('p', { class: 'mk-error', role: 'alert' }, [c.error])] : []),
    el('div', { class: 'mk-actions' }, actions),
  ]);
}

export function createMarketplacePanel(controller: MarketplaceController): PanelView {
  const root = el('div', { class: 'pn mk', role: 'region', 'aria-label': 'Marketplace', tabindex: -1 });
  const render = () => {
    const cards = controller.cards();
    const hadFocus = root.contains(document.activeElement);
    root.replaceChildren(
      el('div', { class: 'pn-bar' }, [button('Refresh', () => void controller.refresh(), { variant: 'small', ariaLabel: 'Refresh plugin list' })]),
      ...(controller.listError ? [el('p', { class: 'pn-empty', role: 'alert' }, [controller.listError])] : []),
      ...(cards.length || controller.listError ? [] : [el('p', { class: 'pn-empty' }, ['No plugins loaded yet. Press Refresh to load the registry.'])]),
      el('ul', { class: 'mk-list', 'aria-label': 'Plugins' }, cards.map((c) => renderCard(c, controller))),
    );
    if (hadFocus) root.focus(); // the focused button was just replaced
  };
  const off = controller.onChange(render);
  render();
  void controller.refresh();
  return { element: root, focus: () => root.focus(), dispose: off };
}

export function marketplacePanel(controller: MarketplaceController): PanelSpec {
  return { id: MARKETPLACE_PANEL_ID, title: 'Marketplace', create: () => createMarketplacePanel(controller) };
}
