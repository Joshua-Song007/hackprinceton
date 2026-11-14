// Explorer: entity tree plus client and server script lists. Select an entity, open / add / rename / delete scripts.
import type { EditorBus } from './editor';
import type { PanelView } from './layout';
import { walkEntities, type Project, type ScriptKind } from './project';
import { announce, button, el, icon, openMenu, openSheet, promptSheet } from './ui';

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

  const addEntity = (parent: string | null, kind: 'box' | 'sphere' | 'trigger' | 'empty') => {
    const id = project.addEntity(parent, kind);
    if (id) {
      selection.set(id);
      focusKey = `e:${id}`;
      announce(`Added ${id.split('/').pop()}.`);
    }
  };
  const renameEntity = (id: string) =>
    promptSheet(`Rename ${id.split('/').pop()}`, 'New name', project.entity(id)?.name ?? '', 'Rename', (to) => {
      const r = project.renameEntity(id, to);
      if ('error' in r) return r.error;
      selection.set(r.id);
      focusKey = `e:${r.id}`;
    });
  const duplicateEntity = (id: string) => {
    const copy = project.duplicateEntity(id);
    if (copy) {
      selection.set(copy);
      focusKey = `e:${copy}`;
      announce(`Duplicated as ${copy.split('/').pop()}.`);
    }
  };
  const deleteEntity = (id: string) => {
    if (project.deleteEntity(id)) {
      selection.set(null);
      announce(`Deleted ${id.split('/').pop()}. Undo brings it back.`);
    }
  };
  const addItems = (parent: string | null, withChild: boolean) => [
    { label: 'Box', run: () => addEntity(parent, 'box') },
    { label: 'Sphere', run: () => addEntity(parent, 'sphere') },
    { label: 'Trigger zone', run: () => addEntity(parent, 'trigger') },
    { label: 'Empty', run: () => addEntity(parent, 'empty') },
    ...(withChild ? [{ separator: true }, { label: 'Child of selection (box)', disabled: !selection.entityId, run: () => addEntity(selection.entityId, 'box') }] : []),
  ];
  const entityMenu = (anchor: HTMLElement, id: string) =>
    openMenu(anchor, [
      { label: 'Rename', shortcut: 'F2', run: () => renameEntity(id) },
      { label: 'Duplicate', shortcut: 'Ctrl+D', run: () => duplicateEntity(id) },
      { label: 'Delete', shortcut: 'Delete', run: () => deleteEntity(id) },
      { separator: true },
      { heading: true, label: 'Add child' },
      ...addItems(id, false),
    ]);

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
      const ul = el('ul', { class: 'om-list', role: 'listbox', 'aria-label': `${kind} scripts`, 'aria-describedby': 'explorer-keys' });
      for (const name of Object.keys(project.scripts(kind))) {
        const item: Item = { kind: 'script', script: kind, name };
        items.push(item);
        const open = editor.active?.kind === kind && editor.active.name === name;
        ul.append(row(item, 0, 'script', `${name}.js`, '', open));
      }
      return ul;
    };
    const group = (title: string, kind?: ScriptKind) => {
      const addBtn: HTMLButtonElement | null = kind
        ? button('Add', () => add(kind), { variant: 'small', ariaLabel: `Add ${kind} script` })
        : title === 'Scene'
          ? button('Add', () => openMenu(addBtn!, addItems(null, true)), { variant: 'small', ariaLabel: 'Add entity' })
          : null;
      return el('div', { class: 'pn-group' }, [title, ...(addBtn ? [addBtn] : [])]);
    };
    const clientList = scriptList('client');
    const serverList = scriptList('server');
    const keys = el('span', { id: 'explorer-keys', class: 'sr-only' }, ['Arrow keys move, Enter opens a script, F2 renames, Ctrl+D duplicates an entity, Delete removes, Shift+F10 opens the context menu.']);
    root.replaceChildren(keys, group('Scene'), list, group('Client scripts', 'client'), clientList, group('Server scripts', 'server'), serverList);
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
      else if (e.key === 'F2') it.kind === 'script' ? rename(it.script, it.name) : renameEntity(it.id);
      else if (e.key === 'Delete') it.kind === 'script' ? remove(it.script, it.name) : deleteEntity(it.id);
      else if (e.key === 'd' && e.ctrlKey && it.kind === 'entity') {
        e.preventDefault();
        duplicateEntity(it.id);
      } else if ((e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) && it.kind === 'entity') {
        e.preventDefault();
        entityMenu(li!, it.id);
      }
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
      if (item.kind === 'entity') {
        li.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          selection.set(item.id);
          // selection re-renders the list, so anchor the menu on the fresh row
          entityMenu(root.querySelector<HTMLElement>(`li[data-key="${CSS.escape(keyOf(item))}"]`) ?? li, item.id);
        });
      }
      if (item.kind === 'script') {
        li.addEventListener('dblclick', () => editor.open({ kind: item.script, name: item.name }));
        // tabindex -1: F2 and Delete cover the keyboard, so the row stays one tab stop
        const rn = button('Rename', () => rename(item.script, item.name), { variant: 'small', ariaLabel: `Rename ${item.name}` });
        const dl = button('Delete', () => remove(item.script, item.name), { variant: 'small', ariaLabel: `Delete ${item.name}` });
        rn.tabIndex = dl.tabIndex = -1;
        li.append(rn, dl);
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
