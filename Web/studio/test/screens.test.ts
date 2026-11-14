import { describe, expect, it } from 'vitest';
import { nextScreen } from '../src/screens';
import { MAX_RECENT, mergeProjects, pushRecent, removeRecent, type RecentEntry } from '../src/recent';
import { templateSnapshot } from '../src/project';

const entry = (id: string, savedAt = 0): RecentEntry => ({ id, name: id, savedAt, snapshot: templateSnapshot('blank') });

describe('nextScreen', () => {
  it('gates on sign-in, then on an open project; test players skip it', () => {
    expect(nextScreen(false, false)).toBe('login');
    expect(nextScreen(false, true)).toBe('login');
    expect(nextScreen(true, false)).toBe('projects');
    expect(nextScreen(true, true)).toBe('editor');
    expect(nextScreen(false, false, true)).toBe('editor');
  });
});

describe('mergeProjects', () => {
  it('merges sources newest first, untimed rows last', () => {
    const rows = mergeProjects([{ id: 'g1', title: 'G', updated_at: new Date(2000).toISOString() }], [entry('a', 3000), entry('b', 1000)], true);
    expect(rows.map((r) => r.key)).toEqual(['a', 'g1', 'b', 'draft']);
    expect(rows[1]!.kind).toBe('cloud');
    expect(mergeProjects([], [], false)).toEqual([]);
  });
});

describe('recent projects', () => {
  it('newest first, one entry per id, capped', () => {
    let list: RecentEntry[] = [];
    for (let i = 0; i < MAX_RECENT + 3; i++) list = pushRecent(list, entry(`p${i}`));
    expect(list).toHaveLength(MAX_RECENT);
    expect(list[0]!.id).toBe(`p${MAX_RECENT + 2}`);
    list = pushRecent(list, entry('p5'));
    expect(list[0]!.id).toBe('p5');
    expect(list.filter((e) => e.id === 'p5')).toHaveLength(1);
    expect(removeRecent(list, 'p5').some((e) => e.id === 'p5')).toBe(false);
  });
});
