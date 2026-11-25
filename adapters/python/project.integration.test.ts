// Prove every check projects/sample-python/project.json configures runs as the dispatcher runs it:
// through the shell, from a fresh git copy of fixtures/python-sample whose path holds a space, with
// no .venv in it and the Python named only by WORKFLOW_PYTHON (an external venv), on a change that
// adds a module and its tests (ticket 99, fix round 1). Slow (a few minutes); without a Python on
// PATH it is skipped with that reason.

import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanEnv, NO_PYTHON_REASON, pythonTools, systemPython } from '../../test/helpers/python-tools.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const HAS_PYTHON = systemPython() !== undefined;
type Config = { roles: Record<string, { checks: Record<string, string> }> };
const CONFIG = JSON.parse(readFileSync(join(ROOT, 'projects', 'sample-python', 'project.json'), 'utf8')) as Config;
let work = '';
let base = '';
let plan = '';
let python = '';

describe.skipIf(!HAS_PYTHON)(`projects/sample-python's checks run from a path with a space, on an external venv${HAS_PYTHON ? '' : ` (${NO_PYTHON_REASON})`}`, () => {
  beforeAll(() => {
    python = pythonTools()!;
    work = mkdtempSync(join(tmpdir(), 'sample python '));
    cpSync(join(ROOT, 'fixtures', 'python-sample'), work, { recursive: true, filter: (src) => !/[\\/](\.venv|__pycache__|\.pytest_cache)$/.test(src) });
    writeFileSync(join(work, '.gitignore'), '__pycache__/\n');
    const g = (...a: string[]) => execFileSync('git', a, { cwd: work, encoding: 'utf8' }).trim();
    g('init', '-q', '-b', 'main');
    g('config', 'user.email', 't@t');
    g('config', 'user.name', 't');
    g('add', '-A');
    g('commit', '-qm', 'base');
    base = g('rev-parse', 'HEAD');
    writeFileSync(join(work, 'src', 'sample', 'double.py'), '"""Twice a number."""\n\n\ndef double(n: int) -> int:\n    return n * 2\n');
    writeFileSync(join(work, 'tests', 'test_double.py'), 'from sample.double import double\n\n\ndef test_three_doubles_to_six():\n    assert double(3) == 6\n');
    plan = join(work, '..', `plan ${process.pid}.md`);
    writeFileSync(plan, '# Plan\n');
  });

  afterAll(() => {
    rmSync(work, { recursive: true, force: true });
    rmSync(plan, { force: true });
  });

  it('passes every configured check on a clean change, each through the same resolved Python', () => {
    const commands = [...new Set(Object.values(CONFIG.roles).flatMap((r) => Object.values(r.checks)))];
    expect(commands.length).toBeGreaterThan(10);
    const results = commands.map((command) => {
      const line = command.replaceAll('{WORKFLOW}', ROOT.split('\\').join('/')).replaceAll('{BASE}', base).replaceAll('{PLAN}', plan.split('\\').join('/'));
      const r = spawnSync(line, { cwd: work, shell: true, encoding: 'utf8', env: { ...cleanEnv(), WORKFLOW_PYTHON: python }, maxBuffer: 64 * 1024 * 1024 });
      return { command, status: r.status, tail: `${r.stdout}${r.stderr}`.slice(-400) };
    });
    expect(results.filter((r) => r.status !== 0)).toEqual([]);
  });

  it('names no interpreter of its own: every Python runs through adapters/python/run.ts or a gate', () => {
    const commands = Object.values(CONFIG.roles).flatMap((r) => Object.values(r.checks));
    expect(commands.filter((c) => /\.venv|\{CWD\}|\bpython3?(?:\.exe)?"? -m\b/.test(c))).toEqual([]);
  });
});
