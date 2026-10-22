// node scripts/runner-checks.ts [--only <name>]...   [WORKFLOW_STATE_DIR=<dir>]
// The project's checks (config/runner.json `checks`) with the check-tree cache (ticket 83): a check
// that passed on this tree with the same command and env file is reused, so a pre-commit hook or a
// CI job on an unchanged tree runs nothing twice. Prints the gate result as JSON. Exit 0 pass,
// 1 fail, 2 could not run. Every decision is in runner-checks-core.ts; this file only wires in
// git, the shell, the files and the clock.
// @process-shell

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { emit, failClosed } from '../gates/lib/contract.ts';
import { shellRunner } from '../gates/four-checks/runner.ts';
import { worktreeTree } from '../gates/four-checks/tree.ts';
import { runnerChecks } from './runner-checks-core.ts';

// The repo the checks belong to is the one it is run in, as a pre-commit hook or a CI job runs it.
const ROOT = process.cwd();
const inFolder = (path: string) => mkdirSync(dirname(path), { recursive: true });

emit(
  failClosed('runner-checks', () =>
    runnerChecks(process.argv.slice(2), process.env, {
      root: ROOT,
      project: basename(ROOT),
      run: shellRunner,
      read: (path) => (existsSync(path) ? readFileSync(path, 'utf8') : undefined),
      write: (path, text) => (inFolder(path), writeFileSync(path, text)),
      append: (path, text) => (inFolder(path), appendFileSync(path, text)),
      tree: worktreeTree,
      ms: () => performance.now(),
      now: () => new Date().toISOString(),
    }),
  ),
);
