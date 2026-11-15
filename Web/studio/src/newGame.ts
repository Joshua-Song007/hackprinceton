// File > New game: pick a template, then write the game's instructions before anything is created. The instructions are what
// the player limit, the simulated players' roles and the playtest agents all start from, so a game does not exist without them.
import { parseInstructions } from '@pear/runtime';
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

/** What is still missing, as sentences for the creator; empty when the game can be created. */
export function validateNewGame(form: NewGameForm): string[] {
  const out: string[] = [];
  if (!form.title.trim()) out.push('Give the game a title.');
  if (!form.summary.trim()) out.push('Describe the game in a sentence or two (the summary).');
  const [min, max] = [Number(form.min), Number(form.max)];
  const whole = (n: number, text: string) => text.trim() !== '' && Number.isInteger(n) && n >= 1 && n <= 32;
  if (!whole(min, form.min) || !whole(max, form.max)) out.push('Say how many players: the fewest and the most, whole numbers from 1 to 32.');
  else if (min > max) out.push('The fewest players cannot be more than the most.');
  if (!form.win.trim()) out.push('Say how the game is won.');
  if (!form.lose.trim()) out.push('Say how the game is lost.');
  if (form.roles.some((r) => !r.name.trim())) out.push('Give every role a name, or remove the empty ones.');
  return out;
}

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
    const form = emptyForm(template);
    let playersEdited = false;
    const missing = el('ul', { class: 'om-list', 'aria-label': 'Still needed', role: 'status' });
    const create = button('Create game', () => {
      if (validateNewGame(form).length) return;
      close();
      open(newGameSnapshot(form));
    }, { variant: 'default' });
    const refresh = () => {
      const problems = validateNewGame(form);
      missing.replaceChildren(...problems.map((p) => el('li', { class: 'om-sub' }, [p])));
      create.disabled = problems.length > 0;
    };
    const field = (label: string, control: HTMLElement) => el('label', { style: 'display:grid;gap:2px;padding:4px 0' }, [label, control]);
    const text = (value: string, placeholder: string, set: (v: string) => void) => {
      const input = el('input', { type: 'text', placeholder });
      input.value = value;
      input.addEventListener('input', () => { set(input.value); refresh(); });
      return input;
    };
    const area = (value: string, rows: number, placeholder: string, set: (v: string) => void) => {
      const a = el('textarea', { rows, placeholder });
      a.value = value;
      a.addEventListener('input', () => { set(a.value); refresh(); });
      return a;
    };
    const num = (value: string, placeholder: string, label: string, set: (v: string) => void) => {
      const input = el('input', { type: 'number', min: 1, max: 32, placeholder, 'aria-label': label });
      input.value = value;
      input.addEventListener('input', () => { playersEdited = true; set(input.value); refresh(); });
      return input;
    };
    const minInput = num(form.min, '2', 'Fewest players', (v) => (form.min = v));
    const maxInput = num(form.max, '4', 'Most players', (v) => (form.max = v));

    const templateSelect = el('select', { 'aria-label': 'Template' }, TEMPLATES.map((t) => el('option', { value: t.id }, [t.label])));
    templateSelect.value = form.template;
    const blurb = el('p', { class: 'om-sub', style: 'margin:2px 0 6px' }, [TEMPLATES.find((t) => t.id === form.template)?.blurb ?? '']);
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

    const rolesBox = el('div');
    const phasesBox = el('div');
    const renderRoles = () => {
      rolesBox.replaceChildren(
        ...form.roles.flatMap((r, n) => {
          const kind = el('select', { 'aria-label': `Kind of role ${n + 1}` }, [el('option', { value: 'player' }, ['Player']), el('option', { value: 'ref' }, ['Referee'])]);
          kind.value = r.kind;
          kind.addEventListener('change', () => { r.kind = kind.value === 'ref' ? 'ref' : 'player'; });
          const name = text(r.name, 'What players call this role, e.g. Referee', (v) => (r.name = v));
          name.setAttribute('aria-label', `Name of role ${n + 1}`);
          const brief = area(r.brief, 2, 'What this role does and knows, e.g. Starts each round and calls the winner', (v) => (r.brief = v));
          brief.setAttribute('aria-label', `Brief of role ${n + 1}`);
          return [
            field(`Role ${n + 1}`, name), kind, brief,
            button('Remove role', () => { form.roles.splice(n, 1); renderRoles(); refresh(); }, { variant: 'small', ariaLabel: `Remove role ${n + 1}` }),
          ];
        }),
        button('Add role', () => { form.roles.push({ name: '', brief: '', kind: 'player' }); renderRoles(); refresh(); }, { variant: 'small' }),
      );
    };
    const renderPhases = () => {
      phasesBox.replaceChildren(
        ...form.phases.flatMap((p, n) => {
          const title = text(p.title, 'e.g. Warm up', (v) => (p.title = v));
          title.setAttribute('aria-label', `Title of phase ${n + 1}`);
          const phaseText = area(p.text, 2, 'What happens in this phase, in a sentence or two', (v) => (p.text = v));
          phaseText.setAttribute('aria-label', `Text of phase ${n + 1}`);
          return [
            field(`Phase ${n + 1}`, title), phaseText,
            button('Remove phase', () => { form.phases.splice(n, 1); renderPhases(); }, { variant: 'small', ariaLabel: `Remove phase ${n + 1}` }),
          ];
        }),
        button('Add phase', () => { form.phases.push({ title: '', text: '' }); renderPhases(); }, { variant: 'small' }),
      );
    };
    renderRoles();
    renderPhases();

    const fields = el('div', { style: 'max-height:60vh;overflow:auto;padding-right:8px' }, [
      field('Template', templateSelect), blurb,
      el('p', { class: 'om-sub' }, ['Write down how the game is played first. The player limit, the roles of the simulated players and the playtest agents all start from it, and you can change any of it later in the Instructions panel.']),
      field('Title', text(form.title, 'The name players see, e.g. Relay Race', (v) => (form.title = v))),
      field('Summary', area(form.summary, 3, 'What the game is, in a few sentences', (v) => (form.summary = v))),
      el('div', { style: 'display:flex;gap:8px;align-items:center;padding:4px 0' }, ['Players', minInput, 'to', maxInput]),
      field('How the game is won', area(form.win, 2, 'e.g. The first team across the line wins', (v) => (form.win = v))),
      field('How the game is lost', area(form.lose, 2, 'e.g. Drop the baton and you are out', (v) => (form.lose = v))),
      el('strong', {}, ['Roles']), rolesBox,
      el('strong', {}, ['Phases (optional)']), phasesBox,
    ]);
    refresh();
    body.append(fields, el('p', { class: 'om-sub' }, ['Still needed:']), missing, el('div', { style: 'display:flex;gap:8px;padding-top:8px' }, [create, button('Cancel', close)]));
  });
}
