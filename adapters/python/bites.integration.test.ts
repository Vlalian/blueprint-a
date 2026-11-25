// Prove the CRAP and mutation gates bite through the Python adapter with real tools: pytest and
// coverage.py for coverage, radon for complexity and cosmic-ray for mutants, on a git copy of
// fixtures/python-sample. Slow (a few minutes); run with `npm run test:integration`. The tools
// come from <repo>/.python-tools (test/helpers/python-tools.ts), made on first use; without a Python
// on PATH the tests are skipped with that reason.

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BITES, proveItBites } from '../../test/helpers/prove-it-bites.ts';
import { cleanEnv, NO_PYTHON_REASON, pythonTools, systemPython } from '../../test/helpers/python-tools.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const CLI = join(ROOT, 'gates', 'test-strength', 'cli.ts');
const SAMPLE = join(ROOT, 'fixtures', 'python-sample');
const HAS_PYTHON = systemPython() !== undefined;
const SCRIPTS = process.platform === 'win32' ? 'Scripts' : 'bin';
const EXE = process.platform === 'win32' ? '.exe' : '';
let work = '';
let python = '';

function gate(name: 'crap' | 'mutation', args: string[], withPython = python, cwd = work) {
  return spawnSync(process.execPath, [CLI, name, '--runner', 'python', '--cwd', cwd, ...args], { encoding: 'utf8', env: { ...cleanEnv(), WORKFLOW_PYTHON: withPython } });
}

function exit(name: 'crap' | 'mutation', file: string): number {
  const r = gate(name, [file]);
  if (r.status !== 0 && r.status !== 1) throw new Error(`test-strength ${name} could not run:\n${r.stdout}\n${r.stderr}`);
  return r.status;
}

/** A venv with no tools in it; `fakes` are copies of its python under tool names, which run the script named by their first argument. */
function bareVenv(fakes: string[] = []): { dir: string; python: string } {
  const dir = mkdtempSync(join(tmpdir(), 'python-bare-'));
  expect(spawnSync(systemPython()!, ['-m', 'venv', '--without-pip', dir]).status).toBe(0);
  const bare = join(dir, SCRIPTS, `python${EXE}`);
  for (const tool of fakes) (process.platform === 'win32' ? copyFileSync : symlinkSync)(bare, join(dir, SCRIPTS, `${tool}${EXE}`));
  return { dir, python: bare };
}

describe.skipIf(!HAS_PYTHON)(`the test-strength gates bite through the Python adapter (pytest + coverage.py, radon, cosmic-ray)${HAS_PYTHON ? '' : ` (${NO_PYTHON_REASON})`}`, () => {
  beforeAll(() => {
    python = pythonTools()!;
    work = mkdtempSync(join(tmpdir(), 'python-bites-'));
    cpSync(SAMPLE, work, { recursive: true, filter: (src) => !/[\\/](\.venv|__pycache__|\.pytest_cache)$/.test(src) });
    writeFileSync(join(work, '.gitignore'), '__pycache__/\n');
    const g = (...a: string[]) => execFileSync('git', a, { cwd: work });
    g('init', '-q', '-b', 'main');
    g('config', 'user.email', 't@t');
    g('config', 'user.name', 't');
    g('add', '-A');
    g('commit', '-qm', 'base');
  });

  afterAll(() => rmSync(work, { recursive: true, force: true }));

  it('mutation: fails on a surviving mutant, naming its file, line and operator, and passes once the test that kills it is back', () => {
    const tests = join(work, 'tests', 'test_parity.py');
    const strong = readFileSync(tests, 'utf8');
    const weak = strong.replace(/\n\ndef test_two_and_four_are_even\(\):\n(?: {4}.*\n)+/, '\n');
    expect(weak).not.toBe(strong);
    const result = proveItBites({
      gate: 'test-strength',
      run: () => exit('mutation', 'src/sample/parity.py'),
      // Without the even cases, `not n % 2` -> `not n * 2` survives: 3 is odd either way.
      inject: () => writeFileSync(tests, weak),
      revert: () => writeFileSync(tests, strong),
    });
    expect(result).toEqual(BITES);
    writeFileSync(tests, weak);
    try {
      const out = JSON.parse(gate('mutation', ['src/sample/parity.py']).stdout);
      expect(out.standing).toContainEqual({ file: 'src/sample/parity.py', line: 5, mutator: 'core/ReplaceBinaryOperator_Mod_Mul', status: 'Survived' });
    } finally {
      writeFileSync(tests, strong);
    }
  });

  it('mutation with --base: a survivor on a line the change did not touch does not fail it; without the base it does', () => {
    const parity = join(work, 'src', 'sample', 'parity.py');
    const tests = join(work, 'tests', 'test_parity.py');
    const [source, kept] = [readFileSync(parity, 'utf8'), readFileSync(tests, 'utf8')];
    writeFileSync(parity, `${source}\n\ndef is_odd(n: int) -> bool:\n    return not is_even(n)\n`);
    writeFileSync(tests, kept.replace('from sample.parity import is_even', 'from sample.parity import is_even, is_odd') + '\n\ndef test_three_is_odd_too():\n    assert is_odd(3)\n');
    try {
      // grades.py keeps survivors (its 75 and 50 boundaries are untested), on lines this change never touched.
      const scoped = gate('mutation', ['--base', 'HEAD', 'src']);
      expect([scoped.status, JSON.parse(scoped.stdout).standing]).toEqual([0, []]);
      expect(JSON.parse(scoped.stdout).mutants).toBeGreaterThan(0);
      const whole = gate('mutation', ['src/sample/grades.py']);
      expect(whole.status).toBe(1);
      expect(JSON.parse(whole.stdout).standing.every((m: { file: string }) => m.file === 'src/sample/grades.py')).toBe(true);
    } finally {
      writeFileSync(parity, source);
      writeFileSync(tests, kept);
    }
  });

  it('crap: fails an untested branchy function, naming it, and passes once its tests are back', () => {
    const tests = join(work, 'tests', 'test_grades.py');
    const kept = readFileSync(tests, 'utf8');
    const result = proveItBites({
      gate: 'test-strength',
      run: () => exit('crap', 'src/sample/grades.py'),
      // Untested, complexity 4 scores 4^2 + 4 = 20, over the ceiling of 6.
      inject: () => rmSync(tests),
      revert: () => writeFileSync(tests, kept),
    });
    expect(result).toEqual(BITES);
    rmSync(tests);
    try {
      const out = JSON.parse(gate('crap', ['src/sample/grades.py']).stdout);
      expect(out.over).toContainEqual(expect.objectContaining({ file: 'src/sample/grades.py', name: 'grade', complexity: 4, crap: 20 }));
    } finally {
      writeFileSync(tests, kept);
    }
  });

  it('crap: joins two functions of the same name to their own coverage by line, so only the one this platform never runs is untested', () => {
    const lines = readFileSync(join(work, 'src', 'sample', 'paths.py'), 'utf8').split(/\r?\n/);
    const defs = lines.flatMap((l, i) => (l.includes('def native(') ? [i + 1] : []));
    const [windows, other] = defs as [number, number];
    // At ceiling 5 the untested twin (complexity 2: 2^2 + 2 = 6) is over; the tested one (2) is not.
    const out = JSON.parse(gate('crap', ['--ceiling', '5', 'src/sample/paths.py']).stdout);
    expect(out).toMatchObject({ pass: false, functions: 2 });
    expect(out.over).toEqual([expect.objectContaining({ name: 'native', startLine: process.platform === 'win32' ? other : windows, coverage: 0, crap: 6 })]);
  });

  it('mutation: exits 2 when the baseline fails, never a pass', () => {
    const broken = join(work, 'tests', 'test_broken.py');
    writeFileSync(broken, 'def test_broken():\n    assert False\n');
    try {
      const r = gate('mutation', ['src/sample/parity.py']);
      expect(r.status).toBe(2);
      expect(JSON.parse(r.stdout).error).toMatch(/^cosmic-ray baseline failed \(exit 1\)/);
    } finally {
      rmSync(broken);
    }
  });

  it('mutation: exits 2 when cosmic-ray reports one killed and one incompetent mutant, never a pass', () => {
    const fake = bareVenv(['cosmic-ray', 'pytest']);
    const project = mkdtempSync(join(tmpdir(), 'python-incompetent-'));
    try {
      mkdirSync(join(project, 'src'));
      writeFileSync(join(project, 'src', 'm.py'), 'def f(n):\n    return n + 1\n');
      // The fake cosmic-ray runs the script its first argument names: every step succeeds, and the dump is mixed.
      const item = (outcome: string, col: number) => JSON.stringify([{ mutations: [{ module_path: 'src/m.py', operator_name: 'core/X', start_pos: [2, col] }] }, { worker_outcome: 'normal', test_outcome: outcome, output: outcome }]);
      for (const step of ['baseline', 'init', 'exec']) writeFileSync(join(project, step), 'pass\n');
      writeFileSync(join(project, 'dump'), `print(${JSON.stringify(item('killed', 11))})\nprint(${JSON.stringify(item('incompetent', 13))})\n`);
      const r = gate('mutation', ['src/m.py'], fake.python, project);
      expect(r.status).toBe(2);
      expect(JSON.parse(r.stdout).error).toBe('cosmic-ray could not test 1 of 2 mutants (incompetent: the test command did not run), first src/m.py:2 core/X: incompetent');
    } finally {
      rmSync(project, { recursive: true, force: true });
      rmSync(fake.dir, { recursive: true, force: true });
    }
  });

  it('exits 2 and names pytest and its install command, before coverage or mutation runs anything, when the project Python lacks it', () => {
    const bare = bareVenv();
    try {
      for (const name of ['crap', 'mutation'] as const) {
        const r = gate(name, ['src/sample/grades.py'], bare.python);
        expect(r.status).toBe(2);
        expect(JSON.parse(r.stdout).error).toMatch(/^pytest is not installed for .* \(Python 3\.\d+\.\d+\): run `".*" -m pip install "pytest"`/);
      }
    } finally {
      rmSync(bare.dir, { recursive: true, force: true });
    }
  });
});
