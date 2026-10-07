// The plan gate: plan-lint, cross-artifact, EARS, the command allowlist and the fact lint (ticket
// 24, gates/research/facts.ts) in one result, with its I/O passed in so it is tested in-process.
// cli.ts only wires in the file system.

import { join } from 'node:path';
import type { GateResult } from '../lib/contract.ts';
import { claimFindings, factFindings } from '../research/facts.ts';
import { bugPlanFindings } from './bug.ts';
import { commandFindings, commandsIn, DEFAULT_ALLOW } from './commands.ts';
import { crossArtifact, ticketCriteria } from './cross-artifact.ts';
import { earsFindings } from './ears.ts';
import { lintPlan, type PlanFinding } from './lint.ts';

export interface PlanIo {
  readPlan(path: string): string;
  readTicket(path: string): string;
  /** Whether a repo-relative path exists in the project. */
  exists(path: string): boolean;
  /** A claims file of the ticket's research by name, from state/research/<project>/<ticket>/ (ticket 35); without it cited claims are not looked up. */
  claims?(name: string): string | undefined;
}

type Checks = Record<'lint' | 'cross-artifact' | 'ears' | 'commands' | 'facts', PlanFinding[]>;

/** The claims lookup for a folder of claims files (the CLI's --research); none without a folder. */
export const claimsIn = (dir: string | undefined, read: (path: string) => string | undefined): PlanIo['claims'] =>
  dir === undefined ? undefined : (name) => read(join(dir, `${name}.md`));

export function planGate(opts: { plan?: string; ticket?: string; allow?: string[] }, io: PlanIo): GateResult & { checks: Checks } {
  if (!opts.plan || !opts.ticket) throw new Error('usage: plan --plan <plan.md> --ticket <ticket.md> [--allow <command>]… [--repo <dir>]');
  const plan = io.readPlan(opts.plan);
  const ticket = io.readTicket(opts.ticket);
  const checks: Checks = {
    // Ticket 51: a bug ticket's plan has the bug sections too (bug.ts).
    lint: [...lintPlan(plan), ...bugPlanFindings(plan, ticket)],
    'cross-artifact': crossArtifact(plan, ticket, io.exists),
    ears: earsFindings(ticketCriteria(ticket)),
    commands: commandFindings(commandsIn(plan), opts.allow ? [...DEFAULT_ALLOW, ...opts.allow] : DEFAULT_ALLOW),
    facts: [...factFindings(plan), ...(io.claims ? claimFindings(plan, io.claims) : [])],
  };
  return { gate: 'plan', pass: Object.values(checks).every((f) => f.length === 0), checks };
}
