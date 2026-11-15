import { describe, expect, it } from 'vitest';
import { DARK_VIEWPORT_COLORS } from '../src/viewport';

describe('viewport color defaults', () => {
  it('a selected entity has its own color: not the accent, not the unselected edge color', () => {
    expect(DARK_VIEWPORT_COLORS.selection).not.toBe(DARK_VIEWPORT_COLORS.accent);
    expect(DARK_VIEWPORT_COLORS.selection).not.toBe(DARK_VIEWPORT_COLORS.text);
  });

  it('every default is a 6-digit hex color', () => {
    for (const value of Object.values(DARK_VIEWPORT_COLORS)) expect(value).toMatch(/^#[0-9a-f]{6}$/);
  });
});
