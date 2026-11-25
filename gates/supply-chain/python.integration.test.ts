// Prove the supply-chain gate bites on a Python lockfile with real pip-audit (ticket 99). pip-audit
// asks PyPI's advisory database, so this needs the network; without a Python on PATH it is skipped
// with that reason. six 1.17.0 has no known vulnerability when this was written; requests 2.19.0 has
// several (PYSEC-2018-28 among them).

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BITES, proveItBites } from '../../test/helpers/prove-it-bites.ts';
import { cleanEnv, NO_PYTHON_REASON, pythonTools, systemPython } from '../../test/helpers/python-tools.ts';

const CLI = join(resolve(import.meta.dirname), 'cli.ts');
const HAS_PYTHON = systemPython() !== undefined;
const lock = (...packages: Array<[string, string]>) =>
  ['version = 1', '', '[[package]]', 'name = "app"', 'version = "0.1.0"', 'source = { editable = "." }', ...packages.flatMap(([name, version]) => ['', '[[package]]', `name = "${name}"`, `version = "${version}"`, 'source = { registry = "https://pypi.org/simple" }']), ''].join('\n');
const CLEAN = lock(['six', '1.17.0']);
let work = '';
let python = '';

const run = () => spawnSync(process.execPath, [CLI, '--lockfile', 'uv.lock'], { cwd: work, encoding: 'utf8', env: { ...cleanEnv(), WORKFLOW_PYTHON: python } });

describe.skipIf(!HAS_PYTHON)(`the supply-chain gate bites on uv.lock with pip-audit${HAS_PYTHON ? '' : ` (${NO_PYTHON_REASON})`}`, () => {
  beforeAll(() => {
    python = pythonTools()!;
    work = mkdtempSync(join(tmpdir(), 'supply-chain-python-'));
    writeFileSync(join(work, 'uv.lock'), CLEAN);
  });

  afterAll(() => rmSync(work, { recursive: true, force: true }));

  it('passes a clean lockfile, fails one that adds a package with a known vulnerability, passes again once it is gone', () => {
    const exit = () => {
      const r = run();
      if (r.status !== 0 && r.status !== 1) throw new Error(`supply-chain could not run:\n${r.stdout}\n${r.stderr}`);
      return r.status;
    };
    const result = proveItBites({
      gate: 'supply-chain',
      run: exit,
      inject: () => writeFileSync(join(work, 'uv.lock'), lock(['six', '1.17.0'], ['requests', '2.19.0'])),
      revert: () => writeFileSync(join(work, 'uv.lock'), CLEAN),
    });
    expect(result).toEqual(BITES);
    writeFileSync(join(work, 'uv.lock'), lock(['requests', '2.19.0']));
    try {
      expect(JSON.parse(run().stdout).findings).toEqual([expect.stringMatching(/^requests@2\.19\.0: known vulnerabilities .*PYSEC-2018-28/)]);
    } finally {
      writeFileSync(join(work, 'uv.lock'), CLEAN);
    }
  });
});
