// Script editor: CodeMirror 6, one tab per open script, inline error markers from sandbox and server errors.
// Ctrl+S is handled at window level in main.ts (CodeMirror leaves it unbound).
import { javascript } from '@codemirror/lang-javascript';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { setDiagnostics, lintGutter, type Diagnostic } from '@codemirror/lint';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { basicSetup } from 'codemirror';
import type { PanelView } from './layout';
import type { Project, ScriptKind } from './project';
import { el } from './ui';

export interface ScriptRef {
  kind: ScriptKind;
  name: string;
}
const keyOf = (r: ScriptRef) => `${r.kind}:${r.name}`;

/** Open tabs and error messages, kept outside the panel so a re-created panel (layout load) keeps them. */
export class EditorBus {
  tabs: ScriptRef[] = [];
  active: ScriptRef | null = null;
  private errors = new Map<string, string[]>();
  private listeners = new Set<() => void>();

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  open(ref: ScriptRef): void {
    if (!this.tabs.some((t) => keyOf(t) === keyOf(ref))) this.tabs.push(ref);
    this.active = ref;
    this.emit();
  }

  close(ref: ScriptRef): void {
    const i = this.tabs.findIndex((t) => keyOf(t) === keyOf(ref));
    if (i < 0) return;
    this.tabs.splice(i, 1);
    if (this.active && keyOf(this.active) === keyOf(ref)) this.active = this.tabs[Math.min(i, this.tabs.length - 1)] ?? null;
    this.emit();
  }

  /** Drops tabs for scripts that no longer exist (delete, rename). Silent: the caller re-renders. */
  prune(project: Project): void {
    this.tabs = this.tabs.filter((t) => t.name in project.scripts(t.kind));
    if (this.active && !this.tabs.some((t) => keyOf(t) === keyOf(this.active!))) this.active = this.tabs.at(-1) ?? null;
  }

  reset(): void {
    this.tabs = [];
    this.active = null;
    this.errors.clear();
    this.emit();
  }

  errorsFor(ref: ScriptRef): string[] {
    return this.errors.get(keyOf(ref)) ?? [];
  }

  reportError(ref: ScriptRef, message: string): void {
    const list = this.errors.get(keyOf(ref)) ?? [];
    if (!list.includes(message)) this.errors.set(keyOf(ref), [...list, message].slice(-5));
    this.emit();
  }

  /** Server errors carry the handler name but not the script: mark every server script that defines that handler. */
  reportServerError(project: Project, message: string): void {
    const handler = /^(\w+):/.exec(message)?.[1];
    const names = Object.keys(project.serverScripts);
    const owners = names.filter((n) => handler && new RegExp(`\\b${handler}\\b`).test(project.serverScripts[n]!));
    for (const name of owners.length ? owners : names) this.reportError({ kind: 'server', name }, message);
  }

  clearErrors(): void {
    this.errors.clear();
    this.emit();
  }
}

// Syntax colors come from tokens only: keywords accent, comments secondary, the rest text.
const omniHighlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.definitionKeyword, tags.moduleKeyword], color: 'var(--accent)' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--text-secondary)', fontStyle: 'italic' },
  { tag: [tags.string, tags.number, tags.bool, tags.null], color: 'var(--text)' },
]);

/** The marker range for an error: the handler named in the message when found, else line 1. */
export function errorRange(source: string, message: string): { from: number; to: number } {
  const handler = /^(?:[\w-]+\.)?(\w+):/.exec(message)?.[1];
  const hit = handler ? new RegExp(`\\b${handler}\\b`).exec(source) : null;
  // A `(line N)` suffix from the sandbox wins over the handler name.
  const line = Number(/\(line (\d+)\)$/.exec(message)?.[1]);
  const lineAt = line > 0 ? source.split('\n').slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0) : -1;
  const at = lineAt >= 0 && lineAt <= source.length ? lineAt : hit?.index ?? 0;
  const start = source.lastIndexOf('\n', at - 1) + 1;
  const end = source.indexOf('\n', at);
  return { from: start, to: end < 0 ? source.length : end };
}

export function createEditorPanel(project: Project, bus: EditorBus): PanelView {
  const root = el('div', { class: 'pn pn-flex', role: 'region', 'aria-label': 'Script editor', tabindex: -1 });
  const tabBar = el('div', { class: 'ed-tabs', role: 'tablist', 'aria-label': 'Open scripts' });
  const body = el('div', { class: 'ed-body', id: 'ed-panel', role: 'tabpanel' });
  const empty = el('div', { class: 'pn-empty' }, ['Open a script from the Explorer to edit it.']);
  root.append(tabBar, body);

  const states = new Map<string, EditorState>();
  const view = new EditorView({ parent: body, state: EditorState.create({ doc: '' }) });

  const stateFor = (ref: ScriptRef): EditorState => {
    let s = states.get(keyOf(ref));
    if (!s) {
      s = EditorState.create({
        doc: project.scripts(ref.kind)[ref.name] ?? '',
        extensions: [
          EditorView.theme({}, { dark: document.documentElement.dataset.theme !== 'light' }), // colors come from theme.css tokens
          basicSetup, javascript(), syntaxHighlighting(omniHighlight), lintGutter(),
          EditorView.contentAttributes.of({ 'aria-label': `${ref.name} ${ref.kind} script` }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) project.setScript(ref.kind, ref.name, u.state.doc.toString());
          }),
        ],
      });
      states.set(keyOf(ref), s);
    }
    return s;
  };

  const markers = (ref: ScriptRef): Diagnostic[] =>
    bus.errorsFor(ref).map((message) => ({ ...errorRange(view.state.doc.toString(), message), severity: 'error' as const, message }));

  const renderTabs = () => {
    tabBar.replaceChildren();
    body.removeAttribute('aria-labelledby');
    bus.tabs.forEach((ref, n) => {
      const selected = bus.active !== null && keyOf(bus.active) === keyOf(ref);
      const errors = bus.errorsFor(ref).length;
      const tab = el('button', { type: 'button', role: 'tab', id: `ed-tab-${n}`, 'aria-controls': selected ? 'ed-panel' : undefined, 'aria-selected': String(selected), tabindex: selected ? 0 : -1, class: 'ed-tab-name' }, [
        `${ref.name}.js`, ...(errors ? [` (${errors} ${errors === 1 ? 'error' : 'errors'})`] : []),
      ]);
      tab.addEventListener('click', () => bus.open(ref));
      tab.addEventListener('keydown', (e) => {
        const i = bus.tabs.findIndex((t) => keyOf(t) === keyOf(ref));
        const next = e.key === 'ArrowRight' ? bus.tabs[i + 1] : e.key === 'ArrowLeft' ? bus.tabs[i - 1] : undefined;
        if (next) {
          e.preventDefault();
          bus.open(next);
          tabBar.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
        }
      });
      const close = el('button', { type: 'button', class: 'ed-tab-close', 'aria-label': `Close ${ref.name}.js`, title: 'Close' }, ['\u00d7']);
      close.addEventListener('click', () => bus.close(ref));
      if (selected) body.setAttribute('aria-labelledby', tab.id);
      tabBar.append(el('span', { class: selected ? 'ed-tab is-active' : 'ed-tab', role: 'presentation' }, [tab, close]));
    });
  };

  let shownKey: string | null = null;
  const sync = () => {
    bus.prune(project);
    const activeKey = bus.active ? keyOf(bus.active) : null;
    if (shownKey && shownKey !== activeKey && bus.tabs.some((t) => keyOf(t) === shownKey)) states.set(shownKey, view.state);
    for (const key of [...states.keys()]) if (!bus.tabs.some((t) => keyOf(t) === key)) states.delete(key);
    renderTabs();
    if (!bus.active) {
      shownKey = null;
      view.setState(EditorState.create({ doc: '' }));
      body.hidden = true;
      if (!root.contains(empty)) root.append(empty);
      return;
    }
    empty.remove();
    body.hidden = false;
    if (activeKey !== shownKey) {
      view.setState(stateFor(bus.active));
      shownKey = activeKey;
    }
    view.dispatch(setDiagnostics(view.state, markers(bus.active)));
  };

  // External source changes (open project, add, rename, delete) are the only ones not coming from this editor.
  const offProject = project.onChange((c) => {
    if (c === 'open') {
      states.clear();
      shownKey = null;
      bus.reset();
    } else if (c === 'scripts') sync();
  });
  const offBus = bus.onChange(sync);
  sync();

  return {
    element: root,
    focus: () => (bus.active ? view.focus() : root.focus()),
    dispose: () => {
      offProject();
      offBus();
      view.destroy();
    },
  };
}
