import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { BITES, proveItBites } from '../../test/helpers/prove-it-bites.ts';

// Spawns processes: under a full-suite load on Windows they run several times slower (ticket 29).
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const CLI = join(import.meta.dirname, 'cli.ts');
const run = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

describe('git-guard CLI', () => {
  it('bites: an allowed line passes, a force push fails, the allowed line passes again', () => {
    let line = 'git push origin feature/x';
    const result = proveItBites({
      run: () => run('--branch', 'feature/x', line).status ?? 2,
      inject: () => {
        line = 'git push -f origin feature/x';
      },
      revert: () => {
        line = 'git push origin feature/x';
      },
    });
    expect(result).toEqual(BITES);
  });

  it('prints the blocked command and the reason as JSON', () => {
    const r = run('--branch', 'feature/x', 'git commit --no-verify -m x');
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout)).toMatchObject({ gate: 'git-guard', pass: false, blocked: [{ command: 'git commit --no-verify -m x' }] });
  });

  it('exits 2 when it cannot run', () => {
    const r = run('git status');
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout)).toMatchObject({ gate: 'git-guard', pass: false, error: expect.stringMatching(/^usage: git-guard/) });
  });
});
