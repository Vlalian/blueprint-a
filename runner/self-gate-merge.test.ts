// The fast merge gate end to end (ticket 31), on a real merge in a temp repo
// (test/helpers/merge-gate-repo.ts): the CI report trusted at the exact tip, and every changed line
// mutated, with the reason, when it names an older commit or is missing (ticket 83 Pass when).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BASE_SOURCE, gate, git, lineSet, setUp, SPAWNS, startMerge, tearDown, where } from '../test/helpers/merge-gate-repo.ts';

// Each test spawns git a dozen times and onkel once; under load on Windows that is slow.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

beforeAll(() => setUp(), SPAWNS);
afterAll(tearDown, SPAWNS);

describe('the fast merge gate on a real merge (ticket 31)', () => {
  it('Pass when (ticket 83): a CI report that names the tip and has no survivor leaves only the merge\'s own lines to mutate: none here', () => {
    startMerge('integration-clean', 'ticket/7');
    const r = gate(['--base', 'HEAD', '--merge', 'origin/ticket/7']);
    expect(r.out).toContain('mutation: only the lines that differ from');
    expect(r.mutated).toEqual([]);
    expect(r.exit).toBe(0);
  }, SPAWNS);

  it('Pass when (ticket 83): with a trusted CI report, mutates a conflict-resolved line, and only that line', () => {
    startMerge('integration-conflict', 'ticket/7');
    writeFileSync(join(where().work, 'scripts', 'lib.ts'), lineSet(lineSet(BASE_SOURCE, 1, 'export const LIMIT = 6;'), 3, '  return x + x;'));
    git(where().work, 'add', 'scripts/lib.ts');
    const r = gate(['--base', 'HEAD', '--merge', 'origin/ticket/7']);
    expect(r.mutated).toEqual([['scripts/lib.ts:1-1']]);
    expect(r.exit).toBe(0);
  }, SPAWNS);

  it('falls back to full changed-line mutation, saying why, when the branch has no report', () => {
    startMerge('integration-clean', 'ticket/8');
    const r = gate(['--base', 'HEAD', '--merge', 'origin/ticket/8']);
    expect(r.out).toContain('mutation: every changed line (no trusted CI report: no cloud-runs/ticket-8.gate.json on the branch)');
    expect(r.mutated).toEqual([['scripts/lib.ts:2-4']]);
  }, SPAWNS);

  it('Pass when (ticket 83): a CI report naming an older commit mutates every changed line, and says why', () => {
    startMerge('integration-clean', 'ticket/9');
    const r = gate(['--base', 'HEAD', '--merge', 'origin/ticket/9']);
    expect(r.out).toMatch(/no trusted CI report: stale: it gated \w{8}, and the tip \w{8} changed scripts\/lib.ts since/);
    // double and triple, both changed on the branch; adjacent spans are handed to Stryker as one.
    expect(r.mutated).toEqual([['scripts/lib.ts:2-7']]);
  }, SPAWNS);

  it('logs each stage with its ms, and lists the slowest test files', () => {
    startMerge('integration-clean', 'ticket/7');
    const r = gate(['--base', 'HEAD', '--merge', 'origin/ticket/7']);
    expect(r.out).toContain('  pass  unit tests (with coverage)  1.0 s');
    expect(r.out).toContain('Slowest test files:\n  0.0 s  scripts/lib.test.ts');
    const log = readFileSync(join(where().dir, 'state', 'logs', 'observations.jsonl'), 'utf8');
    expect(log).toContain('"gate":"self-gate-onkel"');
  }, SPAWNS);
});

