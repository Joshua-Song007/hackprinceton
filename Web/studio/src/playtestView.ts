// The playtest report as page elements: summary, one row per agent player, the notes by phase, run problems, and Send to chat.
import { playtestLines, playtestPrompt, sendReport, type PlaytestReport } from './playtestReport';
import { button, el } from './ui';

/** `sendToChat` puts the prompt into the Deep Agent chat and returns a sentence when it cannot. */
export function renderPlaytest(report: PlaytestReport, sendToChat: (text: string) => string | undefined): HTMLElement {
  const lines = playtestLines(report);
  const result = el('p', { class: 'om-sub', role: 'status' });
  const send = button('Fix with Deep Agent', () => { result.textContent = sendReport(report, sendToChat); }, { variant: 'small', ariaLabel: 'Fix with Deep Agent: put the playtest notes in the chat to revise the instructions' });
  send.disabled = !playtestPrompt(report);
  return el('div', { class: 'pn-playtest', role: 'region', 'aria-label': 'Playtest report' }, [
    el('p', { class: 'om-sub' }, [lines.summary]),
    el('ul', { class: 'om-list', 'aria-label': 'Agent players' }, lines.players.map((t) => el('li', { class: 'om-sub' }, [t]))),
    ...(lines.empty ? [el('p', { class: 'pn-empty' }, [lines.empty])] : []),
    ...lines.groups.flatMap((g) => [el('div', { class: 'pn-group' }, [g.title]), el('ul', { class: 'om-list', 'aria-label': g.title }, g.items.map((t) => el('li', { class: 'om-sub' }, [t])))]),
    ...(lines.problems.length ? [el('div', { class: 'pn-group' }, ['Run problems']), el('ul', { class: 'om-list', 'aria-label': 'Run problems' }, lines.problems.map((t) => el('li', { class: 'om-sub' }, [t])))] : []),
    el('div', { style: 'padding:4px 12px' }, [send]),
    result,
  ]);
}
