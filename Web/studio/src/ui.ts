// Small DOM helpers shared by every panel: element builder, icons, announcer, modal sheet, popup menu.
import type { UsisPacket } from '@omni/core';

type Attr = string | number | boolean | undefined;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Record<string, Attr> = {}, children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    node.setAttribute(k, v === true ? '' : String(v));
  }
  node.append(...children);
  return node;
}

export function icon(name: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'om-icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

/** A button with an optional icon; `variant` picks a brand-kit class. */
export function button(label: string, onClick: () => void, options: { icon?: string; variant?: 'default' | 'borderless' | 'small'; ariaLabel?: string } = {}): HTMLButtonElement {
  const b = el('button', {
    type: 'button',
    class: `om-btn${options.variant ? ` om-btn--${options.variant}` : ''}`,
    'aria-label': options.ariaLabel,
  });
  if (options.icon) b.append(icon(options.icon));
  b.append(label);
  b.addEventListener('click', onClick);
  return b;
}

/** Screen-reader announcement (#announcer is a polite live region in index.html). */
export function announce(text: string): void {
  const region = document.getElementById('announcer');
  if (region) region.textContent = text;
}

export const clock = (ms: number): string => new Date(ms).toLocaleTimeString([], { hour12: false }) + '.' + String(ms % 1000).padStart(3, '0');

let sheetCount = 0;

/** The UI scale preference (--ui-scale on :root); menus and sheets live outside #studio and apply it themselves. */
export const uiScale = (): number => Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1;

/** Fixed-position left/top for a menu under `anchor`, in the menu's own zoomed units. */
export function menuPosition(anchor: { left: number; bottom: number }, scale: number, viewportWidth: number): { left: number; top: number } {
  return { left: Math.max(0, Math.min(anchor.left, viewportWidth - 240 * scale)) / scale, top: (anchor.bottom + 2) / scale };
}

/** Modal sheet on a native <dialog>: focus trap, Escape and backdrop come from the platform. Returns close. */
export function openSheet(title: string, build: (body: HTMLElement, close: () => void) => void): () => void {
  const titleId = `sheet-title-${++sheetCount}`;
  const dialog = el('dialog', { class: 'sheet', 'aria-labelledby': titleId });
  const body = el('div');
  dialog.append(el('h2', { id: titleId }, [title]), body);
  const close = () => {
    dialog.close();
    dialog.remove();
  };
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  build(body, close);
  document.body.append(dialog);
  dialog.showModal();
  return close;
}

export interface MenuItem {
  label?: string;
  checked?: boolean;
  disabled?: boolean;
  /** A non-interactive heading. */
  heading?: boolean;
  separator?: boolean;
  run?: () => void;
}

/** Popup menu under `anchor`; arrow keys move, Enter runs, Escape closes and returns focus to the anchor. */
export function openMenu(anchor: HTMLElement, items: MenuItem[]): void {
  document.querySelectorAll('.menu').forEach((m) => m.remove());
  const menu = el('div', { class: 'menu', role: 'menu', 'aria-label': anchor.getAttribute('aria-label') || anchor.textContent || 'Menu' });
  anchor.setAttribute('aria-haspopup', 'menu');
  anchor.setAttribute('aria-expanded', 'true');
  const buttons: HTMLButtonElement[] = [];
  const close = (refocus: boolean) => {
    menu.remove();
    anchor.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    if (refocus) anchor.focus();
  };
  const outside = (e: Event) => {
    if (!menu.contains(e.target as Node)) close(false);
  };
  for (const item of items) {
    if (item.separator) menu.append(el('hr', { role: 'separator' }));
    else if (item.heading) menu.append(el('div', { class: 'menu-label', role: 'presentation' }, [item.label ?? '']));
    else {
      const checkable = item.checked !== undefined;
      const b = el('button', {
        type: 'button', role: checkable ? 'menuitemcheckbox' : 'menuitem', 'aria-checked': checkable ? String(item.checked) : undefined, disabled: item.disabled,
      }, [el('span', { class: 'menu-check', 'aria-hidden': 'true' }, [item.checked ? '\u2713' : '']), item.label ?? '']);
      b.addEventListener('click', () => {
        close(true);
        item.run?.();
      });
      buttons.push(b);
      menu.append(b);
    }
  }
  menu.addEventListener('keydown', (e) => {
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') close(true);
    else if (e.key === 'ArrowDown') buttons[(i + 1) % buttons.length]?.focus();
    else if (e.key === 'Home') buttons.find((b) => !b.disabled)?.focus();
    else if (e.key === 'End') [...buttons].reverse().find((b) => !b.disabled)?.focus();
    else if (e.key === 'ArrowUp') buttons[(i - 1 + buttons.length) % buttons.length]?.focus();
    else if (e.key === 'Tab') close(true);
    else return;
    e.preventDefault();
  });
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const at = menuPosition(r, uiScale(), window.innerWidth);
  menu.style.left = `${at.left}px`;
  menu.style.top = `${at.top}px`;
  document.addEventListener('pointerdown', outside, true);
  buttons.find((b) => !b.disabled)?.focus();
}

/** Pretty JSON for a USIS packet with the brand-kit key and axis classes (PacketLog markup). */
export function packetHtml(packet: UsisPacket): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const vec = (v: readonly number[]) => `[${v.map((n, i) => `<span class="${'xyz'[i] ?? ''}">${n}</span>`).join(', ')}]`;
  const lines = (obj: Record<string, unknown>, indent: string): string[] =>
    Object.entries(obj).map(([k, v]) => {
      const key = `${indent}<span class="k">"${esc(k)}"</span>: `;
      if (Array.isArray(v) && v.every((n) => typeof n === 'number') && v.length <= 4) return key + vec(v as number[]);
      if (typeof v === 'object' && v !== null && !Array.isArray(v)) return `${key}{\n${lines(v as Record<string, unknown>, indent + '  ').join(',\n')}\n${indent}}`;
      return key + esc(JSON.stringify(v));
    });
  return `{\n${lines(packet as unknown as Record<string, unknown>, '  ').join(',\n')}\n}`;
}

/** One-field sheet. `onSubmit` returns an error sentence to keep the sheet open, or undefined to close it. */
export function promptSheet(title: string, label: string, initial: string, submitLabel: string, onSubmit: (value: string) => string | undefined): void {
  openSheet(title, (body, close) => {
    const input = el('input', { type: 'text', value: initial, 'aria-label': label, spellcheck: 'false' });
    const error = el('p', { class: 'sheet-error', role: 'alert' });
    const submit = () => {
      const problem = onSubmit(input.value.trim());
      if (problem) error.textContent = problem;
      else close();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
    body.append(
      el('div', { class: 'om-prop' }, [el('label', {}, [label]), el('div', { class: 'om-field' }, [input])]), error,
      el('div', { class: 'sheet-actions' }, [button('Cancel', close), button(submitLabel, submit, { variant: 'default' })]),
    );
    input.focus();
    input.select();
  });
}
