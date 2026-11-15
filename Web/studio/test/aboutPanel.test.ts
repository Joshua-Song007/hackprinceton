import { describe, expect, it } from 'vitest';
import { coverProblem } from '../src/aboutPanel';

describe('coverProblem', () => {
  it('accepts jpeg and png up to 2 MB', () => {
    expect(coverProblem({ type: 'image/png', size: 2 * 1024 * 1024 })).toBeNull();
    expect(coverProblem({ type: 'image/jpeg', size: 10 })).toBeNull();
  });
  it('rejects other types and oversize files', () => {
    expect(coverProblem({ type: 'image/gif', size: 10 })).toMatch(/JPEG or PNG/);
    expect(coverProblem({ type: 'image/png', size: 2 * 1024 * 1024 + 1 })).toMatch(/2 MB/);
  });
});
