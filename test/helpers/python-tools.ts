// The Python tools the Python gates' integration tests run (ticket 99): a virtual environment at
// <repo>/.python-tools (gitignored), made from the Python on PATH and filled with the pinned tool set
// on first use. The tools are never a dependency of this repo's package.json. Without a Python on
// PATH the tests that need it skip with NO_PYTHON_REASON.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
export const TOOLS_DIR = join(ROOT, '.python-tools');
export const TOOLS_PYTHON = join(TOOLS_DIR, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
/** The tool set the Python gates use, cosmic-ray at the version proven on Windows. */
export const TOOL_SET = ['pytest', 'coverage>=7.10', 'radon', 'cosmic-ray==8.9.0', 'bandit', 'pip-audit', 'import-linter', 'ruff', 'mypy'];
export const NO_PYTHON_REASON = 'skipped: no Python 3.10 or later on PATH (python3 or python); install it to run the Python gate tests';

/** The first Python on PATH that is 3.10 or later, or undefined. */
export function systemPython(): string | undefined {
  return ['python3', 'python'].find((p) => spawnSync(p, ['-c', 'import sys; sys.exit(sys.version_info < (3, 10))'], { encoding: 'utf8' }).status === 0);
}

/** The tools venv's python, made and filled when missing; undefined when there is no Python to make it with. */
export function pythonTools(): string | undefined {
  const python = systemPython();
  if (python === undefined) return undefined;
  if (!existsSync(TOOLS_PYTHON)) {
    const made = spawnSync(python, ['-m', 'venv', TOOLS_DIR], { encoding: 'utf8' });
    if (made.status !== 0) throw new Error(`python -m venv ${TOOLS_DIR} failed:\n${made.stderr}`);
  }
  const has = spawnSync(TOOLS_PYTHON, ['-c', 'import pytest, coverage, radon, cosmic_ray, bandit, pip_audit, importlinter, mypy'], { encoding: 'utf8' });
  if (has.status !== 0 || spawnSync(TOOLS_PYTHON, ['-m', 'ruff', '--version'], { encoding: 'utf8' }).status !== 0) {
    const installed = spawnSync(TOOLS_PYTHON, ['-m', 'pip', 'install', '-q', ...TOOL_SET], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (installed.status !== 0) throw new Error(`pip install ${TOOL_SET.join(' ')} failed:\n${installed.stdout}\n${installed.stderr}`);
  }
  return TOOLS_PYTHON;
}

/** This run's environment without vitest's own variables, so a child process is not read as a test run. */
export const cleanEnv = (): Record<string, string | undefined> =>
  Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('VITEST') && k !== 'NODE_ENV' && k !== 'TEST'));
