// File > New game: pick a template, then write the game's instructions before anything is created. The instructions are what
// the player limit, the simulated players' roles and the playtest agents all start from, so a game does not exist without them.
import { INSTRUCTION_LIMITS, parseInstructions } from '@pear/runtime';
import { TEMPLATES, templateSnapshot, type ProjectSnapshot, type TemplateId } from './project';
import { button, el, openSheet } from './ui';

export interface NewGameRole {
  name: string;
  brief: string;
  kind: 'player' | 'ref';
}

export interface NewGamePhase {
  title: string;
  text: string;
}

/** What the New game form holds; the numbers stay text until they are checked. */
export interface NewGameForm {
  template: TemplateId;
  title: string;
  summary: string;
  min: string;
  max: string;
  win: string;
  lose: string;
  roles: NewGameRole[];
  phases: NewGamePhase[];
}

/** The player count a template's scene declares, or null when it only has the default 1 to 32 (nobody chose that). */
export function templatePlayers(id: TemplateId): [number, number] | null {
  const players = (templateSnapshot(id).scene.inputs as { players?: unknown } | undefined)?.players;
  if (!Array.isArray(players) || players.length !== 2) return null;
  const [min, max] = players as [number, number];
  return min === 1 && max === 32 ? null : [min, max];
}

export function emptyForm(template: TemplateId = 'blank'): NewGameForm {
  const players = templatePlayers(template);
  return { template, title: '', summary: '', min: players ? String(players[0]) : '', max: players ? String(players[1]) : '', win: '', lose: '', roles: [{ name: 'Player', brief: '', kind: 'player' }], phases: [] };
}

export type NewGameField = 'title' | 'summary' | 'players' | 'win' | 'lose' | 'roles';

export interface NewGameProblem {
  field: NewGameField;
  message: string;
}

/** What is still missing, field by field in the order of the form; empty when the game can be created. */
export function newGameProblems(form: NewGameForm): NewGameProblem[] {
  const out: NewGameProblem[] = [];
  if (!form.title.trim()) out.push({ field: 'title', message: 'Give the game a title.' });
  if (!form.summary.trim()) out.push({ field: 'summary', message: 'Describe the game in a sentence or two (the summary).' });
  const [min, max] = [Number(form.min), Number(form.max)];
  const whole = (n: number, text: string) => text.trim() !== '' && Number.isInteger(n) && n >= 1 && n <= 32;
  if (!whole(min, form.min) || !whole(max, form.max)) out.push({ field: 'players', message: 'Say how many players: the fewest and the most, whole numbers from 1 to 32.' });
  else if (min > max) out.push({ field: 'players', message: 'The fewest players cannot be more than the most.' });
  if (!form.win.trim()) out.push({ field: 'win', message: 'Say how the game is won.' });
  if (!form.lose.trim()) out.push({ field: 'lose', message: 'Say how the game is lost.' });
  if (form.roles.some((r) => !r.name.trim())) out.push({ field: 'roles', message: 'Give every role a name, or remove the empty ones.' });
  return out;
}

/** What is still missing, as sentences for the creator; empty when the game can be created. */
export const validateNewGame = (form: NewGameForm): string[] => newGameProblems(form).map((p) => p.message);

const roleId = (name: string, used: Set<string>): string => {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'role';
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  used.add(id);
  return id;
};

/** The template's project with the written instructions in it, the scene named after the game and its declared player count set to the instructions'. */
export function newGameSnapshot(form: NewGameForm): ProjectSnapshot {
  const snapshot = templateSnapshot(form.template);
  const players = { min: Number(form.min), max: Number(form.max) };
  const used = new Set<string>();
  const instructions = parseInstructions({
    title: form.title,
    summary: form.summary,
    players,
    win: form.win,
    lose: form.lose,
    roles: form.roles.filter((r) => r.name.trim()).map((r) => ({ id: roleId(r.name, used), name: r.name, brief: r.brief, kind: r.kind })),
    phases: form.phases.filter((p) => p.title.trim() || p.text.trim()).map((p) => ({ title: p.title, text: p.text, steps: [] })),
  });
  snapshot.instructions = instructions;
  snapshot.scene.name = instructions.title;
  const inputs = snapshot.scene.inputs;
  if (typeof inputs === 'object' && inputs !== null) snapshot.scene.inputs = { ...inputs, players: [instructions.players.min, instructions.players.max] };
  return snapshot;
}

/** The New game sheet. `open` gets the new project once the instructions are filled in and Create is pressed. */
export function openNewGameSheet(open: (s: ProjectSnapshot) => void, template: TemplateId = 'blank'): void {
  openSheet('New game', (body, close) => {
    body.classList.add('nf-body');
    const form = emptyForm(template);
    let playersEdited = false;
    /** A field's message shows once it has been left or Create was pressed; the form does not open full of warnings. */
    const touched = new Set<NewGameField>();
    let attempted = false;
    const errors = new Map<NewGameField, HTMLElement>();
    const controls = new Map<NewGameField, HTMLElement[]>();
    const summary = el('p', { class: 'nf-summary', role: 'status' });
    const roleNames: HTMLInputElement[] = [];

    const errorFor = (field: NewGameField): HTMLElement => {
      let e = errors.get(field);
      if (!e) {
        e = el('p', { class: 'sheet-error', id: `nf-error-${field}`, 'aria-live': 'polite', hidden: true });
        errors.set(field, e);
      }
      return e;
    };
    const register = (field: NewGameField, control: HTMLElement, required = true) => {
      controls.set(field, [...(controls.get(field) ?? []), control]);
      control.setAttribute('aria-describedby', errorFor(field).id);
      if (required) control.setAttribute('aria-required', 'true');
    };
    const refresh = () => {
      const problems = newGameProblems(form);
      const byField = new Map<NewGameField, string>();
      for (const p of problems) if (!byField.has(p.field)) byField.set(p.field, p.message);
      for (const [field, e] of errors) {
        const show = (touched.has(field) || attempted) && byField.has(field);
        e.hidden = !show;
        e.textContent = show ? byField.get(field)! : '';
        for (const c of controls.get(field) ?? []) {
          if (field === 'roles') continue;
          if (show) c.setAttribute('aria-invalid', 'true');
          else c.removeAttribute('aria-invalid');
        }
      }
      const rolesShown = (touched.has('roles') || attempted) && byField.has('roles');
      for (const input of roleNames) {
        if (rolesShown && !input.value.trim()) input.setAttribute('aria-invalid', 'true');
        else input.removeAttribute('aria-invalid');
      }
      summary.textContent = problems.length ? `${problems.length} ${problems.length === 1 ? 'thing' : 'things'} still needed: ${problems[0]!.message}` : 'Ready to create.';
    };
    const leave = (field: NewGameField) => () => { touched.add(field); refresh(); };

    const label = (text: string, required: boolean): HTMLElement => el('span', {}, [text, ...(required ? [el('span', { class: 'nf-req', 'aria-hidden': 'true' }, [' *'])] : [])]);
    /** A labelled control, with its message underneath when it has one. */
    const field = (text: string, control: HTMLElement, key: NewGameField | null, required = true): HTMLElement => {
      if (key) register(key, control, required);
      return el('div', { class: 'nf-field' }, [el('label', {}, [label(text, required), control]), ...(key ? [errorFor(key)] : [])]);
    };
    const textInput = (value: string, placeholder: string, set: (v: string) => void, key: NewGameField | null): HTMLInputElement => {
      const input = el('input', { type: 'text', placeholder });
      input.value = value;
      input.addEventListener('input', () => { set(input.value); refresh(); });
      if (key) input.addEventListener('blur', leave(key));
      return input;
    };
    const area = (value: string, rows: number, placeholder: string, set: (v: string) => void, key: NewGameField | null): HTMLTextAreaElement => {
      const a = el('textarea', { rows, placeholder });
      a.value = value;
      a.addEventListener('input', () => { set(a.value); refresh(); });
      if (key) a.addEventListener('blur', leave(key));
      return a;
    };

    const titleInput = textInput(form.title, 'The name players see, e.g. Relay Race', (v) => (form.title = v), 'title');
    titleInput.setAttribute('autofocus', '');

    const templateSelect = el('select', { 'aria-label': 'Start from' }, TEMPLATES.map((t) => el('option', { value: t.id }, [t.label])));
    templateSelect.value = form.template;
    const blurb = el('p', { class: 'nf-hint' }, [TEMPLATES.find((t) => t.id === form.template)?.blurb ?? '']);

    const num = (value: string, placeholder: string, name: string, set: (v: string) => void) => {
      const input = el('input', { type: 'number', min: 1, max: 32, placeholder, 'aria-label': name });
      input.value = value;
      input.addEventListener('input', () => { playersEdited = true; set(input.value); refresh(); });
      input.addEventListener('blur', leave('players'));
      register('players', input);
      return input;
    };
    const minInput = num(form.min, '2', 'Fewest players', (v) => (form.min = v));
    const maxInput = num(form.max, '4', 'Most players', (v) => (form.max = v));
    templateSelect.addEventListener('change', () => {
      form.template = templateSelect.value as TemplateId;
      blurb.textContent = TEMPLATES.find((t) => t.id === form.template)?.blurb ?? '';
      const players = templatePlayers(form.template);
      if (!playersEdited) {
        form.min = players ? String(players[0]) : '';
        form.max = players ? String(players[1]) : '';
        minInput.value = form.min;
        maxInput.value = form.max;
      }
      refresh();
    });
    const caption = (text: string, input: HTMLElement) => el('label', {}, [text, input]);
    const playersField = el('div', { class: 'nf-field', role: 'group', 'aria-label': 'Players' }, [
      label('Players', true),
      el('div', { class: 'nf-players' }, [caption('Fewest', minInput), el('span', {}, ['to']), caption('Most', maxInput)]),
      el('p', { class: 'nf-hint', style: 'margin:0' }, ['Whole numbers, 1 to 32.']),
      errorFor('players'),
    ]);

    const card = (title: string, removeLabel: string, onRemove: () => void, children: Node[]): HTMLElement => el('div', { class: 'nf-card' }, [
      el('div', { class: 'nf-head' }, [el('strong', {}, [title]), button('Remove', onRemove, { variant: 'borderless', danger: true, ariaLabel: removeLabel })]),
      ...children,
    ]);
    const rolesBox = el('div');
    const phasesBox = el('div');
    let focusNew: 'role' | 'phase' | null = null;
    const renderRoles = () => {
      roleNames.length = 0;
      const addRole = button('Add role', () => { form.roles.push({ name: '', brief: '', kind: 'player' }); focusNew = 'role'; renderRoles(); refresh(); }, { variant: 'small' });
      addRole.disabled = form.roles.length >= INSTRUCTION_LIMITS.roles;
      rolesBox.replaceChildren(
        ...form.roles.map((r, n) => {
          const kind = el('select', { 'aria-label': `Kind of role ${n + 1}` }, [el('option', { value: 'player' }, ['Player']), el('option', { value: 'ref' }, ['Referee'])]);
          kind.value = r.kind;
          kind.addEventListener('change', () => { r.kind = kind.value === 'ref' ? 'ref' : 'player'; });
          const name = textInput(r.name, 'What players call this role, e.g. Referee', (v) => (r.name = v), null);
          name.addEventListener('blur', leave('roles'));
          name.setAttribute('aria-label', `Name of role ${n + 1}`);
          name.setAttribute('aria-describedby', errorFor('roles').id);
          roleNames.push(name);
          const brief = area(r.brief, 3, 'What this role does and knows, e.g. Starts each round and calls the winner', (v) => (r.brief = v), null);
          return card(`Role ${n + 1}`, `Remove role ${n + 1}`, () => { form.roles.splice(n, 1); renderRoles(); refresh(); }, [
            el('div', { class: 'nf-row' }, [field('Name', name, null), field('Kind', kind, null, false)]),
            field('Brief (optional)', brief, null, false),
          ]);
        }),
        errorFor('roles'),
        addRole,
      );
      if (focusNew === 'role') roleNames.at(-1)?.focus();
      focusNew = null;
    };
    const renderPhases = () => {
      const phaseTitles: HTMLInputElement[] = [];
      const addPhase = button('Add phase', () => { form.phases.push({ title: '', text: '' }); focusNew = 'phase'; renderPhases(); }, { variant: 'small' });
      addPhase.disabled = form.phases.length >= INSTRUCTION_LIMITS.phases;
      phasesBox.replaceChildren(
        ...form.phases.map((p, n) => {
          const title = textInput(p.title, 'e.g. Warm up', (v) => (p.title = v), null);
          title.setAttribute('aria-label', `Title of phase ${n + 1}`);
          phaseTitles.push(title);
          const text = area(p.text, 3, 'What happens in this phase, in a sentence or two', (v) => (p.text = v), null);
          return card(`Phase ${n + 1}`, `Remove phase ${n + 1}`, () => { form.phases.splice(n, 1); renderPhases(); }, [
            field('Title', title, null, false),
            field('Text', text, null, false),
          ]);
        }),
        addPhase,
      );
      if (focusNew === 'phase') phaseTitles.at(-1)?.focus();
      focusNew = null;
    };
    renderRoles();
    renderPhases();

    const section = (title: string, ...children: Node[]) => el('div', { class: 'nf-section' }, [el('div', { class: 'nf-section-title' }, [title]), ...children]);
    const scroll = el('div', { class: 'nf-scroll' }, [
      el('p', { class: 'nf-hint' }, ['Write how the game is played first: the player limit, the roles and the playtest agents start from it. * means required.']),
      field('Start from', templateSelect, null, false), blurb,
      field('Title', titleInput, 'title'),
      field('Summary', area(form.summary, 3, 'What the game is, in a few sentences', (v) => (form.summary = v), 'summary'), 'summary'),
      playersField,
      field('How the game is won', area(form.win, 2, 'e.g. The first team across the line wins', (v) => (form.win = v), 'win'), 'win'),
      field('How the game is lost', area(form.lose, 2, 'e.g. Drop the baton and you are out', (v) => (form.lose = v), 'lose'), 'lose'),
      section('Roles', rolesBox),
      section('Phases (optional)', phasesBox),
    ]);

    const focusProblem = (problem: NewGameProblem) => {
      const target = problem.field === 'roles' ? roleNames.find((i) => !i.value.trim()) : controls.get(problem.field)?.find((c) => c.getAttribute('aria-invalid') === 'true') ?? controls.get(problem.field)?.[0];
      target?.focus();
    };
    const create = button('Create game', () => {
      const problems = newGameProblems(form);
      if (problems.length) {
        attempted = true;
        refresh();
        focusProblem(problems[0]!);
        return;
      }
      close();
      open(newGameSnapshot(form));
    }, { variant: 'default' });
    refresh();
    body.append(scroll, el('div', { class: 'nf-footer' }, [summary, button('Cancel', close), create]));
  }, { className: 'sheet--form' });
}
