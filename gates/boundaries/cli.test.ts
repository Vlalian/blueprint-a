import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { BITES, proveItBites } from '../../test/helpers/prove-it-bites.ts';

// Spawns processes: under a full-suite load on Windows they run several times slower (ticket 29).
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const CLI = join(import.meta.dirname, 'cli.ts');
const FIXTURE = resolve(import.meta.dirname, '../../fixtures/sample-project');

const run = (cwd: string, ...args: string[]) => spawnSync(process.execPath, [CLI, '--cwd', cwd, ...args], { encoding: 'utf8' });

function fixtureCopy() {
  const dir = mkdtempSync(join(tmpdir(), 'boundaries-'));
  cpSync(join(FIXTURE, 'src'), join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src/half.ts'), "export const half = (n: number) => n / 2;\n");
  return dir;
}

describe('boundaries CLI', () => {
  // Three full dependency-cruiser runs: about 30 s on this PC under a full-suite load, so it gets
  // its own budget instead of the 30 s default (it timed out twice at 30.7 s).
  it('bites: a temp copy of the fixture passes, an injected import cycle fails, reverting it passes', { timeout: 120_000 }, () => {
    const dir = fixtureCopy();
    const isEven = join(dir, 'src/is-even.ts');
    const clean = readFileSync(isEven, 'utf8');
    expect(
      proveItBites({
        run: () => run(dir, 'src').status ?? -1,
        inject: () => {
          writeFileSync(isEven, `import { half } from './half.ts';\nexport const _h = half;\n${clean}`);
          writeFileSync(join(dir, 'src/half.ts'), "import { isEven } from './is-even.ts';\nexport const half = (n: number) => (isEven(n) ? n / 2 : n);\n");
        },
        revert: () => {
          writeFileSync(isEven, clean);
          writeFileSync(join(dir, 'src/half.ts'), "export const half = (n: number) => n / 2;\n");
        },
      }),
    ).toEqual(BITES);
  });

  it('names the cycle and an import that resolves to nothing', () => {
    const dir = fixtureCopy();
    writeFileSync(join(dir, 'src/half.ts'), "import { gone } from './gone.ts';\nexport const half = gone;\n");
    const r = run(dir, 'src');
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).violations).toEqual([{ rule: 'not-to-unresolvable', from: 'src/half.ts', to: './gone.ts' }]);
  });

  it('passes the fixture project as the cleaner checks it (src and tests)', () => {
    expect(run(FIXTURE, 'src', 'tests').status).toBe(0);
  });

  it('cruises src when no path is given', () => {
    const r = run(fixtureCopy());
    expect(r.status).toBe(0);
  });

  it('exits 2 when dependency-cruiser cannot run (a path that does not exist, a config that does not)', () => {
    const dir = fixtureCopy();
    expect(run(dir, 'nothere').status).toBe(2);
    expect(run(dir, '--config', join(dir, 'none.cjs'), 'src').status).toBe(2);
  });
});
