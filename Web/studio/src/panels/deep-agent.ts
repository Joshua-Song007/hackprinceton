// Deep Agent panel: prompt -> runtime WebSocket, live todos, subagent status, and generated scripts and scene edits written into the Project.
// Protocol: Plugins/langchain-deepagents (every runtime message carries the id of the prompt it answers).
import type { ScriptRef } from '../editor';
import type { PanelSpec, PanelView } from '../layout';
import { SCRIPT_NAME, type Project } from '../project';
import { button, el } from '../ui';
import './deep-agent.css';

interface TodoItem { content: string; status: 'pending' | 'in_progress' | 'completed' }
interface AgentRow { state: string; detail: string }
interface FileLink { path: string; ref: ScriptRef | null; note?: string; proposal?: string }
type Mode = 'scripts' | 'instructions';

type RuntimeMessage =
  | { type: 'todos'; id: string; items: TodoItem[] }
  | { type: 'subagent_status'; id: string; name: string; state: string; detail?: string }
  | { type: 'file_written'; id: string; path: string; content: string }
  | { type: 'done'; id: string; summary?: string }
  | { type: 'error'; id: string; message: string };

/** How the rest of Studio puts text into the chat's prompt (the panel attaches itself while it is open). */
export interface ChatLink {
  /** Fills the prompt in Instructions mode without sending it. Returns a sentence when there is no panel to fill. */
  send(text: string): string | undefined;
  attach(fill: (text: string) => void): () => void;
}

export function createChatLink(): ChatLink {
  let fill: ((text: string) => void) | null = null;
  return {
    send(text) {
      if (!fill) return 'Open the Deep Agent panel first.';
      fill(text);
      return undefined;
    },
    attach(f) {
      fill = f;
      return () => { if (fill === f) fill = null; };
    },
  };
}

export interface DeepAgentOptions {
  url: string;
  project: Project;
  openScript(ref: ScriptRef): void;
  chat?: ChatLink;
  WebSocketImpl?: typeof WebSocket;
}

const OPEN = 1;
const STATUS_LABEL: Record<TodoItem['status'], string> = { pending: 'Pending', in_progress: 'In progress', completed: 'Completed' };
const RETRY_MIN_MS = 500;
const RETRY_MAX_MS = 10_000;
const PLACEHOLDER: Record<Mode, string> = { scripts: 'Describe the game or script you want', instructions: 'Describe how the game is played, or what to change in its instructions' };
const SCRIPT_PATH = /^scripts\/([^/]+)\.(client|server)\.js$/;

/** scripts/<name>.client.js -> client <name>; scripts/<name>.server.js -> server <name>; anything else is not a Project script. */
function scriptRef(path: string): ScriptRef | null {
  const m = SCRIPT_PATH.exec(path);
  return m && SCRIPT_NAME.test(m[1]!) ? { kind: m[2] as ScriptRef['kind'], name: m[1]! } : null;
}

export function deepAgentPanel(opts: DeepAgentOptions): PanelSpec {
  return { id: 'panel.deepagents', title: 'Deep Agent', create: () => createView(opts) };
}

function createView({ url, project, openScript, chat, WebSocketImpl }: DeepAgentOptions): PanelView {
  const Socket = WebSocketImpl ?? WebSocket;
  let socket: WebSocket | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retries = 0;
  let disposed = false;
  let promptCount = 0;
  let currentId: string | null = null;
  let connection = 'Connecting';
  let run = '';
  let errors: string[] = [];
  let todos: TodoItem[] = [];
  const agents = new Map<string, AgentRow>();
  let files: FileLink[] = [];
  let mode: Mode = 'scripts';
  /** The mode of the prompt in flight: an instructions run applies only instructions.json. */
  let runMode: Mode = 'scripts';
  let pendingFile: FileLink | null = null;

  const unreachable = `Cannot reach the Deep Agent runtime at ${url}.`;
  const promptId = 'deep-agent-prompt';
  const input = el('textarea', { id: promptId, rows: 4, placeholder: PLACEHOLDER.scripts });
  const modeId = 'deep-agent-mode';
  const modeSelect = el('select', { id: modeId, 'aria-label': 'Mode' }, [el('option', { value: 'scripts' }, ['Scripts']), el('option', { value: 'instructions' }, ['Instructions'])]);
  modeSelect.addEventListener('change', () => {
    mode = modeSelect.value === 'instructions' ? 'instructions' : 'scripts';
    input.setAttribute('placeholder', PLACEHOLDER[mode]);
  });
  const send = button('Send', () => submit());
  send.classList.add('om-btn--default');
  send.setAttribute('aria-keyshortcuts', 'Control+Enter Meta+Enter');
  const status = el('p', { class: 'da-status', role: 'status', 'aria-live': 'polite' });
  const alerts = el('div', { class: 'da-errors', role: 'alert' });
  const todoList = el('ul', { class: 'da-list', 'aria-label': 'Todos' });
  const agentList = el('ul', { class: 'da-list', 'aria-label': 'Subagents' });
  const fileList = el('ul', { class: 'da-list', 'aria-label': 'Files' });
  const element = el('div', { class: 'deep-agent' }, [
    status,
    alerts,
    el('label', { for: modeId }, ['Mode']),
    modeSelect,
    el('label', { for: promptId }, ['Prompt']),
    input,
    send,
    el('h3', {}, ['Todos']),
    todoList,
    el('h3', {}, ['Subagents']),
    agentList,
    el('h3', {}, ['Files']),
    fileList,
  ]);

  const decide = (f: FileLink, accept: boolean) => {
    if (accept) project.acceptProposal();
    else project.rejectProposal();
    f.note = accept ? 'accepted' : 'rejected';
    if (pendingFile === f) pendingFile = null;
    render();
  };

  const render = () => {
    status.textContent = run ? `${connection}. ${run}` : connection;
    alerts.replaceChildren(...errors.map((e) => el('p', {}, [`Error: ${e}`])));
    todoList.replaceChildren(...todos.map((t) => el('li', { 'data-status': t.status }, [`${STATUS_LABEL[t.status] ?? t.status}: ${t.content}`])));
    agentList.replaceChildren(...[...agents].map(([name, a]) => el('li', { 'data-state': a.state }, [`${name}: ${a.state}${a.detail ? ` (${a.detail})` : ''}`])));
    fileList.replaceChildren(
      ...files.map((f) => {
        if (f.proposal !== undefined && f === pendingFile && project.proposal) {
          return el('li', {}, [`${f.path} (proposed: ${f.proposal}) `, button('Accept', () => decide(f, true), { variant: 'small' }), button('Reject', () => decide(f, false), { variant: 'small' })]);
        }
        const label = f.ref ? `${f.path} (open in editor)` : `${f.path} (${f.note ?? 'not a Studio script'})`;
        return el('li', {}, [f.ref ? button(label, () => openScript(f.ref!), { variant: 'borderless' }) : label]);
      }),
    );
  };

  const connect = () => {
    if (disposed) return;
    connection = 'Connecting';
    render();
    const ws = new Socket(url);
    socket = ws;
    ws.onopen = () => {
      retries = 0;
      errors = errors.filter((e) => e !== unreachable);
      connection = 'Connected';
      render();
    };
    ws.onmessage = (e) => handle(String(e.data));
    ws.onerror = () => {
      if (!errors.includes(unreachable)) errors.push(unreachable);
      render();
    };
    ws.onclose = () => {
      if (disposed || socket !== ws) return;
      const delay = Math.min(RETRY_MIN_MS * 2 ** retries++, RETRY_MAX_MS);
      connection = `Disconnected, retrying in ${Math.round(delay / 1000)} s`;
      render();
      retryTimer = setTimeout(connect, delay);
    };
  };

  const submit = () => {
    const text = input.value.trim();
    if (!text) {
      errors = ['Write a prompt before sending.'];
      render();
      return;
    }
    if (!socket || socket.readyState !== OPEN) {
      errors = ['Not connected to the Deep Agent runtime yet.'];
      render();
      return;
    }
    currentId = `p${Date.now().toString(36)}-${++promptCount}`;
    todos = [];
    agents.clear();
    files = [];
    errors = [];
    runMode = mode;
    run = 'Working';
    input.value = '';
    const scripts = (['client', 'server'] as const).flatMap((kind) => Object.entries(project.scripts(kind)).map(([name, source]) => ({ kind, name, source })));
    socket.send(JSON.stringify({ type: 'prompt', id: currentId, text, mode, project: { scene: project.scene, scripts, peripherals: [], instructions: project.instructions } }));
    render();
  };

  const handle = (raw: string) => {
    let msg: RuntimeMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || currentId === null || msg.id !== currentId) return;
    switch (msg.type) {
      case 'todos':
        todos = msg.items;
        break;
      case 'subagent_status':
        agents.set(msg.name, { state: msg.state, detail: msg.detail ?? '' });
        break;
      case 'file_written': {
        if (msg.path === 'instructions.json') {
          let problem: string | undefined;
          try {
            problem = project.propose(JSON.parse(msg.content));
          } catch (e) {
            problem = e instanceof Error ? e.message : String(e);
          }
          if (problem) errors.push(`instructions.json not applied: ${problem}`);
          const p = project.proposal;
          const entry: FileLink = problem || !p
            ? { path: msg.path, ref: null, note: 'not applied' }
            : { path: msg.path, ref: null, proposal: `${p.title || 'untitled'}, ${p.roles.length} roles, ${p.phases.length} phases` };
          if (pendingFile && !problem) pendingFile.note = 'replaced by a newer proposal';
          if (!problem) pendingFile = entry;
          files.push(entry);
          break;
        }
        if (runMode === 'instructions') {
          files.push({ path: msg.path, ref: null, note: 'ignored: this was an instructions run' });
          break;
        }
        if (msg.path === 'scene.json') {
          let problem: string | undefined;
          try {
            problem = project.setScene(JSON.parse(msg.content));
          } catch (e) {
            problem = e instanceof Error ? e.message : String(e);
          }
          if (problem) errors.push(`scene.json not applied: ${problem}`);
          files.push({ path: msg.path, ref: null, note: problem ? 'not applied' : 'applied to the scene' });
          break;
        }
        const ref = scriptRef(msg.path);
        if (ref) {
          if (!Object.hasOwn(project.scripts(ref.kind), ref.name)) project.addScript(ref.kind, ref.name);
          project.setScript(ref.kind, ref.name, msg.content);
        }
        files.push({ path: msg.path, ref });
        break;
      }
      case 'done':
        run = msg.summary ? `Done: ${msg.summary}` : 'Done';
        break;
      case 'error':
        errors.push(msg.message);
        run = 'Stopped by an error';
        break;
      default:
        return;
    }
    render();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit();
    }
  });

  const offProject = project.onChange((c) => { if (c === 'proposal') render(); });
  const offChat = chat?.attach((text) => {
    mode = 'instructions';
    modeSelect.value = 'instructions';
    input.setAttribute('placeholder', PLACEHOLDER[mode]);
    input.value = text;
    input.focus();
  });
  render();
  connect();

  return {
    element,
    focus: () => input.focus(),
    dispose: () => {
      disposed = true;
      offProject();
      offChat?.();
      clearTimeout(retryTimer);
      socket?.close();
    },
  };
}
