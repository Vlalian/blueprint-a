// node gates/supply-chain/cli.ts --base <ref> | --base-file <lockfile> [--lockfile package-lock.json] [--allowlist <path>]
// New or changed packages in the lockfile: each needs a licence on the licence gate's allowlist or
// a written exception, and may run an install script only when allowlisted (config/supply-chain.json
// in this repo unless --allowlist says otherwise). Exit 0 pass, 1 fail, 2 could not run. The
// logic is in gate.ts; this file only wires in git and the file system.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { emit, failClosed } from '../lib/contract.ts';
import { supplyChainGate } from './gate.ts';

const ALLOWLIST = join(resolve(import.meta.dirname, '../..'), 'config', 'supply-chain.json');

emit(
  failClosed('supply-chain', () => {
    const { values } = parseArgs({ options: { base: { type: 'string' }, 'base-file': { type: 'string' }, lockfile: { type: 'string' }, allowlist: { type: 'string', default: ALLOWLIST } } });
    return supplyChainGate(values, {
      readFile: (path) => (existsSync(path) ? readFileSync(path, 'utf8') : undefined),
      git: (args) => spawnSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }),
    });
  }),
);
