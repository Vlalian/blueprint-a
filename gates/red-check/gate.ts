// The red-check gate with its I/O passed in, so it is tested in-process (and mutation-tested);
// cli.ts only wires in git worktrees and the test command.

import { dirname, join, resolve } from 'node:path';
import type { GateResult } from '../lib/contract.ts';
import { isTestFile } from '../lib/test-files.ts';
import { ownPackage, redCheck, runRedTest, type RedFinding, type RedRunIo } from './core.ts';
import { ensureTempDirExcluded, excludeFile, type ExcludeIo } from './exclude.ts';

interface RedCheckProjectOptions {
  base?: string;
  allow: string[];
  cwd: string;
  command: string;
  junit: boolean;
  platform: string;
  pid: number;
}

interface RedCheckProjectIo extends RedRunIo, ExcludeIo {
  git(...args: string[]): string;
  exists(path: string): boolean;
  copy(from: string, to: string): void;
}

export function redCheckProject(opts: RedCheckProjectOptions, io: RedCheckProjectIo) {
  const { cwd, junit, platform, pid } = opts;
  const command = opts.command.replaceAll('{CWD}', resolve(cwd).split('\\').join('/'));
  const own = ownPackage(cwd, io.exists);
  return redCheckGate(opts, {
    changedTests: (base) => {
      // Treat a moved and edited test as added so the AM filter sees it (review #25).
      const tracked = io.git('diff', '--name-only', '--no-renames', '--diff-filter=AM', base, '--');
      const untracked = io.git('ls-files', '--others', '--exclude-standard');
      return [...new Set([...tracked.split('\n'), ...untracked.split('\n')])]
        .filter((path) => isTestFile(path) && !path.startsWith('.red-check/'));
    },
    checkoutBase: (base) => {
      ensureTempDirExcluded(excludeFile(cwd, io.git('rev-parse', '--git-common-dir').trim()), io);
      const dir = join(cwd, '.red-check', `base-${pid}`);
      io.git('worktree', 'add', '--detach', '--force', dir, base);
      return { dir, remove: () => io.git('worktree', 'remove', '--force', dir) };
    },
    copyInto: (dir, file) => {
      const target = join(dir, file);
      io.makeDir(dirname(target));
      io.copy(join(cwd, file), target);
    },
    runTest: (dir, file) => runRedTest({ command, junit, platform, own }, dir, file, io),
  });
}

const NO_TEST = 'the specifier added no test';

export interface RedCheckIo {
  changedTests(base: string): string[];
  /** A checkout of the base; remove() deletes it again. */
  checkoutBase(base: string): { dir: string; remove(): void };
  copyInto(dir: string, file: string): void;
  /** Runs one test file in dir and returns its exit code. */
  runTest(dir: string, file: string): { exitCode: number; failedTest: boolean };
}

export function redCheckGate(
  opts: { base?: string; allow: string[] },
  io: RedCheckIo,
): GateResult & { tests: string[]; findings: RedFinding[] } {
  const { base, allow } = opts;
  if (!base) throw new Error('usage: red-check --base <ref> [--test-command <cmd>] [--junit] [--allow <file>]… [--cwd <dir>]');
  const tests = io.changedTests(base);
  // A round that adds no test proves nothing either (ticket 35): the red check passed one with "tests": [].
  if (tests.length === 0) return { gate: 'red-check', pass: false, base, tests, findings: [{ file: '', detail: NO_TEST }] };

  const checkout = io.checkoutBase(base);
  const exitAtBase: Record<string, number> = {};
  const failedAtBase: Record<string, boolean> = {};
  try {
    for (const file of tests) {
      io.copyInto(checkout.dir, file);
      const run = io.runTest(checkout.dir, file);
      exitAtBase[file] = run.exitCode;
      failedAtBase[file] = run.failedTest;
    }
  } finally {
    checkout.remove();
  }
  const findings = redCheck(tests, exitAtBase, allow, failedAtBase);
  return { gate: 'red-check', pass: findings.length === 0, base, tests, exitAtBase, findings };
}
