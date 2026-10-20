import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { configValues } from './git.ts';

// Spawns git: under a full-suite load on Windows it runs several times slower (ticket 29).
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

describe('configValues', () => {
  it('gives every value a key has, in order, and none for an unset key or outside a repo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'git-config-'));
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['config', '--add', 'remote.origin.push', 'a:refs/heads/main'], { cwd: dir });
    execFileSync('git', ['config', '--add', 'remote.origin.push', 'b:b'], { cwd: dir });
    expect(configValues(dir, 'remote.origin.push')).toEqual(['a:refs/heads/main', 'b:b']);
    expect(configValues(dir, 'REMOTE.origin.PUSH')).toEqual(['a:refs/heads/main', 'b:b']);
    expect(configValues(dir, 'push.nothing-here')).toEqual([]);
    expect(configValues(join(dir, 'missing'), 'push.default')).toEqual([]);
  });

  it('keeps a bare key (git reads a bare mirror under [remote "origin"] as mirror=true) and an empty value', () => {
    const dir = mkdtempSync(join(tmpdir(), 'git-config-'));
    execFileSync('git', ['init', '-q'], { cwd: dir });
    appendFileSync(join(dir, '.git', 'config'), '[remote "origin"]\n\turl = x\n\tmirror\n\tpush = a:a\n\tpush =\n\tpush = "b\\nc"\n');
    expect(configValues(dir, 'remote.origin.mirror')).toEqual(['']);
    expect(configValues(dir, 'remote.origin.push')).toEqual(['a:a', '', 'b\nc']);
  });
});
