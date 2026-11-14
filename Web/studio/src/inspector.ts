// Inspector: the selected entity's name, Vector3 fields (drag the axis letter to scrub) and components.
// Every edit goes through `project.updateEntity`, so the scene JSON is the single source of truth.
import type { PanelView } from './layout';
import type { Selection } from './explorer';
import { walkEntities, type Project, type RawEntity } from './project';
import { el, icon } from './ui';

type V3 = [number, number, number];
const decimals = (step: number) => (String(step).split('.')[1] ?? '').length;

/** Brand-kit Vector3Field: three fields with scrubbable axis letters. Shift scrubs finely; Up/Down step the focused field. */
export function vector3Field(label: string, unit: string, value: readonly number[], step: number, resetTo: number, onChange: (v: V3) => void): HTMLElement {
  const dp = decimals(step);
  const current: V3 = [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0];
  const inputs: HTMLInputElement[] = [];
  const commit = (axis: number, n: number) => {
    current[axis] = Number(n.toFixed(dp));
    inputs[axis]!.value = current[axis]!.toFixed(dp);
    onChange([...current]);
  };
  const fields = (['x', 'y', 'z'] as const).map((axisName, axis) => {
    const letter = axisName.toUpperCase();
    const handle = el('span', { class: `om-axis om-axis--${axisName}`, title: `Drag to change ${letter}, double-click to reset` }, [letter]);
    const input = el('input', { value: current[axis]!.toFixed(dp), 'data-step': step, 'aria-label': `${label} ${letter}`, inputmode: 'decimal' });
    inputs.push(input);
    handle.addEventListener('pointerdown', (e) => {
      handle.setPointerCapture(e.pointerId);
      const x0 = e.clientX;
      const v0 = current[axis]!;
      const move = (ev: PointerEvent) => commit(axis, v0 + (ev.clientX - x0) * step * (ev.shiftKey ? 0.1 : 1));
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
    handle.addEventListener('dblclick', () => commit(axis, resetTo));
    input.addEventListener('change', () => {
      const n = Number(input.value);
      if (Number.isFinite(n)) commit(axis, n);
      else input.value = current[axis]!.toFixed(dp);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      commit(axis, current[axis]! + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : e.altKey ? 0.1 : 1));
    });
    return el('label', { class: 'om-field' }, [handle, input]);
  });
  return el('div', { class: 'om-prop om-prop--vec' }, [
    el('span', { class: 'om-prop-label' }, [el('span', {}, [label]), el('span', {}, [unit])]),
    el('div', { class: 'om-vec' }, fields),
  ]);
}

function section(title: string, trail: string, content: HTMLElement[]): HTMLElement {
  const chev = icon('chev');
  chev.classList.add('om-chev');
  const header = el('button', { type: 'button', 'aria-expanded': 'true' }, [chev, title, ...(trail ? [el('span', { class: 'om-trail' }, [trail])] : [])]);
  const body = el('div', { class: 'om-section-body' }, content);
  header.addEventListener('click', () => {
    const open = header.getAttribute('aria-expanded') === 'true';
    header.setAttribute('aria-expanded', String(!open));
    body.hidden = open;
  });
  return el('div', { class: 'om-section' }, [header, body]);
}

const prop = (label: string, control: Node) => el('div', { class: 'om-prop' }, [el('span', {}, [label]), control]);
const readout = (text: string) => el('span', { style: 'color:var(--text)' }, [text]);

export function createInspectorPanel(project: Project, selection: Selection): PanelView {
  const root = el('div', { class: 'pn', role: 'region', 'aria-label': 'Inspector', tabindex: -1 });
  let editing = false;

  const edit = (edit: (e: RawEntity) => void) => {
    const id = selection.entityId;
    if (!id) return;
    editing = true;
    project.updateEntity(id, edit);
    editing = false;
  };

  const numberField = (label: string, value: number, onChange: (n: number) => void) => {
    const input = el('input', { type: 'text', value: String(value), 'aria-label': label, inputmode: 'decimal' });
    input.addEventListener('change', () => {
      const n = Number(input.value);
      if (Number.isFinite(n)) onChange(n);
      else input.value = String(value);
    });
    return el('div', { class: 'om-field' }, [input]);
  };

  const componentSection = (c: Record<string, unknown>, index: number): HTMLElement => {
    const set = (patch: Record<string, unknown>) => edit((e) => Object.assign(e.components![index]!, patch));
    switch (c.type) {
      case 'trigger': {
        const rows: HTMLElement[] = [prop('Shape', readout(String(c.shape))), prop('Probe slots', readout((c.probeSlots as string[] | undefined)?.join(', ') ?? 'head'))];
        if (c.shape === 'sphere') rows.push(prop('Radius (m)', numberField('Trigger radius in meters', Number(c.radius), (n) => n > 0 && set({ radius: n }))));
        else rows.push(vector3Field('Size', 'm', (c.size as number[]) ?? [1, 1, 1], 0.1, 1, (v) => v.every((n) => n > 0) && set({ size: v })));
        return section('Trigger', 'onTriggerEnter', rows);
      }
      case 'audioEmitter': {
        const sound = el('input', { type: 'text', value: String(c.soundName ?? ''), 'aria-label': 'Sound name' });
        sound.addEventListener('change', () => set({ soundName: sound.value }));
        const loops = el('input', { type: 'checkbox', 'aria-label': 'Loops', checked: c.loops === true });
        loops.addEventListener('change', () => set({ loops: loops.checked }));
        return section('Audio emitter', '', [
          prop('Sound', el('div', { class: 'om-field' }, [sound])),
          prop('Gain (dB)', numberField('Gain in decibels', Number(c.gain ?? 0), (n) => set({ gain: n }))),
          prop('Loops', loops),
        ]);
      }
      default: {
        const select = el('select', { 'aria-label': 'Script', class: 'om-select' });
        const names = Object.keys(project.clientScripts);
        for (const n of names.includes(String(c.name)) ? names : [String(c.name), ...names]) select.append(el('option', { value: n, selected: n === c.name }, [names.includes(n) ? n : `${n} (missing)`]));
        select.addEventListener('change', () => set({ name: select.value }));
        return section('Script', 'client', [prop('File', select)]);
      }
    }
  };

  const render = () => {
    const id = selection.entityId;
    const entity = id ? project.entity(id) : undefined;
    if (!id || !entity) return void root.replaceChildren(el('div', { class: 'pn-empty' }, ['Select an entity in the Explorer to edit its transform and components.']));
    const name = el('input', { value: String(entity.name ?? ''), 'aria-label': 'Entity name' });
    name.addEventListener('change', () => {
      edit((e) => (e.name = name.value));
      let renamed: string | null = null;
      walkEntities(project.scene, (e, eid) => {
        if (e === entity) renamed = eid;
      });
      selection.set(renamed);
      if (renamed === id) render();
    });
    const transform = section('Transform', '', [
      vector3Field('Position', 'm', (entity.position as number[]) ?? [0, 0, 0], 0.01, 0, (v) => edit((e) => (e.position = v))),
      vector3Field('Scale', '', (entity.scale as number[]) ?? [1, 1, 1], 0.01, 1, (v) => edit((e) => (e.scale = v))),
    ]);
    const components = (entity.components ?? []).map((c, i) => componentSection(c, i));
    root.replaceChildren(el('div', { class: 'pn-title' }, [icon('cube'), name]), transform, ...components);
  };

  const offs = [
    selection.onChange(render),
    project.onChange((c) => {
      if ((c === 'open' || c === 'scripts' || c === 'scene') && !(c === 'scene' && editing)) render();
    }),
  ];
  render();
  return {
    element: root,
    focus: () => (root.querySelector<HTMLElement>('input, select, button') ?? root).focus(),
    dispose: () => offs.forEach((o) => o()),
  };
}
