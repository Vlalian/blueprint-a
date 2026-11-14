// node gates/hardener/cli.ts --base <ref> [--self]
// The hardener's Stop gate check: onkel on every source file changed since <ref> (untracked files
// count), so a surviving mutant or a CRAP breach anywhere in the ticket's change blocks the stop.
// Under a cloud role's gate (ticket 32) $WORKFLOW_GATE_JSON names where onkel writes its result.
// --self (ticket 41: the workflow project, this repo built in a worktree of its own) grades as the
// self-gate does: config/runner.json's source folders, shells and CRAP limit, and its Stryker timeouts.
// Exit 0 pass, 1 fail, 2 could not run. The logic is in gate.ts; onkel prints its own report.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { git } from '../lib/git.ts';
import { exitCodeOf } from '../onkel/run-core.ts';
import { parseRunnerConfig, RUNNER_CONFIG } from '../../runner/runner-config.ts';
import { gradableFiles, selfOnkelFlags } from '../../runner/self-gate-core.ts';
import { SHELLS } from '../../runner/self-gate-shells.ts';
import { LS_SOURCES, shellsIn } from '../../runner/shells.ts';
import { hardenerGate } from './gate.ts';

const { values } = parseArgs({ options: { base: { type: 'string' }, self: { type: 'boolean', default: false } } });
const cwd = process.cwd();
const ONKEL = join(import.meta.dirname, '..', 'onkel', 'run.ts');
const readText = (p: string) => (existsSync(join(cwd, p)) ? readFileSync(join(cwd, p), 'utf8') : undefined);

/** The self-gate's way of grading this repo, for --self. */
const self = () => {
  const config = parseRunnerConfig(readText(RUNNER_CONFIG));
  return {
    flags: selfOnkelFlags(shellsIn(SHELLS, git(cwd, ...LS_SOURCES), readText), readText(config.strykerConfig), config),
    graded: (files: string[]) => gradableFiles(files, (p) => existsSync(join(cwd, p)), config.sourceDirs),
  };
};

// process.exitCode, never process.exit(): onkel's report has just gone to a stdout that is often a
// pipe, and exiting right after such a write crashes Node on Windows (exit 0xC0000409).
process.exitCode = exitCodeOf(() =>
  hardenerGate({ ...values, json: process.env.WORKFLOW_GATE_JSON }, {
    diffNames: (base) => git(cwd, 'diff', '--name-only', '-z', '--diff-filter=d', base, '--'),
    untracked: () => git(cwd, 'ls-files', '-z', '--others', '--exclude-standard'),
    onkel: (args) => spawnSync(process.execPath, [ONKEL, ...args], { cwd, stdio: 'inherit' }).status,
    log: (line) => process.stdout.write(`${line}\n`),
    self: values.self ? self() : undefined,
  }),
);
