import { describe, expect, it } from 'vitest';
import { nextScreen } from '../src/screens';
import { MAX_RECENT, capOpened, formatWhen, mergeProjects, pushRecent, removeRecent, thumbHit, type RecentEntry } from '../src/recent';
import { templateSnapshot } from '../src/project';
import { renderThumbnail } from '../src/thumbnail';

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

describe('mergeProjects with opened times', () => {
  const games = [{ id: 'g1', title: 'G', updated_at: new Date(2000).toISOString() }];

  it('an Open later than the newest edit lifts the row and keeps the edit time', () => {
    const rows = mergeProjects(games, [entry('a', 3000)], false, { 'cloud:g1': 5000 });
    expect(rows.map((r) => r.key)).toEqual(['g1', 'a']);
    expect(rows[0]!.opened).toBe(5000);
    expect(rows[0]!.time).toBe(2000);
    expect(rows[1]!.opened).toBeUndefined();
  });

  it('the draft takes its time from draftAt; without it the draft stays last and untimed', () => {
    const timed = mergeProjects([], [entry('a', 1000)], true, {}, 4000);
    expect(timed.map((r) => r.key)).toEqual(['draft', 'a']);
    expect(timed[0]!.time).toBe(4000);
    const untimed = mergeProjects([], [entry('a', 1000)], true);
    expect(untimed.map((r) => r.key)).toEqual(['a', 'draft']);
    expect(untimed[1]!.time).toBeUndefined();
  });

  it('the stamp follows the content time: cloud updated_at, local savedAt, draft time', () => {
    const rows = mergeProjects(games, [entry('a', 3000)], true, {}, 4000);
    expect(rows.find((r) => r.kind === 'cloud')!.stamp).toBe(games[0]!.updated_at);
    expect(rows.find((r) => r.kind === 'local')!.stamp).toBe('3000');
    expect(rows.find((r) => r.kind === 'draft')!.stamp).toBe('4000');
  });
});

describe('formatWhen', () => {
  const ms = Date.UTC(2026, 10, 14, 14, 5);

  it('writes the label and a short date and time in the given locale and zone', () => {
    expect(formatWhen(ms, 'Edited', 'en-GB', 'UTC')).toBe('Edited 14 Nov 2026, 14:05');
    expect(formatWhen(ms, 'Opened', 'en-GB', 'UTC')).toBe('Opened 14 Nov 2026, 14:05');
  });

  it('says what is missing when the time is unknown', () => {
    expect(formatWhen(undefined, 'Opened')).toBe('Not opened here');
    expect(formatWhen(undefined, 'Edited')).toBe('Not saved yet');
  });
});

describe('thumbnail cache', () => {
  it('hits only for the same stamp', () => {
    const cache = { 'local:a': { stamp: '3000', url: 'data:image/jpeg;base64,AAAA' } };
    expect(thumbHit(cache, 'local:a', '3000')).toBe('data:image/jpeg;base64,AAAA');
    expect(thumbHit(cache, 'local:a', '3001')).toBeUndefined();
    expect(thumbHit(cache, 'local:b', '3000')).toBeUndefined();
  });

  it('capOpened keeps the newest entries', () => {
    const kept = capOpened({ a: 1, b: 3, c: 2 }, 2);
    expect(Object.keys(kept).sort()).toEqual(['b', 'c']);
  });

  it('renderThumbnail returns undefined where there is no DOM or WebGL (the node test environment)', () => {
    expect(renderThumbnail(templateSnapshot('blank').scene)).toBeUndefined();
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
