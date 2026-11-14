// node gates/walk/cli.ts --report <report.json> --head <sha> --patch-id <id>
//   [--criterion <id>]... [--qa <id>]... [--not-run <id>]... [--quarantined <id>=<issue url>]... [--repo <dir>]
// The walk gate (ticket 23): the walk report through gates/evidence, bound to the head and covering
// every expected item, with no item failed (the spec replay went in ticket 95). Paths are relative
// to --repo. Exit 0 pass, 1 fail (blocks), 2 could not run (blocks too). Logic in gate.ts.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { emit, failClosed } from '../lib/contract.ts';
import { gateOptions, walkGate } from './gate.ts';

const many = { type: 'string', multiple: true } as const;
const one = { type: 'string' } as const;
const OPTIONS = { report: one, head: one, 'patch-id': one, criterion: many, qa: many, 'not-run': many, quarantined: many, repo: one };

// parseArgs runs inside failClosed, so an unknown option exits 2, never 1.
emit(
  failClosed('walk', () => {
    const { values } = parseArgs({ options: OPTIONS });
    const repo = values.repo ?? process.cwd();
    return walkGate(gateOptions(values), {
      read: (p) => readFileSync(join(repo, p), 'utf8'),
      exists: (p) => existsSync(join(repo, p)),
    });
  }),
);
