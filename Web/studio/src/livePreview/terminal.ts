// Terminal: monospace log of /debug frames and each device's in/out frames, with a filter box, Clear and an auto-scroll toggle.
import { announce, button, clock, el } from '../ui';
import { appendRow, filterLog, type LogRow } from './helpers';

export class PreviewTerminal {
  readonly element = el('section', { class: 'lp-terminal', 'aria-label': 'Terminal' });
  private rows: LogRow[] = [];
  private query = '';
  private autoScroll = true;
  private readonly log = el('div', { class: 'lp-log', role: 'log', 'aria-live': 'off', tabindex: '0' });
  private readonly count = el('span', { class: 'lp-count' });
  private pending = false;

  constructor() {
    const filter = el('input', { type: 'search', class: 'lp-filter', placeholder: 'Filter (e.g. ipad fire)', 'aria-label': 'Filter the terminal', spellcheck: 'false' }) as HTMLInputElement;
    filter.addEventListener('input', () => {
      this.query = filter.value;
      this.renderAll();
    });
    const auto = el('input', { type: 'checkbox', checked: true }) as HTMLInputElement;
    auto.addEventListener('change', () => {
      this.autoScroll = auto.checked;
      if (this.autoScroll) this.log.scrollTop = this.log.scrollHeight;
    });
    const clear = button('Clear', () => {
      this.rows = [];
      this.renderAll();
      announce('Terminal cleared');
    }, { variant: 'small' });
    this.element.append(
      el('div', { class: 'lp-terminal-bar' }, [el('strong', {}, ['Terminal']), filter, el('label', { class: 'lp-check' }, [auto, ' Auto-scroll']), clear, this.count]),
      this.log,
    );
    this.renderAll();
  }

  add(row: Omit<LogRow, 'id'>): void {
    this.rows = appendRow(this.rows, row);
    this.schedule();
  }

  /** Rows added in one burst (a 30 Hz sensor, a snapshot) render once per animation frame, not once per row. */
  private schedule(): void {
    if (this.pending) return;
    this.pending = true;
    const run = () => {
      this.pending = false;
      this.renderAll();
    };
    typeof requestAnimationFrame === 'function' ? requestAnimationFrame(run) : setTimeout(run, 16);
  }

  get size(): number {
    return this.rows.length;
  }

  private renderAll(): void {
    const shown = filterLog(this.rows, this.query);
    this.log.replaceChildren(
      ...(shown.length ? shown.map(lineEl) : [el('p', { class: 'lp-empty' }, [this.rows.length ? 'No lines match the filter.' : 'Nothing yet. Frames appear here once the devices connect.'])]),
    );
    this.count.textContent = this.query ? `${shown.length} of ${this.rows.length}` : `${this.rows.length}`;
    if (this.autoScroll) this.log.scrollTop = this.log.scrollHeight;
  }
}

const ARROW = { in: '←', out: '→', sys: '·', debug: '▪' } as const;

function lineEl(r: LogRow): HTMLElement {
  return el('div', { class: `lp-line lp-${r.dir} lp-lv-${r.level}` }, [
    el('span', { class: 'lp-t' }, [clock(r.t)]),
    el('span', { class: 'lp-src' }, [r.source]),
    el('span', { class: 'lp-dir', 'aria-label': r.dir }, [ARROW[r.dir]]),
    el('span', { class: 'lp-name' }, [r.name]),
    el('span', { class: 'lp-text' }, [r.text]),
  ]);
}
