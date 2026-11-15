import type { Instance } from '@pear/cloud';
import { describe, expect, it } from 'vitest';
import { ageLabel, groupByGame, listError, playersLabel, reachLabel, versionLabel } from '../src/lobbiesPanel';
import { ApiError } from '@pear/cloud';

const inst = (game_id: string, lobby: string, title?: string): Instance =>
  ({ game_id, lobby, ...(title ? { title } : {}), version: 1, players: [], started_at: '', last_activity_at: '' });

describe('groupByGame', () => {
  it('groups per game, titles A-Z, untitled last, lobbies by code', () => {
    const g = groupByGame([inst('z', 'BBB'), inst('b', 'ZZZ', 'Beta'), inst('a', 'QQQ', 'Alpha'), inst('b', 'AAA', 'Beta')]);
    expect(g.map((x) => x.title)).toEqual(['Alpha', 'Beta', 'z']);
    expect(g[1]!.lobbies.map((l) => l.lobby)).toEqual(['AAA', 'ZZZ']);
  });
  it('is empty for no lobbies', () => expect(groupByGame([])).toEqual([]));
});

describe('labels', () => {
  it('versions and players', () => {
    expect(versionLabel(3)).toBe('v3');
    expect(versionLabel(null)).toBe('unversioned');
    expect(playersLabel(1)).toBe('1 player');
    expect(playersLabel(0)).toBe('0 players');
  });
  it('reach', () => {
    expect(reachLabel(3, 3)).toBe('on latest');
    expect(reachLabel(2, 3)).toBe('behind (latest v3)');
    expect(reachLabel(null, 3)).toBe('');
    expect(reachLabel(2, undefined)).toBe('');
  });
  it('age', () => {
    const now = Date.parse('2026-01-01T12:00:00Z');
    expect(ageLabel('2026-01-01T11:59:40Z', now)).toBe('just now');
    expect(ageLabel('2026-01-01T11:55:00Z', now)).toBe('5 min ago');
    expect(ageLabel('2026-01-01T10:00:00Z', now)).toBe('2 h ago');
    expect(ageLabel('2025-12-29T12:00:00Z', now)).toBe('3 d ago');
    expect(ageLabel('nope', now)).toBe('');
  });
  it('list errors', () => {
    expect(listError(new ApiError('forbidden', 403, 'x'))).toMatch(/developer/);
    expect(listError(new ApiError('unauthorized', 401, 'x'))).toMatch(/Sign in/);
    expect(listError(new Error('boom'))).toMatch(/boom/);
  });
});
