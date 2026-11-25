// Prove the boundaries gate bites on a Python project with real import-linter (ticket 99), on a copy
// of fixtures/python-sample, whose pyproject.toml forbids sample.parity to import sample.grades.
// Without a Python on PATH it is skipped with that reason.

import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BITES, proveItBites } from '../../test/helpers/prove-it-bites.ts';
import { cleanEnv, NO_PYTHON_REASON, pythonTools, systemPython } from '../../test/helpers/python-tools.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const CLI = join(ROOT, 'gates', 'boundaries', 'cli.ts');
const HAS_PYTHON = systemPython() !== undefined;
let work = '';
let python = '';

const run = () => spawnSync(process.execPath, [CLI, '--python', '--cwd', work], { encoding: 'utf8', env: { ...cleanEnv(), WORKFLOW_PYTHON: python } });

describe.skipIf(!HAS_PYTHON)(`the boundaries gate bites on import-linter${HAS_PYTHON ? '' : ` (${NO_PYTHON_REASON})`}`, () => {
  beforeAll(() => {
    python = pythonTools()!;
    work = mkdtempSync(join(tmpdir(), 'boundaries-python-'));
    cpSync(join(ROOT, 'fixtures', 'python-sample'), work, { recursive: true, filter: (src) => !/[\\/](__pycache__|\.pytest_cache)$/.test(src) });
  });

  afterAll(() => rmSync(work, { recursive: true, force: true }));

  it('passes the kept contract, fails a forbidden import naming it, passes again once it is gone', () => {
    const parity = join(work, 'src', 'sample', 'parity.py');
    const clean = readFileSync(parity, 'utf8');
    const forbidden = `${clean}\n\nfrom sample.grades import grade  # noqa: E402\n`;
    const result = proveItBites({
      gate: 'boundaries',
      run: () => {
        const r = run();
        if (r.status !== 0 && r.status !== 1) throw new Error(`boundaries could not run:\n${r.stdout}\n${r.stderr}`);
        return r.status;
      },
      inject: () => writeFileSync(parity, forbidden),
      revert: () => writeFileSync(parity, clean),
    });
    expect(result).toEqual(BITES);
    writeFileSync(parity, forbidden);
    try {
      expect(JSON.parse(run().stdout).violations).toEqual([{ rule: 'Parity stays independent of grades', from: 'sample.parity', to: 'sample.grades', lines: '8' }]);
    } finally {
      writeFileSync(parity, clean);
    }
  });
});
