// Prove both line scanners bite through their real CLIs, in both modes (--base and --staged).
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { BITES, proveItBites } from '../../test/helpers/prove-it-bites.ts';

// Spawns processes: under a full-suite load on Windows they run several times slower (ticket 29).
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const GATES = resolve(import.meta.dirname, '..');
const BAD = {
  'secret-scan': `const t = '${'ghp_' + 'k'.repeat(36)}';\n`,
  'hidden-unicode': `const admin = 'no\u202e';\n`,
};

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'scanners-'));
  const g = (...a: string[]) => execFileSync('git', a, { cwd: dir });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@t');
  g('config', 'user.name', 't');
  writeFileSync(join(dir, 'a.ts'), 'export const a = 1;\n');
  g('add', '-A');
  g('commit', '-qm', 'base');
  return { dir, g };
}

for (const gate of ['secret-scan', 'hidden-unicode'] as const) {
  describe(`${gate} CLI`, () => {
    const cli = join(GATES, gate, 'cli.ts');

    it('bites in --base mode, including an untracked new file', () => {
      const { dir } = repo();
      const file = join(dir, 'new.ts');
      const run = () => spawnSync(process.execPath, [cli, '--base', 'HEAD', '--cwd', dir]).status ?? -1;
      expect(proveItBites({ gate, run, inject: () => writeFileSync(file, BAD[gate]), revert: () => rmSync(file) })).toEqual(BITES);
    });

    it('bites in --staged mode', () => {
      const { dir, g } = repo();
      const file = join(dir, 'a.ts');
      const run = () => spawnSync(process.execPath, [cli, '--staged', '--cwd', dir]).status ?? -1;
      expect(
        proveItBites({
          gate,
          run,
          inject: () => {
            writeFileSync(file, BAD[gate]);
            g('add', '-A');
          },
          revert: () => {
            g('checkout', 'HEAD', '--', 'a.ts');
          },
        }),
      ).toEqual(BITES);
    });

    it('exits 2 without a mode', () => {
      const { dir } = repo();
      expect(spawnSync(process.execPath, [cli, '--cwd', dir]).status).toBe(2);
    });
  });
}
