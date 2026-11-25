// Prove the skipped-tests guard bites on pytest's JUnit XML report (ticket 99) with real git and
// pytest, over a copy of fixtures/python-sample. Without a Python on PATH it is skipped with that reason.

import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BITES, proveItBites } from '../../test/helpers/prove-it-bites.ts';
import { cleanEnv, NO_PYTHON_REASON, pythonTools, systemPython } from '../../test/helpers/python-tools.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const CLI = join(ROOT, 'gates', 'four-checks', 'skips-cli.ts');
const HAS_PYTHON = systemPython() !== undefined;
const SKIPPED = [
  '',
  '',
  'import pytest',
  '',
  '',
  '@pytest.mark.skip(reason="later")',
  'def test_saves_to_the_database():',
  '    assert True',
  '',
].join('\n');
let work = '';
let base = '';

describe.skipIf(!HAS_PYTHON)(`the skipped-tests guard bites on pytest (real git + pytest, JUnit XML)${HAS_PYTHON ? '' : ` (${NO_PYTHON_REASON})`}`, () => {
  let python = '';

  beforeAll(() => {
    python = pythonTools()!;
    work = mkdtempSync(join(tmpdir(), 'skips-python-'));
    cpSync(join(ROOT, 'fixtures', 'python-sample'), work, { recursive: true, filter: (src) => !/[\\/](__pycache__|\.pytest_cache)$/.test(src) });
    writeFileSync(join(work, '.gitignore'), '__pycache__/\n');
    const g = (...a: string[]) => execFileSync('git', a, { cwd: work, encoding: 'utf8' }).trim();
    g('init', '-q', '-b', 'main');
    g('config', 'user.email', 't@t');
    g('config', 'user.name', 't');
    g('add', '-A');
    g('commit', '-qm', 'base');
    base = g('rev-parse', 'HEAD');
  });

  afterAll(() => rmSync(work, { recursive: true, force: true }));

  it('passes the suite, fails it once a test skips itself, and passes again when it runs', () => {
    const tests = join(work, 'tests', 'test_parity.py');
    const kept = readFileSync(tests, 'utf8');
    const run = () =>
      spawnSync(process.execPath, [CLI, '--base', base, '--cwd', work, '--report', 'report.xml', '--test', `"${python}" -m pytest -q -p no:cacheprovider --junitxml=report.xml`], { encoding: 'utf8', env: cleanEnv() });
    const result = proveItBites({
      gate: 'skipped-tests',
      run: () => run().status ?? -1,
      inject: () => writeFileSync(tests, kept + SKIPPED),
      revert: () => writeFileSync(tests, kept),
    });
    expect(result).toEqual(BITES);
    writeFileSync(tests, kept + SKIPPED);
    try {
      expect(run().stdout).toContain('- tests.test_parity > test_saves_to_the_database');
    } finally {
      writeFileSync(tests, kept);
    }
  });
});
