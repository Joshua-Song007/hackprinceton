// Check panel: "Run N simulated phones in a lobby". Runs the open game's server scripts on the in-page LocalServer with a virtual
// clock (Tools/pear-check/simcore.ts, the same engine as `pear-check`), so a 5 s countdown finishes instantly and the result is
// deterministic. Menu: View > Check. Gap: it drives server scripts only; page-side countdowns are not on the virtual clock yet.
import prelude from '../../../Packages/PearScript/Sources/PearScript/Resources/prelude.js?raw';
import { runScenario, selfcheck, type CScenario } from '../../../Tools/pear-check/simcore';
import type { PanelSpec, PanelView } from './layout';
import type { Project } from './project';
import { button, el } from './ui';
import './lobbiesPanel.css';

export const MAX_PHONES = 12;

/** `n` phones clamped to 1..MAX_PHONES (NaN becomes 1). */
export const clampPhones = (n: number): number => (Number.isFinite(n) ? Math.min(MAX_PHONES, Math.max(1, Math.round(n))) : 1);

/** The generic gesture script every phone plays: ready, start, raise, lower. Scripts that ignore an event are unaffected. */
export function phoneScenario(n: number): CScenario {
  const steps = [{ at: 500, send: { name: 'ready' } }, { at: 1000, send: { name: 'start' } }, { at: 2000, send: { name: 'raised' } }, { at: 3000, send: { name: 'lowered' } }];
  return { name: `${clampPhones(n)} phones`, durationMs: 10_000, devices: [{ name: 'Phone', kind: 'phone', count: clampPhones(n), script: steps }] };
}

export interface CheckSummary { ok: boolean; lines: string[] }

/** Self-check plus the generic N-phone scenario, flattened to lines a reader can scan: errors first, then what ran. */
export function runCheck(files: Record<string, string>, n: number, run: { prelude: string } = { prelude }): CheckSummary {
  const sc = phoneScenario(n);
  const self = selfcheck(run.prelude, files);
  const res = runScenario(run.prelude, files, sc);
  const errors = [...self.errors.map((e) => `self-check: ${e}`), ...res.errors.map((e) => `${sc.name}: ${e}`)];
  const lines = errors.length ? errors : [
    'self-check: junk and unknown events, leave, timers drain, no handler throws',
    `${sc.name}: joined, ready, start, raised, lowered; ${Math.round(res.virtualMs)} ms virtual; script sent ${res.sent.join(', ') || 'nothing'} to the lobby`,
  ];
  return { ok: errors.length === 0, lines };
}

/** The project as the files map the check engine reads (scene.json plus scripts/server/<name>.js). */
export function projectFiles(project: Pick<Project, 'scene' | 'serverScripts'>): Record<string, string> {
  const files: Record<string, string> = { 'scene.json': JSON.stringify({ ...project.scene, serverScripts: Object.keys(project.serverScripts) }) };
  for (const [name, src] of Object.entries(project.serverScripts)) files[`scripts/server/${name}.js`] = src;
  return files;
}

export const checkPanel = (project: Project): PanelSpec => ({ id: 'check', title: 'Check', create: () => createCheckPanel(project) });

export function createCheckPanel(project: Project): PanelView {
  const root = el('div', { class: 'lb-root' });
  const count = el('input', { type: 'number', min: '1', max: String(MAX_PHONES), value: '3', 'aria-label': 'Simulated phones' });
  const status = el('span', { class: 'lb-status', role: 'status' });
  const list = el('div', { class: 'lb-list' });
  const runBtn = button('Run simulated phones', () => {
    status.textContent = '';
    try {
      const r = runCheck(projectFiles(project), Number(count.value));
      status.textContent = r.ok ? 'Passed' : 'Failed';
      list.replaceChildren(...r.lines.map((l) => el('p', { class: r.ok ? 'lb-none' : 'lb-empty' }, [l])));
    } catch (e) {
      status.textContent = 'Failed';
      list.replaceChildren(el('p', { class: 'lb-empty' }, [`Could not run: ${e instanceof Error ? e.message : String(e)}`]));
    }
  }, { variant: 'small' });
  root.append(el('div', { class: 'lb-toolbar' }, [count, runBtn, status]), list);
  return { element: root, focus: () => runBtn.focus(), dispose() {} };
}
