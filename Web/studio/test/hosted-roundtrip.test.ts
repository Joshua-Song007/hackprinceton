import { describe, expect, it } from 'vitest';
import type { GameVersion } from '@pear/cloud';
import { Project, templateSnapshot } from '../src/project';
import { parseProjectFile, serializeProject } from '../src/projectFile';

const hosted = (): GameVersion => ({
  ...new Project(templateSnapshot('tapcounter')).toVersion(),
  id: 'version', game_id: 'hosted', version: 4, published_at: '',
  assets: { 'ui.json': { sha256: 'ui-hash' }, 'cover.png': 'image-hash' },
  metadata: { manifest: { format: 'pear-game/1', name: 'Hosted game' }, media: { thumbnail: { asset: 'cover.png' } }, custom: { retained: true } },
});

describe('hosted project fidelity', () => {
  it('preserves assets and custom metadata through open, snapshot, disk and republish', () => {
    const source = hosted();
    const project = new Project(Project.snapshotOfVersion(source));
    const reopened = new Project(parseProjectFile(serializeProject(project.snapshot())));
    const output = reopened.toVersion();
    expect(output.assets).toEqual(source.assets);
    expect(output.metadata).toMatchObject(source.metadata);
    expect(output.scene).toEqual(source.scene);
    expect(output.client_scripts).toEqual(source.client_scripts);
    expect(output.server_scripts).toEqual(source.server_scripts);
    output.assets['cover.png'] = 'changed';
    expect(reopened.toVersion().assets['cover.png']).toBe('image-hash');
  });

  it('clears retained assets and metadata when opening a new local template', () => {
    const project = new Project(Project.snapshotOfVersion(hosted()));
    project.load(templateSnapshot('blank'));
    expect(project.toVersion().assets).toEqual({});
    expect(project.toVersion().metadata.custom).toBeUndefined();
  });

  it('does not restore removed instructions from preserved metadata', () => {
    const project = new Project(Project.snapshotOfVersion(hosted()));
    project.metadata.instructions = { stale: true };
    expect(project.toVersion().metadata.instructions).toBeUndefined();
    expect(project.toVersion().metadata.custom).toEqual({ retained: true });
  });

  it('rejects malformed asset and metadata maps at the file boundary', () => {
    const snapshot = new Project().snapshot();
    for (const field of ['assets', 'metadata']) {
      expect(() => parseProjectFile(JSON.stringify({ format: 'pear-project', v: 1, ...snapshot, [field]: [] }))).toThrow();
    }
  });
});
