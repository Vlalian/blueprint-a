// Prove the red check bites on a Python project with real git and pytest, reading pytest's JUnit
// XML report (--junit, ticket 99), over a copy of fixtures/python-sample. Without a Python on PATH
// it is skipped with that reason.

import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BITES, proveItBites } from '../../test/helpers/prove-it-bites.ts';
import { cleanEnv, NO_PYTHON_REASON, pythonTools, systemPython } from '../../test/helpers/python-tools.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const CLI = join(ROOT, 'gates', 'red-check', 'cli.ts');
const HAS_PYTHON = systemPython() !== undefined;
const PROVING = 'from sample.parity import is_even\n\n\ndef test_four_is_even():\n    assert is_even(4)\n';
let work = '';
let newTest = '';

const run = (python: string) =>
  spawnSync(process.execPath, [CLI, '--base', 'HEAD', '--cwd', work, '--test-command', `"${python}" -m pytest -q -p no:cacheprovider`, '--junit'], { encoding: 'utf8', env: cleanEnv() });

describe.skipIf(!HAS_PYTHON)(`red-check bites on pytest (real git + pytest, JUnit XML)${HAS_PYTHON ? '' : ` (${NO_PYTHON_REASON})`}`, () => {
  let python = '';

  beforeAll(() => {
    python = pythonTools()!;
    work = mkdtempSync(join(tmpdir(), 'red-check-python-'));
    cpSync(join(ROOT, 'fixtures', 'python-sample'), work, { recursive: true, filter: (src) => !/[\\/](__pycache__|\.pytest_cache)$/.test(src) });
    writeFileSync(join(work, '.gitignore'), '__pycache__/\n');
    // Base: is_even is wrong (never true for a positive number), so a test of 4 fails there.
    writeFileSync(join(work, 'src', 'sample', 'parity.py'), 'def is_even(n: int) -> bool:\n    return n < 0\n');
    const g = (...a: string[]) => execFileSync('git', a, { cwd: work });
    g('init', '-q', '-b', 'main');
    g('config', 'user.email', 't@t');
    g('config', 'user.name', 't');
    g('add', '-A');
    g('commit', '-qm', 'base');
    writeFileSync(join(work, 'src', 'sample', 'parity.py'), 'def is_even(n: int) -> bool:\n    return not n % 2\n');
    newTest = join(work, 'tests', 'test_new_parity.py');
    writeFileSync(newTest, PROVING);
  });

  afterAll(() => rmSync(work, { recursive: true, force: true }));

  it('passes a test that fails on the base, fails one that already passes there, passes again when restored', () => {
    const result = proveItBites({
      gate: 'red-check',
      run: () => run(python).status ?? -1,
      // is_even(3) is false on the broken base too, so this test proves nothing.
      inject: () => writeFileSync(newTest, PROVING.replace('assert is_even(4)', 'assert not is_even(3)')),
      revert: () => writeFileSync(newTest, PROVING),
    });
    expect(result).toEqual(BITES);
  });

  it("counts a test of the project's own module not written at the base as red: test-first (ticket 99 fix round 1)", () => {
    writeFileSync(join(work, 'src', 'sample', 'sign.py'), 'def sign(n: int) -> int:\n    return (n > 0) - (n < 0)\n');
    writeFileSync(newTest, 'from sample.sign import sign\n\n\ndef test_sign_of_five():\n    assert sign(5) == 1\n');
    try {
      const r = run(python);
      expect([r.status, JSON.parse(r.stdout).findings]).toEqual([0, []]);
    } finally {
      rmSync(join(work, 'src', 'sample', 'sign.py'));
      writeFileSync(newTest, PROVING);
    }
  });

  it('does not count a test that cannot even be collected on the base for another reason as red', () => {
    writeFileSync(newTest, 'import not_installed_anywhere\n\n\ndef test_four_is_even():\n    assert not_installed_anywhere\n');
    try {
      const r = run(python);
      expect(r.status).toBe(1);
      expect(JSON.parse(r.stdout).findings).toEqual([{ file: 'tests/test_new_parity.py', detail: 'no failed test was reported against the base code' }]);
    } finally {
      writeFileSync(newTest, PROVING);
    }
  });
});
