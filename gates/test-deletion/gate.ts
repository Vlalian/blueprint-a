// The test-deletion gate with its I/O passed in, so it is tested in-process (and mutation-tested);
// cli.ts only wires in git and the file system.

import type { GateResult } from '../lib/contract.ts';
import { isTestFile } from '../lib/test-files.ts';
import { deletedTests, type DeletedTest } from './core.ts';
import { checkPlanned, planDeletions, type Unreplaced } from './plan.ts';

export interface DeletionIo {
  filesAt(ref: string): string[];
  showAt(ref: string, path: string): string;
  /** The file in the working tree, or undefined when it is gone. */
  readHead(path: string): string | undefined;
  /** A plan file --plan names (ticket 70). */
  readPlan(path: string): string;
}

export function testDeletionGate(
  opts: { base?: string; allow: string[]; plan: string[] },
  io: DeletionIo,
): GateResult & { deleted: DeletedTest[]; unreplaced: Unreplaced[] } {
  const { base, allow } = opts;
  if (!base) throw new Error('usage: test-deletion --base <ref> [--allow <file | file::title>]… [--plan <file>]… [--cwd <dir>]');
  const testFiles = io.filesAt(base).filter(isTestFile);
  const atBase = Object.fromEntries(testFiles.map((f) => [f, io.showAt(base, f)]));
  const atHead: Record<string, string> = {};
  for (const f of testFiles) {
    const text = io.readHead(f);
    // Stryker disable next-line ConditionalExpression: deletedTests reads head[file], which is undefined whether the key is missing or holds undefined.
    if (text !== undefined) atHead[f] = text;
  }
  const planned = opts.plan.flatMap((file) => planDeletions(io.readPlan(file)));
  const { deleted, unreplaced } = checkPlanned(deletedTests(atBase, atHead, allow), planned, io.readHead);
  return { gate: 'test-deletion', pass: deleted.length + unreplaced.length === 0, base, deleted, unreplaced };
}
