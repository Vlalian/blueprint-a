// The sast gate in the Stop gate (ticket 60): a project that turns it on (`"sast": true` in its
// config) has Semgrep's security rules judge the session's diff as one more check, the files the
// diff adds lines to against HEAD. A project that runs a check named "sast" itself is left to it.
// Pure; the Stop gate passes in the run.

import type { CheckResult } from '../four-checks/check.ts';
import { exitCodeFor } from '../lib/contract.ts';
import { addedLines } from '../lib/diff.ts';
import { sastLines, type SastResult } from './gate.ts';

export const NAME = 'sast';

const COMMAND = 'Semgrep security rules (gates/sast) on the changed source files';
const HOW = 'New security findings; fix them, or suppress one on its line with a reason: // nosemgrep: <rule> -- <reason>';

/** The files a unified diff adds lines to, each once. */
export const changedInDiff = (diff: string) => [...new Set(addedLines(diff).map((l) => l.file))];

/** A sast run as one of the four checks' results: failed on a new blocking finding, could not run (2) with what to install. */
export function sastCheck(r: SastResult): CheckResult {
  const exitCode = exitCodeFor(r);
  const lines = sastLines(r);
  return { name: NAME, command: COMMAND, exitCode, tail: (exitCode === 1 ? [HOW, ...lines] : lines).join('\n') };
}

/** The gate on a session's diff for the Stop gate; undefined when the project leaves it off or runs it itself, or there is no diff. */
export function sastFor(diff: string | undefined, config: { sast?: boolean; checks?: Record<string, string> }, run: (files: string[]) => SastResult): SastResult | undefined {
  if (config.sast !== true || diff === undefined || Object.hasOwn(config.checks ?? {}, NAME)) return undefined;
  return run(changedInDiff(diff));
}
