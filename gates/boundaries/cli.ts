// node gates/boundaries/cli.ts [--config <file>] [--cwd <dir>] [path…]
// Runs dependency-cruiser on the paths (default: src) with config/dependency-cruiser.cjs, or the
// project's own config when --config names one. Fails on any error-level violation: an import
// cycle, an import that resolves to nothing. Exit 0 pass, 1 fail, 2 could not run. The logic is
// in gate.ts.
//
// dependency-cruiser is this repo's devDependency, run from here so a project needs no install.

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { emit, failClosed } from '../lib/contract.ts';
import { boundariesGate } from './gate.ts';

const { values, positionals } = parseArgs({
  options: { config: { type: 'string' }, cwd: { type: 'string' } },
  allowPositionals: true,
});
const DEPCRUISE = resolve(import.meta.dirname, '../../node_modules/dependency-cruiser/bin/dependency-cruiser.mjs');
const config = values.config ?? resolve(import.meta.dirname, '../../config/dependency-cruiser.cjs');
const paths = positionals.length > 0 ? positionals : ['src'];

emit(
  failClosed('boundaries', () =>
    boundariesGate({
      cruise: () =>
        spawnSync(process.execPath, [DEPCRUISE, '--config', config, '--output-type', 'json', ...paths], {
          cwd: values.cwd ?? process.cwd(),
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
        }),
    }),
  ),
);
