// Prove the review-schema gate bites through its CLI: a valid review passes, a finding with no
// fields fails, and the valid review passes again.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { BITES, proveItBites } from '../../test/helpers/prove-it-bites.ts';

// Spawns processes: under a full-suite load on Windows they run several times slower (ticket 29).
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const CLI = join(import.meta.dirname, 'cli.ts');

describe('the review-schema gate bites', () => {
  it('passes a valid review, fails a malformed finding, passes again once it is gone', () => {
    const output = join(mkdtempSync(join(tmpdir(), 'review-schema-bites-')), 'review.json');
    const clean = () => writeFileSync(output, '{"findings": []}');
    clean();
    const run = () => spawnSync(process.execPath, [CLI, '--output', output, '--exit-code', '0'], { encoding: 'utf8' }).status ?? -1;
    expect(proveItBites({ run, inject: () => writeFileSync(output, '{"findings": [{}]}'), revert: clean })).toEqual(BITES);
  });
});
