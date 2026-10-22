// The duplication gate with its I/O passed in, so it is tested in-process (and mutation-tested);
// cli.ts only wires in git and jscpd.

import type { GateResult } from '../lib/contract.ts';
import type { AddedLine } from '../lib/diff.ts';
import { clonesTouching, parseReport, type Clone } from './core.ts';

export interface DuplicationIo {
  /** Lines added since base, untracked files included (gates/lib/changes.ts). */
  changedLines(base: string): AddedLine[];
  /** jscpd's JSON report for the whole tree. */
  jscpdReport(): string;
}

export function duplicationGate(opts: { base?: string }, io: DuplicationIo): GateResult & { clones: Clone[] } {
  const { base } = opts;
  if (!base) throw new Error('usage: duplication --base <ref> [--cwd <dir>]');
  const changed = io.changedLines(base);
  const clones = changed.length === 0 ? [] : clonesTouching(parseReport(io.jscpdReport()), changed);
  return { gate: 'duplication', pass: clones.length === 0, base, clones };
}
