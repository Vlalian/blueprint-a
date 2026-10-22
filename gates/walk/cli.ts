// node gates/walk/cli.ts --report <report.json> --head <sha> --patch-id <id> --spec <file>...
//   [--criterion <id>]... [--qa <id>]... [--not-run <id>]... [--quarantined <id>=<issue url>]...
//   --playwright <the app's @playwright/test cli.js> --base-url <url> [--repo <dir>]
// The walk gate (ticket 23): the walk report through gates/evidence, then the pinned specs in the
// app's own Playwright with 2 retries against --base-url. Paths are relative to --repo. Exit 0
// pass, 1 fail (blocks), 2 could not run (blocks too). Logic in gate.ts.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { emit, failClosed } from '../lib/contract.ts';
import { gateOptions, playwrightArgs, specRun, walkGate } from './gate.ts';

const many = { type: 'string', multiple: true } as const;
const one = { type: 'string' } as const;
const OPTIONS = { report: one, head: one, 'patch-id': one, spec: many, criterion: many, qa: many, 'not-run': many, quarantined: many, playwright: one, 'base-url': one, repo: one };

// parseArgs runs inside failClosed, so an unknown option exits 2, never 1.
emit(
  failClosed('walk', () => {
    const { values } = parseArgs({ options: OPTIONS });
    const repo = values.repo ?? process.cwd();
    const env = { ...process.env, WALK_BASE_URL: values['base-url'] };
    return walkGate(gateOptions(values), {
      read: (p) => readFileSync(join(repo, p), 'utf8'),
      exists: (p) => existsSync(join(repo, p)),
      runSpecs: (specs) => specRun(spawnSync(process.execPath, playwrightArgs(join(repo, String(values.playwright)), specs), { cwd: repo, env, encoding: 'utf8' })),
    });
  }),
);
