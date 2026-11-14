// Marketplace panel: one card per registry plugin with its state, install progress and Install / Uninstall / Reinstall buttons.
import type { PanelSpec, PanelView } from '../layout';
import { button, el } from '../ui';
import type { MarketplaceController, PluginCard } from './controller';

export const MARKETPLACE_PANEL_ID = 'panel.marketplace';

const STATE_LABEL: Record<PluginCard['state'], string> = { available: 'Not installed', installed: 'Installed', uninstalled: 'Uninstalled' };

function renderCard(c: PluginCard, controller: MarketplaceController): HTMLElement {
  const actions = c.state === 'installed'
    ? [button('Uninstall', () => void controller.uninstall(c.id), { variant: 'small', ariaLabel: `Uninstall ${c.name}` }), button('Reinstall', () => void controller.reinstall(c.id), { variant: 'small', ariaLabel: `Reinstall ${c.name}` })]
    : [button('Install', () => void controller.install(c.id), { variant: 'default', ariaLabel: `Install ${c.name}` })];
  for (const a of actions) a.disabled = c.busy;
  return el('li', { class: 'pn-card', style: 'display:grid;gap:4px;padding:8px 0;border-bottom:1px solid var(--border, #333)' }, [
    el('strong', {}, [c.name, el('span', { class: 'om-sub' }, [` ${c.version}`])]),
    el('span', { class: 'om-sub' }, [`${c.author} · ${c.category} · ${c.installs} installs`]),
    el('span', {}, [c.description]),
    el('span', { class: 'om-state' }, [STATE_LABEL[c.state]]),
    el('span', { role: 'status', class: 'om-sub' }, [c.progress]),
    el('span', { role: 'alert', class: 'om-sub', style: 'color:var(--text-error, #f66)' }, [c.error]),
    el('div', { style: 'display:flex;gap:4px' }, actions),
  ]);
}

export function createMarketplacePanel(controller: MarketplaceController): PanelView {
  const root = el('div', { class: 'pn', role: 'region', 'aria-label': 'Marketplace', tabindex: -1, style: 'overflow:auto' });
  const render = () => {
    const cards = controller.cards();
    const hadFocus = root.contains(document.activeElement);
    root.replaceChildren(
      el('div', { style: 'display:flex;gap:8px;align-items:center' }, [button('Refresh', () => void controller.refresh(), { variant: 'small' })]),
      ...(controller.listError ? [el('p', { class: 'pn-empty', role: 'alert' }, [controller.listError])] : []),
      ...(cards.length || controller.listError ? [] : [el('p', { class: 'pn-empty' }, ['No plugins yet. Press Refresh to load the registry.'])]),
      el('ul', { style: 'list-style:none;margin:0;padding:0' }, cards.map((c) => renderCard(c, controller))),
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
