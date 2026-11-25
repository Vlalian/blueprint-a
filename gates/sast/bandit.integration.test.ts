// Prove the sast gate bites on Python with real bandit and git (ticket 99), on a copy of
// fixtures/python-sample. A Python-only change never needs Semgrep. Without a Python on PATH it is
// skipped with that reason.

import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BITES, proveItBites } from '../../test/helpers/prove-it-bites.ts';
import { cleanEnv, NO_PYTHON_REASON, pythonTools, systemPython } from '../../test/helpers/python-tools.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const CLI = join(ROOT, 'gates', 'sast', 'cli.ts');
const HAS_PYTHON = systemPython() !== undefined;
const SAFE = 'import subprocess\n\n\ndef run(args: list[str]) -> int:\n    return subprocess.call(args)  # nosec B603 -- the arguments are a list, no shell runs\n';
const UNSAFE = 'import subprocess\n\n\ndef run(cmd: str) -> int:\n    return subprocess.call(cmd, shell=True)\n';
let work = '';
let base = '';
let python = '';

const run = () => spawnSync(process.execPath, [CLI, '--base', base, '--cwd', work], { cwd: work, encoding: 'utf8', env: { ...cleanEnv(), WORKFLOW_PYTHON: python } });

describe.skipIf(!HAS_PYTHON)(`the sast gate bites on Python with bandit${HAS_PYTHON ? '' : ` (${NO_PYTHON_REASON})`}`, () => {
  beforeAll(() => {
    python = pythonTools()!;
    work = mkdtempSync(join(tmpdir(), 'sast-python-'));
    cpSync(join(ROOT, 'fixtures', 'python-sample'), work, { recursive: true, filter: (src) => !/[\\/](__pycache__|\.pytest_cache)$/.test(src) });
    const g = (...a: string[]) => execFileSync('git', a, { cwd: work, encoding: 'utf8' }).trim();
    g('init', '-q', '-b', 'main');
    g('config', 'user.email', 't@t');
    g('config', 'user.name', 't');
    g('add', '-A');
    g('commit', '-qm', 'base');
    base = g('rev-parse', 'HEAD');
  });

  afterAll(() => rmSync(work, { recursive: true, force: true }));

  it('passes a safe new module, fails shell=True naming bandit B602, passes again once it is safe', () => {
    const runner = join(work, 'src', 'sample', 'runner.py');
    const exit = () => {
      const r = run();
      if (r.status !== 0 && r.status !== 1) throw new Error(`sast could not run:\n${r.stdout}\n${r.stderr}`);
      return r.status;
    };
    writeFileSync(runner, SAFE);
    const result = proveItBites({
      gate: 'sast',
      run: exit,
      inject: () => writeFileSync(runner, UNSAFE),
      revert: () => writeFileSync(runner, SAFE),
    });
    expect(result).toEqual(BITES);
    writeFileSync(runner, UNSAFE);
    try {
      expect(JSON.parse(run().stdout).findings).toEqual([expect.objectContaining({ rule: 'bandit.B602', severity: 'ERROR', file: 'src/sample/runner.py', line: 5 })]);
    } finally {
      writeFileSync(runner, SAFE);
    }
  });
});
