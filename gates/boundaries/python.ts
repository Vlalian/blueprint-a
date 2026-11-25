// The boundaries gate for a Python project (ticket 99): import-linter's contracts (forbidden imports,
// layers, independence), kept in the project's pyproject.toml ([tool.importlinter]) or .importlinter.
// lint-imports exits 1 both on a broken contract and on a config or import error, and prints text,
// not JSON; so the verdict comes from its "Contracts: N kept, M broken." line, and output without
// one is a gate that could not run, never a pass. Pure; cli.ts wires in lint-imports.

import type { GateResult } from '../lib/contract.ts';
import type { Ran } from '../../adapters/python/toolchain.ts';

export interface ImportLinterIo {
  /** `lint-imports --no-logo --no-cache` in the project folder. */
  lintImports(): Ran;
}

export interface PythonViolation {
  rule: string;
  from: string;
  to: string;
  /** The line numbers, as import-linter lists them. */
  lines: string;
}

const SUMMARY = /^Contracts: (\d+) kept, (\d+) broken\.$/m;
const IMPORT = /^-\s+(\S+) -> (\S+) \(l\.([^)]*)\)$/gm;
// A heading: a line, then a line of dashes under it.
const HEADING = /(.+)\n-+$/m;

/** The forbidden imports listed in one broken contract's text. */
const importsIn = (rule: string, text: string): PythonViolation[] =>
  [...text.matchAll(IMPORT)].map((m) => ({ rule, from: m[1]!, to: m[2]!, lines: m[3]!.replace(/l\./g, '') }));

/** Each forbidden import under "Broken contracts", with the contract it breaks: the section splits at each contract's heading. */
function violations(stdout: string): PythonViolation[] {
  const section = stdout.replace(/\r/g, '').split(/^Broken contracts\n-+$/m)[1];
  if (section === undefined) return [];
  const parts = section.split(HEADING);
  return parts.flatMap((part, i) => (i % 2 === 1 ? importsIn(part, parts[i + 1]!) : []));
}

export function importLinterGate(io: ImportLinterIo): GateResult & { kept: number; broken: number; violations: PythonViolation[] } {
  const r = io.lintImports();
  const summary = SUMMARY.exec(r.stdout);
  if (summary === null) {
    const said = [r.stdout, r.stderr, r.error?.message].filter(Boolean).join('\n').replace(/=+\nImport Linter\n=+/, '').trim();
    throw new Error(`import-linter could not run (exit ${r.status}): ${said}`);
  }
  const kept = Number(summary[1]);
  const broken = Number(summary[2]);
  if (kept + broken === 0) throw new Error('import-linter checked no contract: add one to [tool.importlinter] in pyproject.toml or .importlinter');
  return { gate: 'boundaries', pass: broken === 0, kept, broken, violations: violations(r.stdout) };
}
