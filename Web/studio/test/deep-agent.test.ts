import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createChatLink, deepAgentPanel, type ChatLink } from '../src/panels/deep-agent';
import { Project, templateSnapshot } from '../src/project';
import type { ScriptRef } from '../src/editor';

// The suite runs in a node environment, so this is the smallest DOM the panel needs.
class FakeNode {
  children: (FakeNode | string)[] = [];
  attrs: Record<string, string> = {};
  listeners: Record<string, ((e: unknown) => void)[]> = {};
  classList = { add: (c: string) => this.setAttribute('class', `${this.attrs.class ?? ''} ${c}`.trim()) };
  value = '';
  hidden = false;
  disabled = false;
  private text: string | null = null;
  constructor(readonly tag: string) {}
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  append(...c: (FakeNode | string)[]) { this.children.push(...c); }
  replaceChildren(...c: (FakeNode | string)[]) { this.children = c; this.text = null; }
  addEventListener(t: string, fn: (e: unknown) => void) { (this.listeners[t] ??= []).push(fn); }
  focus() {}
  set textContent(v: string) { this.text = v; this.children = []; }
  get textContent(): string { return this.text ?? this.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join(''); }
  fire(type: string, e: object = {}) { for (const fn of this.listeners[type] ?? []) fn(e); }
  find(pred: (n: FakeNode) => boolean): FakeNode[] {
    return this.children.flatMap((c) => (typeof c === 'string' ? [] : [...(pred(c) ? [c] : []), ...c.find(pred)]));
  }
  byLabel(label: string) { return this.find((n) => n.attrs['aria-label'] === label)[0]!; }
  buttons() { return this.find((n) => n.tag === 'button'); }
}

class MockSocket {
  static instances: MockSocket[] = [];
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) { MockSocket.instances.push(this); }
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.closed = true; this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(); }
  drop() { this.readyState = 3; this.onclose?.(); }
  push(msg: object) { this.onmessage?.({ data: JSON.stringify(msg) }); }
}

function setup(chat?: ChatLink) {
  const project = new Project(templateSnapshot('blank'));
  const opened: ScriptRef[] = [];
  const spec = deepAgentPanel({ url: 'ws://localhost:9410/ws', project, openScript: (r) => opened.push(r), chat, WebSocketImpl: MockSocket as unknown as typeof WebSocket });
  const view = spec.create();
  const root = view.element as unknown as FakeNode;
  const ws = MockSocket.instances.at(-1)!;
  ws.open();
  const prompt = (text: string) => {
    root.find((n) => n.tag === 'textarea')[0]!.value = text;
    root.buttons().find((b) => b.textContent === 'Send')!.fire('click');
    return ws.sent.at(-1)!.id as string;
  };
  return { project, opened, spec, view, root, ws, prompt };
}

describe('deep-agent.ts', () => {
  beforeEach(() => {
    MockSocket.instances = [];
    (globalThis as { document?: unknown }).document = { createElement: (tag: string) => new FakeNode(tag), getElementById: () => null };
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as { document?: unknown }).document;
  });

  it('has the stable panel id and title', () => {
    const { spec } = setup();
    expect([spec.id, spec.title]).toEqual(['panel.deepagents', 'Deep Agent']);
  });

  it('sends the project snapshot and shows todos and subagent status from the runtime', () => {
    const { root, ws, prompt, project } = setup();
    const id = prompt('make a cube');
    expect(ws.sent[0]).toMatchObject({ type: 'prompt', text: 'make a cube', project: { scene: project.scene, peripherals: [] } });
    ws.push({ type: 'todos', id, items: [{ content: 'plan', status: 'completed' }, { content: 'write client', status: 'in_progress' }, { content: 'write server', status: 'pending' }] });
    ws.push({ type: 'subagent_status', id, name: 'client-js', state: 'running', detail: 'cube' });
    ws.push({ type: 'subagent_status', id, name: 'server-js', state: 'started', detail: '' });
    const todos = root.byLabel('Todos').textContent;
    expect(todos).toContain('Completed: plan');
    expect(todos).toContain('In progress: write client');
    expect(todos).toContain('Pending: write server');
    expect(root.byLabel('Subagents').textContent).toContain('client-js: running (cube)');
    expect(root.byLabel('Subagents').textContent).toContain('server-js: started');
    ws.push({ type: 'subagent_status', id, name: 'client-js', state: 'done' });
    expect(root.byLabel('Subagents').textContent).toContain('client-js: done');
  });

  it('writes file_written scripts into the Project and the link opens the right script', () => {
    const { root, ws, prompt, project, opened } = setup();
    const id = prompt('go');
    const changes: string[] = [];
    project.onChange((c) => changes.push(c));
    ws.push({ type: 'file_written', id, path: 'scripts/cube.client.js', content: 'export default script({})' });
    ws.push({ type: 'file_written', id, path: 'scripts/tags.server.js', content: 'export default serverScript({})' });
    ws.push({ type: 'file_written', id, path: 'notes/readme.md', content: '# hi' });
    ws.push({ type: 'done', id, summary: 'all good' });
    expect(project.clientScripts.cube).toBe('export default script({})');
    expect(project.serverScripts.tags).toBe('export default serverScript({})');
    expect(project.scene.clientScripts).toContain('cube');
    expect(project.scene.serverScripts).toContain('tags');
    expect(changes).toContain('script');
    expect(Object.keys(project.clientScripts)).not.toContain('readme');
    const links = root.byLabel('Files').buttons();
    expect(links).toHaveLength(2);
    links[0]!.fire('click');
    links[1]!.fire('click');
    expect(opened).toEqual([{ kind: 'client', name: 'cube' }, { kind: 'server', name: 'tags' }]);
    expect(root.byLabel('Files').textContent).toContain('notes/readme.md');
    expect(root.find((n) => n.attrs.role === 'status')[0]!.textContent).toContain('Done: all good');
  });

  it('applies an agent scene.json as one undoable step, keeping the project script lists', () => {
    const { root, ws, prompt, project } = setup();
    const id = prompt('add a sphere');
    const before = structuredClone(project.scene);
    const scene = { ...structuredClone(project.scene), clientScripts: [], entities: [...(project.scene.entities as unknown[]), { name: 'Sphere', shape: 'sphere', position: [1.5, 1.2, -3] }] };
    ws.push({ type: 'file_written', id, path: 'scene.json', content: JSON.stringify(scene) });
    expect((project.scene.entities as { name: string }[]).map((e) => e.name)).toContain('Sphere');
    expect(project.scene.clientScripts).toEqual(Object.keys(project.clientScripts));
    expect(root.byLabel('Files').textContent).toContain('scene.json (applied to the scene)');
    project.undo();
    expect(project.scene).toEqual(before);
  });

  it('rejects an invalid or unparsable scene.json without touching the scene', () => {
    const { root, ws, prompt, project } = setup();
    const id = prompt('break it');
    const before = structuredClone(project.scene);
    ws.push({ type: 'file_written', id, path: 'scene.json', content: JSON.stringify({ ...project.scene, requiredTier: 9 }) });
    ws.push({ type: 'file_written', id, path: 'scene.json', content: '{ not json' });
    expect(project.scene).toEqual(before);
    expect(project.canUndo).toBe(false);
    const alerts = root.find((n) => n.attrs.role === 'alert')[0]!.textContent;
    expect(alerts.match(/scene.json not applied/g)).toHaveLength(2);
    expect(root.byLabel('Files').textContent).toContain('scene.json (not applied)');
  });

  it('updates an existing script instead of failing on the duplicate name', () => {
    const { ws, prompt, project } = setup();
    const id = prompt('go');
    ws.push({ type: 'file_written', id, path: 'scripts/cube.client.js', content: 'v1' });
    ws.push({ type: 'file_written', id, path: 'scripts/cube.client.js', content: 'v2' });
    expect(project.clientScripts.cube).toBe('v2');
  });

  it('shows error events and ignores messages with a stale id', () => {
    const { root, ws, prompt, project } = setup();
    const first = prompt('one');
    const second = prompt('two');
    expect(second).not.toBe(first);
    ws.push({ type: 'todos', id: first, items: [{ content: 'stale todo', status: 'pending' }] });
    ws.push({ type: 'file_written', id: first, path: 'scripts/old.client.js', content: 'x' });
    expect(root.byLabel('Todos').textContent).toBe('');
    expect(project.clientScripts.old).toBeUndefined();
    ws.push({ type: 'error', id: second, message: 'model key missing' });
    expect(root.find((n) => n.attrs.role === 'alert')[0]!.textContent).toContain('model key missing');
  });

  it('adds a script named after an Object.prototype key instead of treating it as existing', () => {
    const { ws, prompt, project } = setup();
    const id = prompt('go');
    const added = vi.spyOn(project, 'addScript');
    ws.push({ type: 'file_written', id, path: 'scripts/constructor.client.js', content: 'x' });
    expect(added).toHaveBeenCalledWith('client', 'constructor');
    expect(Object.hasOwn(project.clientScripts, 'constructor')).toBe(true);
  });

  it('ignores every runtime message before any prompt was sent', () => {
    const { root, ws, project } = setup();
    for (const id of [null, undefined, 'p1']) {
      ws.push({ type: 'todos', id, items: [{ content: 'early todo', status: 'pending' }] });
      ws.push({ type: 'file_written', id, path: 'scripts/early.client.js', content: 'x' });
      ws.push({ type: 'error', id, message: 'early error' });
    }
    expect(root.byLabel('Todos').textContent).toBe('');
    expect(root.byLabel('Files').textContent).toBe('');
    expect(root.find((n) => n.attrs.role === 'alert')[0]!.textContent).toBe('');
    expect(project.clientScripts.early).toBeUndefined();
  });

  it('clears the textarea after a send and says so when the prompt is empty', () => {
    const { root, ws, prompt } = setup();
    const box = root.find((n) => n.tag === 'textarea')[0]!;
    box.value = '   ';
    root.buttons().find((b) => b.textContent === 'Send')!.fire('click');
    expect(ws.sent).toHaveLength(0);
    expect(root.find((n) => n.attrs.role === 'alert')[0]!.textContent).toContain('Write a prompt');
    prompt('make a cube');
    expect(ws.sent).toHaveLength(1);
    expect(box.value).toBe('');
    expect(root.find((n) => n.attrs.role === 'alert')[0]!.textContent).toBe('');
  });

  it('sends on Ctrl+Enter and not on plain Enter', () => {
    const { root, ws } = setup();
    const box = root.find((n) => n.tag === 'textarea')[0]!;
    box.value = 'hello';
    const prevented = vi.fn();
    box.fire('keydown', { key: 'Enter', preventDefault: prevented });
    expect(ws.sent).toHaveLength(0);
    box.fire('keydown', { key: 'Enter', ctrlKey: true, preventDefault: prevented });
    expect(ws.sent).toHaveLength(1);
  });

  it('reports connection errors, reconnects with backoff, and dispose closes the socket', () => {
    vi.useFakeTimers();
    const { root, ws, view } = setup();
    ws.onerror?.();
    expect(root.find((n) => n.attrs.role === 'alert')[0]!.textContent).toContain('Cannot reach');
    ws.drop();
    expect(root.find((n) => n.attrs.role === 'status')[0]!.textContent).toContain('retrying');
    expect(MockSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(500);
    expect(MockSocket.instances).toHaveLength(2);
    const second = MockSocket.instances[1]!;
    second.drop();
    vi.advanceTimersByTime(500);
    expect(MockSocket.instances).toHaveLength(2); // second wait doubled to 1 s
    vi.advanceTimersByTime(500);
    expect(MockSocket.instances).toHaveLength(3);
    const third = MockSocket.instances[2]!;
    third.open();
    expect(root.find((n) => n.attrs.role === 'status')[0]!.textContent).toContain('Connected');
    view.dispose!();
    expect(third.closed).toBe(true);
    third.drop();
    vi.advanceTimersByTime(60_000);
    expect(MockSocket.instances).toHaveLength(3);
  });
  describe('offline state', () => {
    const secretUrl = 'wss://runtime.example.test/agent/ws?token=SECRET123&project=local';
    const open = () => {
      const project = new Project(templateSnapshot('blank'));
      const view = deepAgentPanel({ url: secretUrl, project, openScript: () => {}, WebSocketImpl: MockSocket as unknown as typeof WebSocket }).create();
      const root = view.element as unknown as FakeNode;
      const send = () => root.buttons().find((b) => b.textContent === 'Send')!;
      const retry = () => root.buttons().find((b) => b.textContent === 'Retry now')!;
      return { root, ws: MockSocket.instances.at(-1)!, send, retry };
    };

    it('shows the host and never the token or the path', () => {
      const { root, ws } = open();
      ws.onerror?.();
      const text = root.find((n) => n.attrs.role === 'alert')[0]!.textContent;
      expect(text).toContain('runtime.example.test');
      expect(text).not.toContain('token');
      expect(text).not.toContain('SECRET123');
      expect(text).not.toContain('/agent/ws');
    });

    it('disables Send until the runtime is open and again once it drops', () => {
      vi.useFakeTimers();
      const { ws, send } = open();
      expect(send().disabled).toBe(true);
      ws.open();
      expect(send().disabled).toBe(false);
      ws.drop();
      expect(send().disabled).toBe(true);
    });

    it('offers Retry now only while waiting, and retrying connects at once with the backoff reset', () => {
      vi.useFakeTimers();
      const { root, ws, retry } = open();
      expect(retry().hidden).toBe(true);
      ws.drop();
      expect(retry().hidden).toBe(false);
      expect(root.find((n) => n.attrs.class === 'da-hint')[0]!.hidden).toBe(false);
      retry().fire('click');
      expect(MockSocket.instances).toHaveLength(2);
      expect(retry().hidden).toBe(true);
      MockSocket.instances[1]!.open();
      expect(retry().hidden).toBe(true);
    });

    it('hides the Todos, Subagents and Files headings until they have something to list', () => {
      const { root } = open();
      const heads = root.find((n) => n.tag === 'h3');
      expect(heads.map((h) => h.textContent)).toEqual(['Todos', 'Subagents', 'Files']);
      expect(heads.every((h) => h.hidden === true)).toBe(true);
    });
  });
  describe('instructions mode', () => {
    const instructions = { title: 'Quick Draw', players: { min: 3, max: 3 }, roles: [{ id: 'ref', kind: 'ref' }], phases: [{ id: 'draw', steps: [] }] };

    function instructionsRun(prompt: (t: string) => string, root: FakeNode) {
      const select = root.byLabel('Mode');
      select.value = 'instructions';
      select.fire('change');
      return prompt('a duel game');
    }

    it('sends the mode and the current instructions, and the mode follows the select', () => {
      const { root, ws, prompt, project } = setup();
      project.setInstructions({ ...instructions, title: 'Mine' } as never);
      const textarea = root.find((n) => n.tag === 'textarea')[0]!;
      expect(textarea.attrs.placeholder).toContain('Describe the game');
      prompt('first');
      expect(ws.sent[0]).toMatchObject({ mode: 'scripts', project: { instructions: { title: 'Mine' } } });
      instructionsRun(prompt, root);
      expect(ws.sent[1]).toMatchObject({ type: 'prompt', mode: 'instructions', text: 'a duel game', project: { instructions: { title: 'Mine' } } });
      expect(textarea.attrs.placeholder).toContain('instructions');
    });

    it('holds an instructions.json write as a proposal until Accept, then applies it as an undoable step', () => {
      const { root, ws, prompt, project } = setup();
      const id = instructionsRun(prompt, root);
      ws.push({ type: 'file_written', id, path: 'instructions.json', content: JSON.stringify(instructions) });
      expect(project.instructions).toBeNull();
      expect(project.proposal?.title).toBe('Quick Draw');
      const files = root.byLabel('Files');
      expect(files.textContent).toContain('instructions.json (proposed: Quick Draw, 1 roles, 1 phases)');
      expect(files.buttons().map((b) => b.textContent)).toEqual(['Accept', 'Reject']);
      files.buttons()[0]!.fire('click');
      expect(project.instructions?.title).toBe('Quick Draw');
      expect(project.proposal).toBeNull();
      expect(files.textContent).toContain('instructions.json (accepted)');
      expect(files.buttons()).toHaveLength(0);
      project.undo();
      expect(project.instructions).toBeNull();
    });

    it('Reject discards the proposal and a newer proposal replaces an older one', () => {
      const { root, ws, prompt, project } = setup();
      const id = instructionsRun(prompt, root);
      ws.push({ type: 'file_written', id, path: 'instructions.json', content: JSON.stringify({ title: 'First' }) });
      ws.push({ type: 'file_written', id, path: 'instructions.json', content: JSON.stringify({ title: 'Second' }) });
      const files = root.byLabel('Files');
      expect(files.textContent).toContain('instructions.json (replaced by a newer proposal)');
      expect(files.buttons()).toHaveLength(2);
      files.buttons()[1]!.fire('click');
      expect(project.proposal).toBeNull();
      expect(project.instructions).toBeNull();
      expect(files.textContent).toContain('instructions.json (rejected)');
    });

    it('shows a sentence when the file is not usable instructions', () => {
      const { root, ws, prompt, project } = setup();
      const id = instructionsRun(prompt, root);
      ws.push({ type: 'file_written', id, path: 'instructions.json', content: '{not json' });
      ws.push({ type: 'file_written', id, path: 'instructions.json', content: '5' });
      expect(project.proposal).toBeNull();
      expect(root.byLabel('Files').buttons()).toHaveLength(0);
      const alerts = root.find((n) => n.attrs.role === 'alert')[0]!.textContent;
      expect(alerts).toContain('instructions.json not applied:');
      expect(alerts).toContain('instructions: expected object');
    });

    it('applies no scripts or scene in an instructions run, but still does in a scripts run', () => {
      const { root, ws, prompt, project } = setup();
      const before = structuredClone(project.scene);
      const id = instructionsRun(prompt, root);
      ws.push({ type: 'file_written', id, path: 'scripts/sneaky.client.js', content: 'export default script({})' });
      ws.push({ type: 'file_written', id, path: 'scene.json', content: JSON.stringify({ name: 'Hacked', entities: [] }) });
      expect(Object.keys(project.clientScripts)).not.toContain('sneaky');
      expect(project.scene).toEqual(before);
      expect(root.byLabel('Files').textContent).toContain('scripts/sneaky.client.js (ignored: this was an instructions run)');
      const select = root.byLabel('Mode');
      select.value = 'scripts';
      select.fire('change');
      const next = prompt('now scripts');
      ws.push({ type: 'file_written', id: next, path: 'scripts/ok.client.js', content: 'export default script({})' });
      expect(Object.keys(project.clientScripts)).toContain('ok');
    });

    it('a proposal made elsewhere is accepted from the panel only while it is still pending', () => {
      const { root, ws, prompt, project } = setup();
      const id = instructionsRun(prompt, root);
      ws.push({ type: 'file_written', id, path: 'instructions.json', content: JSON.stringify(instructions) });
      project.rejectProposal();
      expect(root.byLabel('Files').buttons()).toHaveLength(0);
    });
  });

  describe('chat link', () => {
    it('fills the prompt in Instructions mode without sending, and a prompt sent after goes as an instructions run', () => {
      const chat = createChatLink();
      const { root, ws, project } = setup(chat);
      project.setInstructions({ title: 'Mine', players: { min: 1, max: 1 }, roles: [], phases: [] } as never);
      expect(chat.send('fix these')).toBeUndefined();
      expect(root.find((n) => n.tag === 'textarea')[0]!.value).toBe('fix these');
      expect(root.byLabel('Mode').value).toBe('instructions');
      expect(root.find((n) => n.tag === 'textarea')[0]!.attrs.placeholder).toContain('instructions');
      expect(ws.sent).toHaveLength(0);
      root.buttons().find((b) => b.textContent === 'Send')!.fire('click');
      expect(ws.sent[0]).toMatchObject({ type: 'prompt', mode: 'instructions', text: 'fix these' });
    });

    it('says so when no panel is open, and disposing the panel detaches it', () => {
      const chat = createChatLink();
      expect(chat.send('x')).toBe('Open the Deep Agent panel first.');
      const { view } = setup(chat);
      expect(chat.send('x')).toBeUndefined();
      view.dispose?.();
      expect(chat.send('x')).toBe('Open the Deep Agent panel first.');
    });
  });
});
