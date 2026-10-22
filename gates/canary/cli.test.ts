// The canary through its real CLI: a nested vitest over a throwaway repo whose one gate is proved by
// a real prove-it-bites test. Making the gate toothless (its injected fault no longer fails) turns
// the canary red, and the canary record in the observation log carries why.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { toyCanaryRoot } from '../../test/helpers/toy-canary.ts';
import { childEnv } from './core.ts';

// Spawns processes: under a full-suite load on Windows they run several times slower (ticket 29).
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = resolve(import.meta.dirname, '../..');
const CLI = join(ROOT, 'gates', 'canary', 'cli.ts');
const { root: WORK, toothless: TOOTHLESS } = toyCanaryRoot();
const STATE = join(WORK, 'state');

afterAll(() => rmSync(WORK, { recursive: true, force: true }));

const canary = () => spawnSync(process.execPath, [CLI, '--root', WORK, '--state', STATE], { encoding: 'utf8', env: childEnv(process.env, '') });
const logged = () => readFileSync(join(STATE, 'logs', 'observations.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);

describe('gates/canary CLI', () => {
  it('passes, exit 0, while the gate bites, and logs it green', () => {
    const r = canary();
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ gate: 'canary', pass: true, gates: [{ gate: 'toy', state: 'green', detail: 'clean 0, injected 1, reverted 0' }] });
    expect(logged().at(-1)).toMatchObject({ kind: 'canary', gate: 'toy', state: 'green' });
  });

  it('Pass when: fails, exit 1, once the injected fault no longer fails, and logs it red', () => {
    writeFileSync(TOOTHLESS, '');
    const r = canary();
    rmSync(TOOTHLESS);
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).gates).toEqual([
      { gate: 'toy', file: 'gates/toy/bites.test.ts', state: 'red', detail: 'the injected fault no longer fails: clean 0, injected 0, reverted 0' },
    ]);
    expect(logged().at(-1)).toMatchObject({ kind: 'canary', gate: 'toy', state: 'red', detail: 'the injected fault no longer fails: clean 0, injected 0, reverted 0' });
  });

  it('could not run, exit 2, where there is no prove-it-bites test', () => {
    const empty = mkdtempSync(join(tmpdir(), 'canary-empty-'));
    const r = spawnSync(process.execPath, [CLI, '--root', empty], { encoding: 'utf8' });
    rmSync(empty, { recursive: true, force: true });
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout)).toMatchObject({ error: 'no prove-it-bites test found' });
  });

  it("searches only the folders the root's config/canary.json names", () => {
    mkdirSync(join(WORK, 'config'), { recursive: true });
    writeFileSync(join(WORK, 'config', 'canary.json'), '{ "dirs": ["tools"] }\n');
    const r = canary();
    rmSync(join(WORK, 'config'), { recursive: true, force: true });
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout)).toMatchObject({ error: 'no prove-it-bites test found' });
  });

  it('exits 2 on an unknown option rather than ignoring it', () => {
    const r = spawnSync(process.execPath, [CLI, '--rot', WORK], { encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout)).toMatchObject({ gate: 'canary', error: expect.stringMatching(/Unknown option '--rot'/) });
  });
});
