import { describe, expect, it } from 'vitest';
import { MANIFEST_FORMAT, MANIFEST_KEYS, ManifestError, RAISE_DEFAULTS, lintManifest, parseManifest } from '../src/manifest';
import { parseScene } from '../src/scene';
import quickDrawManifest from '../../../../Games/QuickDraw/pear-game.json';
import quickDrawScene from '../../../../Games/QuickDraw/scene.json';
import manifestSchema from '../../../../Schema/pear-game.schema.json';

const base = { format: MANIFEST_FORMAT, name: 'Demo' };

describe('parseManifest', () => {
  it('a minimal manifest gets the scene default and keeps unknown fields', () => {
    const m = parseManifest({ ...base, future: { a: 1 } });
    expect(m).toMatchObject({ format: MANIFEST_FORMAT, name: 'Demo', scene: 'scene.json', future: { a: 1 } });
    expect(m.players).toBeUndefined();
    expect(m.capabilities).toBeUndefined();
  });

  it('fills raise defaults and de-duplicates sensors and gestures', () => {
    const m = parseManifest({
      ...base,
      players: { min: 2, max: 4 },
      scripts: { server: ['game'] },
      capabilities: { tier: 2, sensors: ['motion', 'motion', 'head'], gestures: { builtin: ['tap', 'tap'], raise: {} } },
      controller: { ready: true },
      cues: {},
      instructions: { goal: 'x' },
      checks: 'check.json',
    });
    expect(m.players).toEqual({ min: 2, max: 4 });
    expect(m.scripts).toEqual({ client: [], server: ['game'] });
    expect(m.capabilities).toEqual({ tier: 2, sensors: ['motion', 'head'], gestures: { builtin: ['tap'], raise: RAISE_DEFAULTS } });
    expect(m.controller).toEqual({ ready: true });
    expect(m.checks).toBe('check.json');
  });

  it('names the field that is wrong', () => {
    const bad = (extra: Record<string, unknown>, text: RegExp) => {
      expect(() => parseManifest({ ...base, ...extra })).toThrow(ManifestError);
      expect(() => parseManifest({ ...base, ...extra })).toThrow(text);
    };
    expect(() => parseManifest(null)).toThrow(/manifest must be an object/);
    expect(() => parseManifest({ name: 'x' })).toThrow(/format must be "pear-game\/1"/);
    expect(() => parseManifest({ ...base, name: '  ' })).toThrow(/name must be a non-empty string/);
    expect(() => parseManifest({ ...base, name: 'x'.repeat(257) })).toThrow(/name must be/);
    bad({ scene: '../x.json' }, /scene must be a relative path/);
    bad({ scene: '/abs.json' }, /scene must be a relative path/);
    bad({ scene: 'a\\b.json' }, /scene must be a relative path/);
    bad({ checks: '' }, /checks must be a non-empty string/);
    bad({ scripts: { client: [1] } }, /scripts\.client\[0\]/);
    bad({ players: { min: 0, max: 2 } }, /players must be/);
    bad({ players: { min: 3, max: 2 } }, /players must be/);
    bad({ players: { min: 1, max: 33 } }, /players must be/);
    bad({ players: { min: 1.5, max: 2 } }, /players must be/);
    bad({ capabilities: { tier: 0 } }, /capabilities\.tier/);
    bad({ capabilities: { tier: 4 } }, /capabilities\.tier/);
    bad({ capabilities: { sensors: ['sonar'] } }, /unknown sensor 'sonar'/);
    bad({ capabilities: { gestures: { builtin: ['wave'] } } }, /unknown gesture 'wave'/);
    bad({ capabilities: { gestures: { raise: { angleDeg: 180 } } } }, /angleDeg must be between 0 and 180/);
    bad({ capabilities: { gestures: { raise: { angleDeg: 20, hysteresisDeg: 20 } } } }, /hysteresisDeg must be >= 0 and less than angleDeg/);
    bad({ capabilities: { gestures: { raise: { angleDeg: 'x' } } } }, /angleDeg must be a number/);
    bad({ controller: [] }, /controller must be an object/);
    bad({ cues: 'x' }, /cues must be an object/);
    bad({ instructions: 3 }, /instructions must be an object/);
  });
});

describe('raise defaults have one home', () => {
  it('the scene loader uses the manifest defaults', () => {
    expect(parseScene({ name: 'x', gestures: { raise: {} } }).raise).toEqual(RAISE_DEFAULTS);
  });
});

describe('lintManifest', () => {
  const scene = parseScene({
    name: 'x',
    requiredTier: 1,
    inputs: { players: [2, 2] },
    gestures: { raise: { angleDeg: 60, hysteresisDeg: 15 } },
    clientScripts: ['player'],
    serverScripts: ['game'],
  });

  it('a manifest that agrees with its scene has no warnings', () => {
    const m = parseManifest({
      ...base,
      players: { min: 2, max: 2 },
      scripts: { client: ['player'], server: ['game'] },
      capabilities: { tier: 1, gestures: { raise: { angleDeg: 60, hysteresisDeg: 15 } } },
    });
    expect(lintManifest(m, scene)).toEqual([]);
  });

  it('reports each difference with its own code', () => {
    const m = parseManifest({
      ...base,
      players: { min: 1, max: 4 },
      scripts: { client: ['ghost'], server: ['nope'] },
      capabilities: { tier: 3, gestures: { raise: {} } },
    });
    expect(lintManifest(m, scene).map((w) => w.code)).toEqual(['players-mismatch', 'tier-mismatch', 'raise-mismatch', 'scripts-missing', 'scripts-missing']);
    expect(lintManifest(m, scene)[0]!.message).toBe('The manifest allows 1 to 4 players but the scene says 2 to 2.');
  });

  it('says nothing about what the scene leaves out', () => {
    const open = parseScene({ name: 'x' });
    const m = parseManifest({ ...base, players: { min: 2, max: 2 }, capabilities: { gestures: { raise: {} } } });
    expect(lintManifest(m, open)).toEqual([]);
  });
});

describe('Quick Draw package', () => {
  it('parses and agrees with its scene', () => {
    const m = parseManifest(quickDrawManifest);
    expect(m.capabilities?.gestures.raise).toEqual({ angleDeg: 60, hysteresisDeg: 15 });
    expect(lintManifest(m, parseScene(quickDrawScene))).toEqual([]);
  });
});

describe('Schema/pear-game.schema.json', () => {
  it('describes exactly the fields the parser knows', () => {
    expect(Object.keys(manifestSchema.properties).sort()).toEqual([...MANIFEST_KEYS].sort());
    expect(manifestSchema.properties.format.const).toBe(MANIFEST_FORMAT);
  });
});
