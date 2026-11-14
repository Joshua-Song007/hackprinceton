// File > New game: pick a template with a one-line description of what it teaches.
import { TEMPLATES, templateSnapshot, type ProjectSnapshot } from './project';
import { button, el, openSheet } from './ui';

export function openNewGameSheet(open: (s: ProjectSnapshot) => void): void {
  openSheet('New game', (body, close) => {
    for (const t of TEMPLATES) {
      body.append(el('div', { style: 'padding:6px 0' }, [
        el('strong', {}, [t.label]), el('p', { class: 'om-sub', style: 'margin:2px 0 4px' }, [t.blurb]),
        button(`Create ${t.label}`, () => { close(); open(templateSnapshot(t.id)); }, { variant: 'small' }),
      ]));
    }
    body.append(button('Cancel', close));
  });
}
