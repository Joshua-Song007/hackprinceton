// Explorer: entity tree plus client and server script lists. Select an entity, open / add / rename / delete scripts.
import type { EditorBus } from './editor';
import type { PanelView } from './layout';
import { walkEntities, type Project, type ScriptKind } from './project';
import { button, el, icon, openSheet, promptSheet } from './ui';

/** The selected entity id (a `flattenScene` id), shared by Explorer, Inspector and Viewport. */
export class Selection {
  private id: string | null = null;
  private listeners = new Set<(id: string | null) => void>();

  get entityId(): string | null {
    return this.id;
  }

  set(id: string | null): void {
    if (id === this.id) return;
    this.id = id;
    for (const l of this.listeners) l(id);
  }

  onChange(listener: (id: string | null) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

type Item = { kind: 'entity'; id: string } | { kind: 'script'; script: ScriptKind; name: string };

export function createExplorerPanel(project: Project, selection: Selection, editor: EditorBus): PanelView {
  const root = el('div', { class: 'pn', role: 'region', 'aria-label': 'Explorer' });
  let focusKey: string | null = null;
  const keyOf = (i: Item) => (i.kind === 'entity' ? `e:${i.id}` : `s:${i.script}:${i.name}`);

  const add = (kind: ScriptKind) =>
    promptSheet(`Add ${kind} script`, 'Script name', '', 'Add', (name) => {
      const error = project.addScript(kind, name);
      if (!error) editor.open({ kind, name });
      return error;
    });
  const rename = (kind: ScriptKind, name: string) =>
    promptSheet(`Rename ${name}`, 'New name', name, 'Rename', (to) => project.renameScript(kind, name, to));
  const remove = (kind: ScriptKind, name: string) =>
    openSheet(`Delete ${name}?`, (body, close) => {
      body.append(
        el('p', {}, [`Deletes the ${kind} script ${name}.js from this project. Entities that still reference it will report an error when run.`]),
        el('div', { class: 'sheet-actions' }, [button('Cancel', close), button('Delete script', () => {
          project.deleteScript(kind, name);
          close();
        }, { variant: 'default' })]),
      );
    });

  const render = () => {
    const items: Item[] = [];
    const list = el('ul', { class: 'om-list', role: 'listbox', 'aria-label': 'Scene entities' });
    walkEntities(project.scene, (e, id) => {
      items.push({ kind: 'entity', id });
      const depth = id.split('/').length - 1;
      const types = (e.components ?? []).map((c) => String(c.type)).join(', ');
      list.append(row({ kind: 'entity', id }, depth, 'cube', String(e.name ?? ''), types, selection.entityId === id));
    });
    const scriptList = (kind: ScriptKind) => {
      const ul = el('ul', { class: 'om-list', role: 'listbox', 'aria-label': `${kind} scripts` });
      for (const name of Object.keys(project.scripts(kind))) {
        const item: Item = { kind: 'script', script: kind, name };
        items.push(item);
        const open = editor.active?.kind === kind && editor.active.name === name;
        ul.append(row(item, 0, 'script', `${name}.js`, '', open));
      }
      return ul;
    };
    const group = (title: string, kind?: ScriptKind) =>
      el('div', { class: 'pn-group' }, [title, ...(kind ? [button('Add', () => add(kind), { variant: 'small', ariaLabel: `Add ${kind} script` })] : [])]);
    const clientList = scriptList('client');
    const serverList = scriptList('server');
    root.replaceChildren(group('Scene'), list, group('Client scripts', 'client'), clientList, group('Server scripts', 'server'), serverList);
    if (!items.some((i) => keyOf(i) === focusKey)) focusKey = items[0] ? keyOf(items[0]) : null;
    root.querySelectorAll<HTMLElement>('li').forEach((li) => (li.tabIndex = li.dataset.key === focusKey ? 0 : -1));

    root.onkeydown = (e) => {
      const li = (e.target as HTMLElement).closest('li');
      const i = items.findIndex((it) => keyOf(it) === li?.dataset.key);
      if (i < 0) return;
      const move = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
      const it = items[i]!;
      if (move) {
        e.preventDefault();
        const next = items[Math.min(items.length - 1, Math.max(0, i + move))]!;
        focusKey = keyOf(next);
        if (next.kind === 'entity') selection.set(next.id);
        else render();
        root.querySelector<HTMLElement>(`li[data-key="${CSS.escape(focusKey)}"]`)?.focus();
      } else if (e.key === 'Enter' && it.kind === 'script') editor.open({ kind: it.script, name: it.name });
      else if (e.key === 'F2' && it.kind === 'script') rename(it.script, it.name);
      else if (e.key === 'Delete' && it.kind === 'script') remove(it.script, it.name);
    };

    function row(item: Item, depth: number, iconName: string, label: string, sub: string, selected: boolean): HTMLElement {
      const li = el('li', { role: 'option', 'aria-selected': String(selected), 'data-key': keyOf(item), 'data-depth': depth, class: 'om-tree-row' }, [
        icon(iconName), el('span', { class: 'om-name' }, [label]), el('span', { class: 'om-secondary' }, [sub]),
      ]);
      li.addEventListener('click', () => {
        focusKey = keyOf(item);
        if (item.kind === 'entity') selection.set(item.id);
        else render();
      });
      if (item.kind === 'script') {
        li.addEventListener('dblclick', () => editor.open({ kind: item.script, name: item.name }));
        li.append(button('Rename', () => rename(item.script, item.name), { variant: 'small', ariaLabel: `Rename ${item.name}` }));
        li.append(button('Delete', () => remove(item.script, item.name), { variant: 'small', ariaLabel: `Delete ${item.name}` }));
        li.style.gridTemplateColumns = '18px minmax(0, 1fr) auto auto auto';
      }
      return li;
    }
  };

  const offs = [project.onChange((c) => (c === 'open' || c === 'scene' || c === 'scripts') && render()), selection.onChange(render), editor.onChange(render)];
  render();
  return {
    element: root,
    focus: () => (root.querySelector<HTMLElement>('li[tabindex="0"]') ?? root).focus(),
    dispose: () => offs.forEach((o) => o()),
  };
}
