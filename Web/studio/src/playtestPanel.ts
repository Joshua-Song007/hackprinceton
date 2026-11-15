// The Playtest panel: the one place for agent players. Choose how many players, who they are and how long, press Start, then watch
// every agent (what it is doing, what it did, said and heard) and read the report. Agents test the written instructions.
import type { PanelView } from './layout';
import { MARKETPLACE_PANEL_ID } from './marketplace/panel';
import { CALL_BUDGETS, CREWS, agentColorVar, DEFAULT_BUDGET, DEFAULT_CREW, PERSONA_LABELS, costText, logLine, readiness, startProblem, type CrewId } from './playtestPlan';
import { renderPlaytest } from './playtestView';
import type { Project } from './project';
import type { RunController } from './run';
import { button, el } from './ui';

const PAD = 'padding:4px 12px';

export function createPlaytestPanel(project: Project, run: RunController, sendToChat: (text: string) => string | undefined, openPanel: (id: string) => void): PanelView {
  const root = el('div', { class: 'pn', role: 'region', 'aria-label': 'Playtest', tabindex: -1 });
  const group = (t: string) => el('div', { class: 'pn-group' }, [t]);
  const intro = el('p', { class: 'om-sub', style: PAD }, ['Agents play your written instructions the way people in the room would: they only see and hear what is near them. In the Viewport each agent is a coloured figure with its name, what it is doing and, when walking, its target marked on the floor. They test the instructions, not your scripts.']);
  const body = el('div');
  root.append(intro, body);

  let showSetup = false;
  let players = 0;
  let crew: CrewId = DEFAULT_CREW;
  let calls = DEFAULT_BUDGET;
  let notice = '';
  let starting = false;
  const mode = (): 'setup' | 'live' | 'done' => {
    const pt = run.playtest;
    if (!pt) return 'setup';
    if (pt.state !== 'done') return 'live';
    return showSetup ? 'setup' : 'done';
  };

  const logBox = el('ul', { class: 'om-list', role: 'log', 'aria-live': 'off', 'aria-label': 'Play-by-play', style: 'max-height:240px;overflow:auto' });
  let logKey = '';
  const refreshLog = (): void => {
    const lines = run.playtestLog();
    const last = lines.at(-1);
    const key = `${lines.length}|${last ? `${last.entry.gameTime}${last.entry.text}` : ''}`;
    if (key === logKey) return;
    logKey = key;
    const atEnd = logBox.scrollTop + logBox.clientHeight >= logBox.scrollHeight - 4;
    logBox.replaceChildren(...(lines.length
      ? lines.map((l) => el('li', { class: l.entry.kind === 'problem' ? 'sheet-error' : 'om-sub', 'data-kind': l.entry.kind }, [logLine(l.entry, () => l.who)]))
      : [el('li', { class: 'om-sub' }, ['Nothing yet.'])]));
    if (atEnd) logBox.scrollTop = logBox.scrollHeight;
  };

  let setupRefresh: (() => void) | null = null;

  const setup = (): Node[] => {
    const limits = project.playerLimits();
    if (!players || players < limits.min || players > limits.max) players = Math.min(Math.max(players || limits.min, limits.min), limits.max);
    const playersInput = el('input', { type: 'number', min: limits.min, max: limits.max, step: 1, 'aria-label': 'Number of players' });
    playersInput.value = String(players);
    const crewSelect = el('select', { 'aria-label': 'Who plays' }, CREWS.map((c) => el('option', { value: c.id }, [c.label])));
    crewSelect.value = crew;
    const budgetSelect = el('select', { 'aria-label': 'How long' }, CALL_BUDGETS.map((b) => el('option', { value: String(b.calls) }, [b.label])));
    budgetSelect.value = String(calls);
    const checklist = el('ul', { class: 'om-list', 'aria-label': 'Before you start' });
    const cost = el('p', { class: 'om-sub', style: PAD });
    const why = el('p', { class: 'om-sub', role: 'status', style: PAD });
    const start = button('Start playtest', () => void begin(), { variant: 'default' });
    let shownKey = '';
    const refresh = (): void => {
      const input = { hasInstructions: !!project.instructions, hasPlugin: run.agentsAvailable, limits: project.playerLimits(), players };
      const items = readiness(input);
      const problem = startProblem(input);
      const key = JSON.stringify([items, problem, notice, starting]);
      cost.textContent = costText(players, calls);
      if (key === shownKey) return;
      shownKey = key;
      checklist.replaceChildren(...items.map((i) => el('li', { class: 'om-sub', style: 'display:flex;gap:8px;align-items:center' }, [
        `${i.ok ? 'Ready' : 'Needed'}: ${i.label}.`,
        ...(!i.ok && i.id === 'instructions' ? [button('Open Instructions', () => openPanel('instructions'), { variant: 'small' })] : []),
        ...(!i.ok && i.id === 'plugin' ? [button('Open Marketplace', () => openPanel(MARKETPLACE_PANEL_ID), { variant: 'small' })] : []),
      ])));
      start.disabled = !!problem || starting;
      why.textContent = notice || problem || '';
    };
    const begin = async (): Promise<void> => {
      starting = true;
      notice = '';
      refresh();
      try {
        const problem = await run.startPlaytest({ players, crew, calls });
        if (problem) notice = problem;
        else showSetup = false;
      } catch (e) {
        notice = e instanceof Error ? e.message : String(e);
      } finally {
        starting = false;
      }
      render();
    };
    playersInput.addEventListener('input', () => { players = Math.round(Number(playersInput.value)); refresh(); });
    crewSelect.addEventListener('change', () => { crew = crewSelect.value as CrewId; });
    budgetSelect.addEventListener('change', () => { calls = Number(budgetSelect.value); refresh(); });
    const field = (label: string, control: HTMLElement) => el('label', { style: `display:grid;gap:2px;${PAD}` }, [label, control]);
    refresh();
    setupRefresh = refresh;
    return [
      group('Before you start'), checklist,
      group('Playtest'),
      field('Players', playersInput), field('Who plays', crewSelect), field('How long', budgetSelect),
      cost, el('div', { style: PAD }, [start]), why,
    ];
  };

  const cards = el('ul', { class: 'om-list', 'aria-label': 'Agents' });
  const cardRefs = new Map<string, { doing: HTMLElement; calls: HTMLElement; say: HTMLElement }>();
  let cardKey = '';
  const statusLine = el('p', { class: 'om-sub', role: 'status', style: PAD });
  const stop = button('Stop and see report', () => void run.finishPlaytest().then((m) => { notice = m ?? ''; }), { variant: 'default' });
  const watch = button('Watch in Viewport', () => openPanel('viewport'), { variant: 'small', ariaLabel: 'Watch in Viewport: show the agents moving in the scene' });
  const refreshLive = (): void => {
    const agents = run.players.filter((p) => p.agent);
    const key = agents.map((p) => `${p.id}:${p.agent!.seat.persona}:${p.agent!.seat.role}`).join('|');
    if (key !== cardKey) {
      cardKey = key;
      cardRefs.clear();
      const roles = project.instructions?.roles ?? [];
      cards.replaceChildren(...agents.map((p) => {
        const d = p.agent!;
        const refs = { doing: el('span'), calls: el('span'), say: el('span') };
        cardRefs.set(p.id, refs);
        const roleName = roles.find((r) => r.id === d.seat.role)?.name;
        return el('li', { style: 'display:grid;gap:2px;padding:6px 12px' }, [
          el('strong', {}, [el('span', { class: 'pt-dot', style: `background:var(${agentColorVar(run.players.indexOf(p))})`, 'aria-hidden': 'true' }), roleName ? `${p.name} (${roleName})` : p.name]),
          el('span', { class: 'om-sub' }, [PERSONA_LABELS[d.seat.persona]]),
          refs.doing, refs.calls, refs.say,
          el('div', {}, [button('Take over', () => run.drive(p.id), { variant: 'small', ariaLabel: `Take over ${p.name}: drive this player yourself` })]),
        ]);
      }));
    }
    let thinking = 0;
    for (const p of agents) {
      const d = p.agent!;
      if (d.status === 'thinking') thinking++;
      const refs = cardRefs.get(p.id);
      if (!refs) continue;
      refs.doing.textContent = `Now: ${d.doing}`;
      refs.calls.textContent = `Decisions: ${d.calls} of ${d.callLimit}`;
      refs.say.textContent = d.lastSay ? `Last said: "${d.lastSay}"` : '';
    }
    const finishing = run.playtest?.state === 'finishing';
    statusLine.textContent = `${Math.round(run.gameTime())} s of game time, ${agents.length} ${agents.length === 1 ? 'agent' : 'agents'}. ${finishing ? 'Asking the agents to look back.' : thinking ? `${thinking} thinking: the world is paused until they answer.` : 'The world runs while the agents act.'}${notice ? ` ${notice}` : ''}`;
    stop.disabled = finishing;
  };

  let shownMode = '';
  let shownReport: unknown;
  const render = (): void => {
    const m = mode();
    shownMode = m;
    shownReport = run.report;
    setupRefresh = null;
    cardKey = '';
    logKey = '';
    if (m === 'setup') return body.replaceChildren(...setup());
    if (m === 'live') {
      refreshLive();
      body.replaceChildren(group('Playtest running'), statusLine, el('div', { style: `${PAD};display:flex;gap:8px;align-items:center` }, [stop, watch]), cards, group('Play-by-play (also printed in the Console)'), logBox);
      refreshLog();
      return;
    }
    const again = button('Run again', () => { showSetup = true; notice = ''; render(); }, { variant: 'small' });
    body.replaceChildren(
      group('Playtest finished'),
      run.report ? renderPlaytest(run.report, sendToChat) : el('p', { class: 'pn-empty' }, ['The playtest stopped before there was anything to report.']),
      el('div', { style: PAD }, [again]),
      group('Play-by-play (also printed in the Console)'), logBox,
    );
    refreshLog();
  };

  const tick = (): void => {
    if (mode() !== shownMode || (shownMode === 'done' && run.report !== shownReport)) return render();
    if (shownMode === 'setup') setupRefresh?.();
    else if (shownMode === 'live') refreshLive();
    if (shownMode !== 'setup') refreshLog();
  };
  const timer = setInterval(tick, 250);
  const offRun = run.onChange(tick);
  const offProject = project.onChange(() => tick());
  render();
  return {
    element: root,
    focus: () => (root.querySelector<HTMLElement>('input, select, button:not(:disabled)') ?? root).focus(),
    dispose: () => { clearInterval(timer); offRun(); offProject(); },
  };
}
