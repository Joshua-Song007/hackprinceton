// Inspector: the selected entity's name, Vector3 fields (drag the axis letter to scrub) and components.
// Every edit goes through `project.updateEntity`, so the scene JSON is the single source of truth.
import type { PanelView } from './layout';
import type { Selection } from './explorer';
import { parseInputs, type SceneInputs } from '@pear/runtime';
import { eulerToQuat, quatToEuler, type Project, type RawEntity } from './project';
import { announce, button, el, icon, openMenu, promptSheet } from './ui';

type V3 = [number, number, number];
const decimals = (step: number) => (String(step).split('.')[1] ?? '').length;

/** Brand-kit Vector3Field: three fields with scrubbable axis letters. Shift scrubs finely; Up/Down step the focused field. */
export function vector3Field(label: string, unit: string, value: readonly number[], step: number, resetTo: number, onChange: (v: V3) => boolean | void, fix = `Enter a number for ${label.toLowerCase()}.`): HTMLElement {
  const dp = decimals(step);
  const current: V3 = [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0];
  const inputs: HTMLInputElement[] = [];
  const reject = (axis: number) => {
    inputs[axis]!.value = current[axis]!.toFixed(dp);
    inputs[axis]!.setAttribute('aria-invalid', 'true');
    announce(fix);
  };
  const commit = (axis: number, n: number) => {
    const prev = current[axis]!;
    current[axis] = Number(n.toFixed(dp));
    // a callback returning false rejects the value: put the previous one back
    if (onChange([...current]) === false) return void ((current[axis] = prev), reject(axis));
    inputs[axis]!.value = current[axis]!.toFixed(dp);
    inputs[axis]!.removeAttribute('aria-invalid');
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
      else reject(axis);
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

export function section(title: string, trail: string, content: HTMLElement[]): HTMLElement {
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

export const prop = (label: string, control: Node) => el('div', { class: 'om-prop' }, [el('span', {}, [label]), control]);
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

  const numberField = (label: string, value: number, fix: string, onChange: (n: number) => boolean | void) => {
    const input = el('input', { type: 'text', value: String(value), 'aria-label': label, inputmode: 'decimal' });
    input.addEventListener('change', () => {
      const n = Number(input.value);
      if (Number.isFinite(n) && onChange(n) !== false) return input.removeAttribute('aria-invalid');
      input.value = String(value);
      input.setAttribute('aria-invalid', 'true');
      announce(fix);
    });
    return el('div', { class: 'om-field' }, [input]);
  };

  const select = (label: string, options: readonly string[], value: string, onChange: (v: string) => void) => {
    const s = el('select', { 'aria-label': label, class: 'om-select' });
    for (const o of options) s.append(el('option', { value: o, selected: o === value }, [o]));
    s.addEventListener('change', () => onChange(s.value));
    return s;
  };

  const componentSection = (c: Record<string, unknown>, index: number): HTMLElement => {
    const set = (patch: Record<string, unknown>) => edit((e) => Object.assign(e.components![index]!, patch));
    switch (c.type) {
      case 'trigger': {
        // structural change (radius <-> size), so it goes through project directly and re-renders
        const shape = select('Trigger shape', ['sphere', 'box'], String(c.shape), (v) => {
          const id = selection.entityId;
          if (id) project.updateEntity(id, (e) => {
            const t = e.components![index]!;
            delete t.radius;
            delete t.size;
            Object.assign(t, v === 'box' ? { shape: v, size: [1, 1, 1] } : { shape: v, radius: 1 });
          });
        });
        const rows: HTMLElement[] = [prop('Shape', shape), prop('Probe slots', readout((c.probeSlots as string[] | undefined)?.join(', ') ?? 'head'))];
        if (c.shape === 'sphere') rows.push(prop('Radius (m)', numberField('Trigger radius in meters', Number(c.radius), 'Enter a number greater than 0 for radius.', (n) => n > 0 && set({ radius: n }))));
        else rows.push(vector3Field('Size', 'm', (c.size as number[]) ?? [1, 1, 1], 0.1, 1, (v) => v.every((n) => n > 0) && set({ size: v }), 'Enter a number greater than 0 for size.'));
        return section('Trigger', 'onTriggerEnter', rows);
      }
      case 'audioEmitter': {
        const sound = el('input', { type: 'text', value: String(c.soundName ?? ''), 'aria-label': 'Sound name' });
        sound.addEventListener('change', () => set({ soundName: sound.value }));
        const loops = el('input', { type: 'checkbox', 'aria-label': 'Loops', checked: c.loops === true });
        loops.addEventListener('change', () => set({ loops: loops.checked }));
        return section('Audio emitter', '', [
          prop('Sound', el('div', { class: 'om-field' }, [sound])),
          prop('Gain (dB)', numberField('Gain in decibels', Number(c.gain ?? 0), 'Enter a number for gain.', (n) => set({ gain: n }))),
          prop('Loops', loops),
        ]);
      }
      default: {
        const pick = el('select', { 'aria-label': 'Script', class: 'om-select' });
        const names = Object.keys(project.clientScripts);
        for (const n of names.includes(String(c.name)) ? names : [String(c.name), ...names]) pick.append(el('option', { value: n, selected: n === c.name }, [names.includes(n) ? n : n ? `${n} (missing)` : 'Choose a script']));
        pick.addEventListener('change', () => set({ name: pick.value }));
        const fresh = button('New script...', () =>
          promptSheet('New client script', 'Script name', '', 'Create and attach', (name) => {
            const id = selection.entityId;
            return id ? project.createAndAttachScript(id, name) : 'Select an entity first.';
          }), { variant: 'small' });
        return section('Script', 'client', [prop('File', pick), fresh]);
      }
    }
  };

  const withRemove = (sec: HTMLElement, index: number, label: string) => {
    sec.querySelector('.om-section-body')!.append(button('Remove', () => {
      const id = selection.entityId;
      if (id && project.removeComponent(id, index)) announce(`Removed ${label} component. Undo brings it back.`);
    }, { variant: 'small', ariaLabel: `Remove ${label} component` }));
    return sec;
  };

  const sceneSettings = (): HTMLElement[] => {
    const s = project.scene;
    const setting = (key: string, value: unknown) => {
      editing = true;
      const error = project.setSceneSetting(key, value);
      editing = false;
      if (error) {
        announce(error);
        render();
      }
    };
    const text = (label: string, value: string, key: string) => {
      const input = el('input', { type: 'text', value, 'aria-label': label });
      input.addEventListener('change', () => setting(key, input.value));
      return el('div', { class: 'om-field' }, [input]);
    };
    const origin = vector3Field('Player origin', 'm', (s.playerOrigin as number[]) ?? [0, 0, 0], 0.01, 0, (v) => !project.setSceneSetting('playerOrigin', v));
    const location = el('input', { type: 'checkbox', 'aria-label': 'Location permission', 'aria-describedby': 'scene-location-help', checked: (s.permissions as { location?: boolean } | undefined)?.location === true });
    location.addEventListener('change', () => setting('permissions.location', location.checked));
    const playersGroup = (): HTMLElement[] => {
      let declared: SceneInputs | null = null;
      try {
        declared = s.inputs ? parseInputs(s.inputs) : null;
      } catch {
        declared = null;
      }
      if (!declared) return [el('p', { class: 'om-secondary' }, ['Add a peripheral to set the player count.'])];
      const now = declared;
      const players = (label: string, i: 0 | 1) => {
        const input = el('input', { type: 'number', min: 1, max: 32, step: 1, value: String(now.players[i]), 'aria-label': label });
        input.addEventListener('change', () => setting('inputs', { ...now, players: i === 0 ? [Number(input.value), now.players[1]] : [now.players[0], Number(input.value)] }));
        return prop(label, el('div', { class: 'om-field' }, [input]));
      };
      return [players('Min players', 0), players('Max players', 1)];
    };
    return [
      el('div', { class: 'pn-title' }, [icon('cube'), el('span', {}, ['Scene settings'])]),
      section('Scene', '', [
        prop('Name', text('Scene name', String(s.name ?? ''), 'name')),
        prop('Run mode', select('Run mode', ['screen', 'device'], String(s.runMode ?? 'screen'), (v) => setting('runMode', v))),
        prop('Required tier', select('Required tier', ['1', '2', '3'], String(s.requiredTier ?? 1), (v) => setting('requiredTier', Number(v)))),
        origin,
        prop('Location permission', location),
        el('p', { id: 'scene-location-help', class: 'om-secondary' }, ['Lets scripts read this player’s own position and send it as a game event.']),
      ]),
      section('Players', '', playersGroup()),
    ];
  };

  const render = () => {
    const id = selection.entityId;
    const entity = id ? project.entity(id) : undefined;
    if (!id || !entity) return void root.replaceChildren(...sceneSettings());
    const name = el('input', { value: String(entity.name ?? ''), 'aria-label': 'Entity name' });
    name.addEventListener('change', () => {
      const r = project.renameEntity(id, name.value);
      if ('error' in r) {
        announce(r.error);
        name.value = String(entity.name ?? '');
        return name.setAttribute('aria-invalid', 'true');
      }
      selection.set(r.id);
      render();
    });
    const color = el('input', { type: 'text', value: String(entity.color ?? ''), 'aria-label': 'Color', placeholder: '#rrggbb' });
    color.addEventListener('change', () => edit((e) => (color.value ? (e.color = color.value) : delete e.color)));
    const look = section('Appearance', '', [
      prop('Shape', select('Entity shape', ['box', 'sphere'], String(entity.shape ?? 'box'), (v) => edit((e) => (e.shape = v)))),
      prop('Color', el('div', { class: 'om-field' }, [color])),
    ]);
    const transform = section('Transform', '', [
      vector3Field('Position', 'm', (entity.position as number[]) ?? [0, 0, 0], 0.01, 0, (v) => edit((e) => (e.position = v))),
      vector3Field('Rotation', 'deg', quatToEuler((entity.rotation as number[]) ?? [0, 0, 0, 1]), 1, 0, (v) => edit((e) => (e.rotation = eulerToQuat(v)))),
      vector3Field('Scale', '', (entity.scale as number[]) ?? [1, 1, 1], 0.01, 1, (v) => edit((e) => (e.scale = v))),
    ]);
    const components = (entity.components ?? []).map((c, i) => withRemove(componentSection(c, i), i, String(c.type)));
    const addBtn = button('Add component', () =>
      openMenu(addBtn, (['script', 'trigger', 'audioEmitter'] as const).map((t) => ({ label: t === 'audioEmitter' ? 'Audio emitter' : t[0]!.toUpperCase() + t.slice(1), run: () => project.addComponent(id, t) }))), { variant: 'small' });
    root.replaceChildren(el('div', { class: 'pn-title' }, [icon('cube'), name]), look, transform, ...components, addBtn);
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
