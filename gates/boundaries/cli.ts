// node gates/boundaries/cli.ts [--config <file>] [--cwd <dir>] [path…]
// node gates/boundaries/cli.ts --python [--cwd <dir>]
// Runs dependency-cruiser on the paths (default: src) with config/dependency-cruiser.cjs, or the
// project's own config when --config names one. Fails on any error-level violation: an import
// cycle, an import that resolves to nothing. With --python (ticket 99) it runs import-linter
// (`lint-imports`, from the project's Python) on the contracts in the project's pyproject.toml or
// .importlinter instead, with the project's src folder on PYTHONPATH when it has one, and fails on a
// broken contract. Exit 0 pass, 1 fail, 2 could not run. The logic is in gate.ts and python.ts.
//
// dependency-cruiser is this repo's devDependency, run from here so a project needs no install;
// import-linter is the Python project's own dev dependency.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { realToolchain } from '../../adapters/python/io.ts';
import { emit, failClosed } from '../lib/contract.ts';
import { boundariesGate } from './gate.ts';
import { importLinterGate } from './python.ts';

const { values, positionals } = parseArgs({
  options: { config: { type: 'string' }, cwd: { type: 'string' }, python: { type: 'boolean', default: false } },
  allowPositionals: true,
});
const DEPCRUISE = resolve(import.meta.dirname, '../../node_modules/dependency-cruiser/bin/dependency-cruiser.mjs');
const config = values.config ?? resolve(import.meta.dirname, '../../config/dependency-cruiser.cjs');
const paths = positionals.length > 0 ? positionals : ['src'];
const cwd = values.cwd ?? process.cwd();

/** The project's src folder ahead of any PYTHONPATH already set, so a src layout imports without an install. */
function pythonPath(): Record<string, string> {
  const src = resolve(cwd, 'src');
  if (!existsSync(src)) return {};
  return { PYTHONPATH: [src, process.env.PYTHONPATH].filter(Boolean).join(delimiter) };
}

emit(
  failClosed('boundaries', () =>
    values.python
      ? importLinterGate({ lintImports: () => realToolchain(cwd).run('lint-imports', ['--no-logo', '--no-cache'], pythonPath()) })
      : boundariesGate({
          cruise: () =>
            spawnSync(process.execPath, [DEPCRUISE, '--config', config, '--output-type', 'json', ...paths], {
              cwd,
              encoding: 'utf8',
              maxBuffer: 64 * 1024 * 1024,
            }),
        }),
  ),
);
