import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/studio-tokens.css', import.meta.url), 'utf8');

/** `--name: #hex` pairs of the first block that starts with `opener`. */
function tokens(opener: string): Record<string, string> {
  const start = css.indexOf(opener);
  const body = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1]!, m[2]!.toLowerCase()]));
}

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

/** WCAG contrast ratio. */
function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe('studio color tokens', () => {
  const dark = tokens(':root, [data-theme="dark"]');
  const light = tokens('[data-theme="light"]');

  it('dark: the accent reads as text and as a fill', () => {
    for (const ground of ['bg-panel', 'bg-field', 'viewport']) expect(ratio(dark['accent']!, dark[ground]!)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(dark['on-accent']!, dark['accent']!)).toBeGreaterThanOrEqual(4.5);
  });

  it('dark: text stays readable on the selected row, and a selected entity is visible on the viewport', () => {
    expect(ratio(dark['text']!, dark['bg-selected']!)).toBeGreaterThanOrEqual(7);
    expect(ratio(dark['selection']!, dark['viewport']!)).toBeGreaterThanOrEqual(3);
  });

  it('dark: the accent is too close to the unselected edge color to mark a selection, which is why --selection exists', () => {
    expect(ratio(dark['accent']!, dark['text']!)).toBeLessThan(1.2);
    expect(dark['selection']).not.toBe(dark['accent']);
  });

  it('light: the accent reads as text and as a fill, text reads on the selected row, selection shows on the viewport', () => {
    expect(ratio(light['accent']!, light['bg-panel']!)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(light['on-accent']!, light['accent']!)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(light['text']!, light['bg-selected']!)).toBeGreaterThanOrEqual(7);
    expect(ratio(light['selection']!, light['viewport']!)).toBeGreaterThanOrEqual(3);
  });

  it('ok is readable beside its word in both themes', () => {
    expect(ratio(dark['ok']!, dark['bg-panel']!)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(light['ok']!, light['bg-panel']!)).toBeGreaterThanOrEqual(4.5);
  });
});
