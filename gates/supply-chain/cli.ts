// @process-shell
// node gates/supply-chain/cli.ts --base <ref> | --base-file <lockfile> [--lockfile package-lock.json] [--allowlist <path>]
// New or changed packages in the lockfile: each needs a licence on the licence gate's allowlist or
// a written exception, and may run an install script only when allowlisted (config/supply-chain.json
// in this repo unless --allowlist says otherwise). A Python lockfile (--lockfile uv.lock,
// poetry.lock, requirements*.txt or pyproject.toml, ticket 99) is audited for known vulnerabilities
// with pip-audit from the project's Python instead (python.ts); there the base is optional. Exit 0
// pass, 1 fail, 2 could not run. The logic is in gate.ts and python.ts; this file only wires in git,
// pip-audit and the file system.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { realToolchain } from '../../adapters/python/io.ts';
import { emit, failClosed } from '../lib/contract.ts';
import type { SupplyChainIo } from './gate.ts';
import { supplyChainFor } from './python.ts';

const ALLOWLIST = join(resolve(import.meta.dirname, '../..'), 'config', 'supply-chain.json');

emit(
  failClosed('supply-chain', () => {
    const { values } = parseArgs({ options: { base: { type: 'string' }, 'base-file': { type: 'string' }, lockfile: { type: 'string' }, allowlist: { type: 'string', default: ALLOWLIST } } });
    const io: SupplyChainIo = {
      readFile: (path) => (existsSync(path) ? readFileSync(path, 'utf8') : undefined),
      git: (args) => spawnSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }),
    };
    return supplyChainFor(values, io, () => ({
      pipAudit: (args) => realToolchain(process.cwd()).run('pip-audit', args),
      tempDir: () => mkdtempSync(join(tmpdir(), 'supply-chain-python-')),
      write: (path, text) => writeFileSync(path, text),
      remove: (dir) => rmSync(dir, { recursive: true, force: true }),
    }));
  }),
);
