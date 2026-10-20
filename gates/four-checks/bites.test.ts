import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { BITES, proveItBites } from '../../test/helpers/prove-it-bites.ts';

// Spawns processes: under a full-suite load on Windows they run several times slower (ticket 29).
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

it('four-checks bites: clean passes, an injected failure fails, the revert passes again', () => {
  const dir = mkdtempSync(join(tmpdir(), 'four-checks-bites-'));
  const config = join(dir, 'project.json');
  const marker = join(dir, 'BROKEN');
  writeFileSync(config, JSON.stringify({ checks: { test: `node -e "process.exitCode = (require('fs').existsSync('BROKEN') ? 1 : 0)"` } }));

  const result = proveItBites({
    run: () => spawnSync(process.execPath, [join(import.meta.dirname, 'cli.ts'), '--config', config, '--cwd', dir]).status ?? -1,
    inject: () => writeFileSync(marker, ''),
    revert: () => rmSync(marker),
  });

  expect(result).toEqual(BITES);
});
