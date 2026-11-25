// @process-shell
// node gates/red-check/cli.ts --base <ref> [--test-command "npx vitest run"] [--junit] [--allow <file>]… [--cwd <dir>]
// Runs every new or changed test file against the code at <ref>; each must fail there, and a
// round with no new or changed test file fails (ticket 35). The failed test is read from the
// runner's JSON on stdout (vitest, Jest), or, with --junit, from the JUnit XML report pytest writes
// to the red check's own path in the checkout (`--junitxml` is added to the command, ticket 99). A
// collection error importing the project's own code not written yet is red there too. `{CWD}` in
// the test command is the worktree. Exit 0 pass, 1 fail, 2 could not run. The logic is in gate.ts
// and core.ts.
//
// The base is checked out as a temporary git worktree under <cwd>/.red-check/ (listed in
// .git/info/exclude, removed afterwards), so node_modules resolves from the project.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { emit, failClosed } from '../lib/contract.ts';
import { git } from '../lib/git.ts';
import { redCheckProject } from './gate.ts';

const { values } = parseArgs({
  options: {
    base: { type: 'string' },
    'test-command': { type: 'string', default: 'npx vitest run --reporter=json' },
    junit: { type: 'boolean', default: false },
    allow: { type: 'string', multiple: true, default: [] },
    cwd: { type: 'string' },
  },
});
const cwd = values.cwd ?? process.cwd();
emit(
  failClosed('red-check', () =>
    redCheckProject({
      ...values, cwd, command: values['test-command'], platform: process.platform, pid: process.pid,
    }, {
      git: (...args) => git(cwd, ...args),
      exists: existsSync,
      read: (path) => (existsSync(path) ? readFileSync(path, 'utf8') : undefined),
      makeDir: (path) => mkdirSync(path, { recursive: true }),
      write: writeFileSync,
      copy: copyFileSync,
      run: (line, dir) => spawnSync(line, { cwd: dir, shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 5 * 60 * 1000 }), // nosemgrep: spawn-shell-true, detect-child-process -- runs the configured test command, a shell string by design (the owner, 2026-10-21)
    }),
  ),
);
