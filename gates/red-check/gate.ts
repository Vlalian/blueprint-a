// The red-check gate with its I/O passed in, so it is tested in-process (and mutation-tested);
// cli.ts only wires in git worktrees and the test command.

import type { GateResult } from '../lib/contract.ts';
import { redCheck, type RedFinding } from './core.ts';

const NO_TEST = 'the specifier added no test';

export interface RedCheckIo {
  changedTests(base: string): string[];
  /** A checkout of the base; remove() deletes it again. */
  checkoutBase(base: string): { dir: string; remove(): void };
  copyInto(dir: string, file: string): void;
  /** Runs one test file in dir and returns its exit code. */
  runTest(dir: string, file: string): number;
}

export function redCheckGate(
  opts: { base?: string; allow: string[] },
  io: RedCheckIo,
): GateResult & { tests: string[]; findings: RedFinding[] } {
  const { base, allow } = opts;
  if (!base) throw new Error('usage: red-check --base <ref> [--test-command <cmd>] [--allow <file>]… [--cwd <dir>]');
  const tests = io.changedTests(base);
  // A round that adds no test proves nothing either (ticket 35): the red check passed one with "tests": [].
  if (tests.length === 0) return { gate: 'red-check', pass: false, base, tests, findings: [{ file: '', detail: NO_TEST }] };

  const checkout = io.checkoutBase(base);
  const exitAtBase: Record<string, number> = {};
  try {
    for (const file of tests) {
      io.copyInto(checkout.dir, file);
      exitAtBase[file] = io.runTest(checkout.dir, file);
    }
  } finally {
    checkout.remove();
  }
  const findings = redCheck(tests, exitAtBase, allow);
  return { gate: 'red-check', pass: findings.length === 0, base, tests, exitAtBase, findings };
}
