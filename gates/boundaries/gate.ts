// The boundaries gate with its I/O passed in, so it is tested in-process (and mutation-tested);
// cli.ts only wires in dependency-cruiser.
//
// With `--output-type json` dependency-cruiser exits 0 whatever it finds, and a crash prints no
// JSON. So the verdict comes from the JSON summary, and output without one is a gate that could
// not run, never a pass.

import type { GateResult } from '../lib/contract.ts';

export interface Cruise {
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface BoundariesIo {
  /** dependency-cruiser with `--output-type json`. */
  cruise(): Cruise;
}

export interface Violation {
  rule: string;
  from: string;
  to: string;
  cycle?: string[];
}

type Raw = { from: string; to: string; rule: { name: string; severity: string }; cycle?: Array<{ name: string }> };

function summaryOf(r: Cruise): { violations: Raw[] } {
  try {
    const summary = (JSON.parse(r.stdout) as { summary?: { violations: Raw[] } }).summary;
    if (summary) return summary;
  } catch {
    // reported below with what dependency-cruiser printed
  }
  throw new Error(`dependency-cruiser could not run (exit ${r.status}): ${r.stderr.trim()}`);
}

const violation = (v: Raw): Violation => ({ rule: v.rule.name, from: v.from, to: v.to, ...(v.cycle ? { cycle: v.cycle.map((c) => c.name) } : {}) });

export function boundariesGate(io: BoundariesIo): GateResult & { violations: Violation[] } {
  const violations = summaryOf(io.cruise())
    .violations.filter((v) => v.rule.severity === 'error')
    .map(violation);
  return { gate: 'boundaries', pass: violations.length === 0, violations };
}
