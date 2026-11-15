// File > New game from prompt: a prompt goes to the Deep Agent runtime in game mode (Plugins/langchain-deepagents server.py),
// every agent step and Pear MCP tool call streams into the Live Preview terminal, and the created game opens in Live Preview.
import { sysRow, type LogLevel, type LogRow } from './livePreview/helpers';
import { button, el, openSheet } from './ui';

export const MAX_ITERATIONS = 6;
const NO_PLUGIN = 'Install the Deep Agent plugin first.';
const OFFLINE = 'The Deep Agent runtime is offline. Start it (or install the plugin from the marketplace) and try again.';
const NO_KEY = 'No model API key: add one in the marketplace panel (Model key), then try again.';
type Row = Omit<LogRow, 'id'>;

export interface PromptGameResult {
  gameId: string | null;
  summary: string;
  /** Why the run did not end cleanly (shown to the user); null when the last scenario passed. */
  problem: string | null;
  /** The error was the missing model key, so the sheet offers a link to the setting. */
  needsKey: boolean;
}

const short = (v: unknown, n = 300): string => {
  const t = typeof v === 'string' ? v : JSON.stringify(v) ?? '';
  return t.length > n ? `${t.slice(0, n)}...` : t;
};

/** The `report.ok` of a run_scenario result, null when the text does not say. */
export function scenarioOk(text: string): boolean | null {
  try {
    const j = JSON.parse(text) as { report?: { ok?: unknown }; ok?: unknown };
    const v = j.report?.ok ?? j.ok;
    if (typeof v === 'boolean') return v;
  } catch { /* not JSON: fall through to the text match */ }
  const m = /"ok"\s*:\s*(true|false)/.exec(text);
  return m ? m[1] === 'true' : null;
}

/** The game id in a create_game result (JSON with an id), null for anything else. */
export function createdGameId(text: string): string | null {
  try {
    const id = (JSON.parse(text) as { id?: unknown }).id;
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
}

/** Terminal rows for one runtime message ([] for kinds the terminal does not show). */
export function gameRows(msg: Record<string, unknown>, t = Date.now()): Row[] {
  const row = (name: string, text: string, level: LogLevel = 'log', dir: Row['dir'] = 'out'): Row => ({ t, source: 'agent', dir, name, text, level });
  switch (msg.type) {
    case 'tool_call': return [row(String(msg.name), short(msg.args))];
    case 'tool_result': {
      const name = String(msg.name);
      const text = String(msg.text ?? '');
      const ok = name === 'run_scenario' ? scenarioOk(text) : null;
      const failed = msg.ok === false || ok === false;
      return [row(name, `${ok === null ? '' : ok ? 'PASS: ' : 'FAIL: '}${short(text, 600)}`, failed ? 'error' : 'log', 'in')];
    }
    case 'todos': return [row('todos', ((msg.items as { content: string; status: string }[] | undefined) ?? []).map((i) => `[${i.status}] ${i.content}`).join('; '), 'log', 'sys')];
    case 'subagent_status': return [row(String(msg.name), `${msg.state} ${short(msg.detail ?? '', 200)}`.trim(), msg.state === 'error' ? 'error' : 'log', 'sys')];
    case 'file_written': return [row('file', String(msg.path), 'log', 'sys')];
    case 'done': return [row('done', short(msg.summary ?? '', 600), 'log', 'sys')];
    case 'error': return [row('error', String(msg.message), 'error', 'sys')];
    default: return [];
  }
}

export interface RunOptions {
  /** The runtime's /ws URL, null when the plugin is not installed. */
  url: string | null;
  text: string;
  onRow(row: Row): void;
  WebSocketImpl?: typeof WebSocket;
  /** Called with the socket so the caller can stop the run (close it). */
  onSocket?(ws: WebSocket): void;
}

/** One game-mode prompt over a fresh socket; never rejects: offline, no key, error and a stopped agent all come back as `problem`. */
export function runGamePrompt(o: RunOptions): Promise<PromptGameResult> {
  const out = (over: Partial<PromptGameResult>): PromptGameResult => ({ gameId: null, summary: '', problem: null, needsKey: false, ...over });
  if (!o.url) return Promise.resolve(out({ problem: NO_PLUGIN }));
  const Socket = o.WebSocketImpl ?? WebSocket;
  return new Promise((resolve) => {
    let ws: WebSocket;
    try {
      ws = new Socket(o.url!);
    } catch {
      return resolve(out({ problem: OFFLINE }));
    }
    o.onSocket?.(ws);
    let opened = false;
    let finished = false;
    let gameId: string | null = null;
    let runs = 0;
    let lastOk: boolean | null = null;
    const finish = (r: PromptGameResult) => {
      if (finished) return;
      finished = true;
      try { ws.close(); } catch { /* already closed */ }
      resolve(r);
    };
    ws.onopen = () => {
      opened = true;
      ws.send(JSON.stringify({ type: 'prompt', mode: 'game', id: 'game-1', text: o.text, project: {} }));
    };
    ws.onmessage = (ev) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(String(ev.data)) as Record<string, unknown>; } catch { return; }
      gameRows(msg).forEach(o.onRow);
      if (msg.type === 'tool_result') {
        const text = String(msg.text ?? '');
        if (msg.name === 'create_game') gameId = createdGameId(text) ?? gameId;
        if (msg.name === 'run_scenario') { runs += 1; lastOk = scenarioOk(text); }
      } else if (msg.type === 'error') {
        const message = String(msg.message);
        finish(out({ gameId, problem: message, needsKey: message.startsWith('No model API key') }));
      } else if (msg.type === 'done') {
        const problem = lastOk === true ? null
          : runs >= MAX_ITERATIONS ? `The agent stopped after ${MAX_ITERATIONS} iterations and the scenario still fails; the game is saved as is.`
          : runs > 0 ? 'The agent finished but the scenario still fails; check the terminal.'
          : gameId ? 'The agent finished without a passing scenario run; check the terminal.' : 'The agent finished without creating a game.';
        finish(out({ gameId, summary: String(msg.summary ?? ''), problem }));
      }
    };
    ws.onerror = () => finish(out({ gameId, problem: opened ? 'The Deep Agent connection failed.' : OFFLINE }));
    ws.onclose = () => finish(out({ gameId, problem: opened ? 'The Deep Agent runtime closed the connection before the agent finished.' : OFFLINE }));
  });
}

export interface PromptGameDeps {
  url(): string | null;
  /** Shows a row in the Live Preview terminal. */
  log(row: Row): void;
  /** Opens Live Preview and puts the created game in it. */
  openGame(gameId: string): Promise<void> | void;
  /** Opens the setting where the model key is stored. */
  openModelKey(): void;
}

export function openPromptGameSheet(deps: PromptGameDeps, WebSocketImpl?: typeof WebSocket): void {
  openSheet('New game from prompt', (body, close) => {
    const text = el('textarea', { rows: '5', 'aria-label': 'Describe the game', placeholder: 'e.g. A two-team capture the flag in a park: grab the other flag, bring it home, tagged players freeze for 10 s.' }) as HTMLTextAreaElement;
    const status = el('p', { class: 'sheet-note', role: 'status' });
    const error = el('p', { class: 'sheet-error', role: 'alert' });
    const keyLink = button('Open the model key setting', () => { close(); deps.openModelKey(); }, { variant: 'borderless' });
    keyLink.hidden = true;
    let socket: WebSocket | null = null;
    const start = button('Create game', async () => {
      const prompt = text.value.trim();
      error.textContent = '';
      keyLink.hidden = true;
      if (!prompt) { error.textContent = 'Describe the game first.'; return; }
      start.disabled = true;
      text.disabled = true;
      status.textContent = 'The agent is working. Every step shows in the Live Preview terminal.';
      deps.log(sysRow('agent', `New game from prompt: ${prompt}`));
      const r = await runGamePrompt({ url: deps.url(), text: prompt, onRow: (row) => { deps.log(row); status.textContent = `${row.name}: ${row.text}`.slice(0, 160); }, WebSocketImpl, onSocket: (ws) => { socket = ws; } });
      socket = null;
      if (r.gameId) await deps.openGame(r.gameId);
      if (!r.problem) { close(); return; }
      deps.log(sysRow('agent', r.problem, 'warn'));
      error.textContent = r.needsKey ? NO_KEY : r.problem;
      keyLink.hidden = !r.needsKey;
      status.textContent = r.gameId ? 'The game was opened in Live Preview.' : '';
      start.disabled = false;
      text.disabled = false;
    });
    const stop = button('Close', () => { try { socket?.close(); } catch { /* closed */ } close(); });
    body.append(
      el('div', { class: 'om-prop' }, [el('label', {}, ['Prompt']), el('div', { class: 'om-field' }, [text])]),
      status, error, keyLink,
      el('div', { class: 'sheet-actions' }, [start, stop]),
    );
    text.focus();
  });
}
