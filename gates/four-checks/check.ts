// The four checks (lint, typecheck, test, build) as one gate. Pure apart from the injected runner.

import type { GateResult as Contract } from '../lib/contract.ts';

export type Runner = (command: string, cwd: string) => { exitCode: number; output: string };

export interface CheckResult {
  name: string;
  command: string;
  exitCode: number;
  tail: string;
}

export interface GateResult extends Contract {
  gate: 'four-checks';
  results: CheckResult[];
}

const TAIL_LINES = 20;

function tail(output: string): string {
  return output.trimEnd().split('\n').slice(-TAIL_LINES).join('\n');
}

export function runChecks(commands: Record<string, string>, run: Runner, cwd: string): GateResult {
  const entries = Object.entries(commands);
  if (entries.length === 0) {
    return { gate: 'four-checks', pass: false, results: [], error: 'no checks configured; refusing to pass' };
  }
  const results = entries.map(([name, command]) => {
    const { exitCode, output } = run(command, cwd);
    return { name, command, exitCode, tail: tail(output) };
  });
  return { gate: 'four-checks', pass: results.every((r) => r.exitCode === 0), results };
}
