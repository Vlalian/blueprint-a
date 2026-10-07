// "Prove it bites" (from mattpocock/skills setup-ts-deep-modules §6): a gate is only trusted
// once it has been seen to pass on clean input, fail on an injected violation, and pass again
// after the violation is reverted. Returns the three exit codes; the caller asserts on them.
// The canary (gates/canary) reruns these tests weekly: when WORKFLOW_CANARY_REPORT names a file,
// each check appends its three exit codes there as one JSON line, with its gate when the caller
// names one (a test file that proves more than one gate).

import { appendFileSync } from 'node:fs';

export interface BiteCheck {
  run: () => number;
  inject: () => void;
  revert: () => void;
  /** The gate this check proves, when the test file proves more than the one its folder names. */
  gate?: string;
}

export function proveItBites({ run, inject, revert, gate }: BiteCheck): { clean: number; injected: number; reverted: number } {
  const clean = run();
  inject();
  let injected: number;
  try {
    injected = run();
  } finally {
    revert();
  }
  const reverted = run();
  const report = process.env.WORKFLOW_CANARY_REPORT;
  if (report) appendFileSync(report, `${JSON.stringify({ gate, clean, injected, reverted })}\n`);
  return { clean, injected, reverted };
}

export const BITES = { clean: 0, injected: 1, reverted: 0 } as const;
