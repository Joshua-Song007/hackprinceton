// Peripherals panel: the devices a game uses (iPhone, Apple Watch, AirPods), what each one gives the scripts, and one-click handlers.
// Every edit goes through `project.applyPeripheralChange`, so the scene JSON stays the single source of truth.
import { SLOTS } from '@pear/core';
import { PERIPHERAL_KINDS, type CustomGesture, type OwnershipMode, type PeripheralKind } from '@pear/runtime';
import type { EditorBus } from './editor';
import type { Selection } from './explorer';
import { prop, section } from './inspector';
import type { PanelView } from './layout';
import { inferInputs, slotDevice } from './needs';
import {
  COMING_SOON, PERIPHERALS, addPeripheral, deviceOfSignal, devicesOf, handlerStub, missingSignals, removePeripheral, scriptNameFor,
  readPeripheralState, seedInputs, setOwnership, signalDef, signalOn, toggleSignal, type PeripheralState, type SignalDef,
} from './peripherals';
import type { Project } from './project';
import { announce, button, el, icon, openSheet } from './ui';

const HELD_BY: Record<OwnershipMode, string> = { player: 'Each player has their own', free: 'One in the room', passed: 'One, passed between players' };

const AXES: Record<string, CustomGesture['axis']> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1], '-z': [0, 0, -1] };
const axisName = (a: CustomGesture['axis']) => Object.entries(AXES).find(([, v]) => v.every((n, i) => n === a[i]))?.[0] ?? 'x';

/** Writes the state as one undo step; turning Position on also grants the location permission scripts need. */
function commit(project: Project, next: PeripheralState): boolean {
  const error = project.applyPeripheralChange({ peripherals: next.peripherals, ownership: next.ownership, inputs: next.inputs, gestures: next.gestures, ...(next.inputs?.position ? { location: true } : {}) });
  if (error) announce(error);
  return !error;
}

/** Sheet listing every device: Add for the ones a game can have, "Coming soon" for the rest. */
export function openPeripheralPicker(project: Project, onAdded: () => void): void {
  openSheet('Add peripheral', (body, close) => {
    const have = new Set(devicesOf(readPeripheralState(project.scene)));
    const add = (kind: PeripheralKind) => {
      const next = addPeripheral(seedInputs(readPeripheralState(project.scene), project.clientScripts), kind);
      if (!commit(project, next)) return;
      close();
      announce(`Added ${PERIPHERALS[kind].label}.`);
      onAdded();
    };
    const rows = PERIPHERAL_KINDS.map((kind) => {
      const def = PERIPHERALS[kind];
      const b = button(have.has(kind) ? 'Added' : 'Add', () => add(kind), { variant: 'small', ariaLabel: `Add ${def.label}` });
      b.disabled = have.has(kind);
      return el('li', { style: 'grid-template-columns:18px minmax(0,1fr) auto' }, [icon(def.icon), el('span', { class: 'om-name' }, [def.label, el('span', { class: 'om-sub' }, [`Gives you ${def.blurb}`])]), b]);
    });
    const soon = COMING_SOON.map((d) => {
      const b = button('Coming soon', () => {}, { variant: 'small', ariaLabel: `${d.label}, coming soon` });
      b.disabled = true;
      return el('li', { style: 'grid-template-columns:18px minmax(0,1fr) auto' }, [el('span'), el('span', { class: 'om-name' }, [d.label, el('span', { class: 'om-sub' }, [d.blurb])]), b]);
    });
    body.append(el('ul', { class: 'om-list', 'aria-label': 'Peripherals' }, [...rows, ...soon]), el('div', { class: 'sheet-actions' }, [button('Close', close)]));
  });
}

export function createPeripheralsPanel(project: Project, selection: Selection, editor: EditorBus): PanelView {
  const root = el('div', { class: 'pn pp', role: 'region', 'aria-label': 'Peripherals', tabindex: -1 });
  let focusKey: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const change = (key: string, edit: (s: PeripheralState) => PeripheralState) => {
    focusKey = key;
    if (!commit(project, edit(seedInputs(readPeripheralState(project.scene), project.clientScripts)))) focusKey = null;
  };

  const addHandler = (sig: SignalDef, deviceLabel: string) => {
    const name = scriptNameFor(sig.id, Object.keys(project.clientScripts));
    const result = project.addHandlerScript(selection.entityId, deviceLabel, name, handlerStub(sig.id));
    if ('error' in result) return announce(result.error);
    selection.set(result.entityId);
    editor.open({ kind: 'client', name });
    announce(`Added ${name}.js on ${result.entityId.split('/').pop()}. Undo removes it.`);
  };

  const signalRow = (kind: PeripheralKind, sig: SignalDef, state: PeripheralState, usedNow: boolean): HTMLElement => {
    const on = signalOn(state.inputs, sig.id);
    const hintId = `pp-hint-${sig.id}`;
    const box = el('input', { type: 'checkbox', checked: on, 'aria-describedby': hintId, 'data-focus': `s:${sig.id}` });
    box.addEventListener('change', () => change(`s:${sig.id}`, (s) => toggleSignal(s, sig.id, box.checked)));
    const noEntity = sig.needsEntity && !selection.entityId;
    const status = !on ? '' : usedNow ? 'In use' : noEntity ? 'No script yet. Select the entity players look at.' : 'No script yet';
    const add = button('Add handler', () => addHandler(sig, PERIPHERALS[kind].label), { variant: 'small', ariaLabel: `Add handler for ${sig.label}` });
    add.dataset.focus = `h:${sig.id}`;
    add.hidden = !on || usedNow;
    add.disabled = noEntity;
    return el('div', { class: 'pp-row' }, [
      el('label', { class: 'pp-label' }, [box, el('span', {}, [sig.label])]),
      el('span', { class: 'pp-status' }, [status]),
      add,
      el('span', { class: 'om-sub pp-hint', id: hintId }, [sig.hint]),
    ]);
  };

  const motionRows = (kind: PeripheralKind, state: PeripheralState): HTMLElement[] => {
    const slots = SLOTS.filter((x) => slotDevice(x) === kind);
    const rows = Object.entries(state.gestures).filter(([, g]) => slotDevice(g.slot) === kind).map(([name, d]) => {
      const set = (field: string, patch: Partial<CustomGesture>) => change(`g:${name}:${field}`, (s) => ({ ...s, gestures: { ...s.gestures, [name]: { ...d, ...patch } } }));
      const select = (label: string, options: readonly string[], value: string, field: string, pick: (v: string) => Partial<CustomGesture>) => {
        const s = el('select', { 'aria-label': `${name} ${label}`, class: 'om-select', 'data-focus': `g:${name}:${field}` });
        for (const o of options) s.append(el('option', { value: o, selected: o === value }, [o]));
        s.addEventListener('change', () => set(field, pick(s.value)));
        return prop(label, s);
      };
      const num = (label: string, value: number, key: 'threshold' | 'cooldownMs') => {
        const input = el('input', { type: 'number', min: 0, step: 1, value: String(value), 'aria-label': `${name} ${label}`, 'data-focus': `g:${name}:${key}` });
        input.addEventListener('change', () => set(key, { [key]: Number(input.value) }));
        return prop(label, el('div', { class: 'om-field' }, [input]));
      };
      return section(name, '', [
        select('Slot', slots, d.slot, 'slot', (v) => ({ slot: v as CustomGesture['slot'] })),
        select('Axis', Object.keys(AXES), axisName(d.axis), 'axis', (v) => ({ axis: AXES[v]! })),
        num('Threshold (m/s²)', d.threshold, 'threshold'),
        num('Cooldown (ms)', d.cooldownMs, 'cooldownMs'),
        button('Remove', () => change('add', (s) => {
          const { [name]: _gone, ...rest } = s.gestures;
          return { ...s, gestures: rest };
        }), { variant: 'small', ariaLabel: `Remove motion gesture ${name}` }),
      ]);
    });
    const addBtn = button('Add motion gesture', () => change(`m:${kind}`, (s) => {
      let n = 1;
      while (`gesture${n}` in s.gestures) n++;
      return { ...s, gestures: { ...s.gestures, [`gesture${n}`]: { slot: PERIPHERALS[kind].defaultSlot, axis: [0, 0, -1], threshold: 20, cooldownMs: 400 } } };
    }), { variant: 'small' });
    addBtn.dataset.focus = `m:${kind}`;
    return [...rows, addBtn];
  };

  /** Who holds the device: each player, the room (free-floating, placed in the Viewport) or one player at a time. */
  const heldBy = (kind: PeripheralKind, state: PeripheralState): HTMLElement => {
    const mode = state.ownership[kind]?.mode ?? 'player';
    const select = el('select', { 'aria-label': `${PERIPHERALS[kind].label} is held by`, class: 'om-select', 'data-focus': `o:${kind}` });
    for (const m of PERIPHERALS[kind].ownership) select.append(el('option', { value: m, selected: m === mode }, [HELD_BY[m]]));
    select.addEventListener('change', () => change(`o:${kind}`, (s) => setOwnership(s, kind, select.value as OwnershipMode)));
    const at = state.ownership[kind]?.at;
    const hint = mode === 'free'
      ? `Placed at x ${at?.[0].toFixed(1)} z ${at?.[2].toFixed(1)}. Drag it in the Viewport.${kind === 'phone' ? ' Players carry no phone, so every player\'s position is this one.' : ''}`
      : mode === 'passed'
        ? 'One player holds it at a time. In a test, give it to another player from the Viewport or the Test panel.'
        : 'Every player brings one.';
    return el('div', { class: 'pp-row' }, [el('label', { class: 'pp-label' }, [el('span', {}, ['Held by']), select]), el('span', { class: 'om-sub pp-hint' }, [hint])]);
  };

  const deviceCard = (kind: PeripheralKind, state: PeripheralState, used: ReturnType<typeof inferInputs>): HTMLElement => {
    const def = PERIPHERALS[kind];
    const remove = button('Remove', () => {
      change('add', (s) => removePeripheral(s, kind));
      announce(`Removed ${def.label}. Undo brings it back.`);
    }, { variant: 'small', danger: true, ariaLabel: `Remove ${def.label}` });
    return el('section', { class: 'pp-card', role: 'group', 'aria-label': def.label }, [
      el('div', { class: 'pp-card-head' }, [icon(def.icon), el('span', { class: 'om-name' }, [def.label, el('span', { class: 'om-sub' }, [`Gives you ${def.blurb}`])]), remove]),
      heldBy(kind, state),
      ...def.signals.map((sig) => signalRow(kind, sig, state, signalOn(used, sig.id))),
      ...motionRows(kind, state),
      ...(def.outputs.length ? [el('div', { class: 'pp-out' }, [el('span', {}, ['Can do']), el('span', { class: 'om-sub' }, [def.outputs.map((o) => `${o.label}: ${o.hint}`).join('; ')])])] : []),
    ]);
  };

  const render = () => {
    const state = readPeripheralState(project.scene);
    const devices = devicesOf(state);
    const used = inferInputs(project.clientScripts);
    const addPeripheralBtn = button('Add peripheral', () => openPeripheralPicker(project, () => {}), { icon: 'plus', variant: 'default' });
    addPeripheralBtn.dataset.focus = 'add';
    const head = el('div', { class: 'pp-bar' }, [el('div', { class: 'pn-title' }, [icon('phone'), el('span', {}, ['Peripherals'])]), addPeripheralBtn]);

    const missing = state.inputs ? missingSignals(state.inputs, used) : [];
    const notice = missing.length
      ? [el('div', { class: 'pp-notice', role: 'status' }, [
          el('p', {}, [`Scripts use ${missing.map((id) => signalDef(id).label.toLowerCase()).join(', ')}, but no peripheral provides ${missing.length === 1 ? 'it' : 'them'}.`]),
          ...[...new Set(missing.map(deviceOfSignal))].map((kind) => {
            const mine = missing.filter((id) => deviceOfSignal(id) === kind);
            const label = devices.includes(kind) ? `Turn on ${mine.map((id) => signalDef(id).label.toLowerCase()).join(', ')}` : `Add ${PERIPHERALS[kind].label}`;
            const b = button(label, () => change(`n:${kind}`, (s) => mine.reduce((next, id) => toggleSignal(next, id, true), s)), { variant: 'small' });
            b.dataset.focus = `n:${kind}`;
            return b;
          }),
        ])]
      : [];

    const nothing = !devices.length;
    const found = used.head || used.position || used.heartRate || used.gestures.length > 0;
    const empty = nothing
      ? [el('p', { class: 'om-secondary' }, ['Peripherals are the devices your players bring: AirPods for head direction, an Apple Watch for heart rate, an iPhone for position and gestures. Add the ones your game needs.']),
         ...(found ? [(() => {
           const b = button('Detect from scripts', () => change('detect', (s) => ({ ...s, inputs: used })), { variant: 'small' });
           b.dataset.focus = 'detect';
           return b;
         })()] : [])]
      : [];

    root.replaceChildren(head, ...notice, ...empty, ...devices.map((kind) => deviceCard(kind, state, used)));
    if (focusKey) {
      (root.querySelector<HTMLElement>(`[data-focus="${focusKey}"]`) ?? root.querySelector<HTMLElement>('[data-focus="add"]'))?.focus();
      focusKey = null;
    }
  };

  // Typing in a script changes which signals are "in use"; refresh after a pause, and never while focus is inside the panel.
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!root.contains(document.activeElement)) render();
    }, 400);
  };
  const offs = [
    project.onChange((c) => (c === 'script' ? later() : (c === 'open' || c === 'scene' || c === 'scripts') && render())),
    selection.onChange(render),
  ];
  render();

  return {
    element: root,
    focus: () => (root.querySelector<HTMLElement>('button, input, select') ?? root).focus(),
    dispose: () => {
      clearTimeout(timer);
      offs.forEach((o) => o());
    },
  };
}
