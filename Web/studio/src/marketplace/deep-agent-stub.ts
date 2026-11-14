// Stand-in for WS4's Deep Agent panel (src/panels/deep-agent.ts, same signature). Integration swaps the one import in main.ts.
import type { PanelSpec } from '../layout';
import type { ScriptRef } from '../editor';
import type { Project } from '../project';
import { el } from '../ui';

export function deepAgentPanel(opts: { url: string; project: Project; openScript(ref: ScriptRef): void }): PanelSpec {
  return {
    id: 'panel.deepagents',
    title: 'Deep Agent',
    create: () => ({ element: el('div', { class: 'pn', role: 'region', 'aria-label': 'Deep Agent', tabindex: -1 }, [el('p', { class: 'pn-empty' }, [`Deep Agent runtime at ${opts.url}`])]) }),
  };
}
