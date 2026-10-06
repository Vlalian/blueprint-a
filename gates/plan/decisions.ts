// Decision ledger (ticket 50, Matt's grill-with-docs: "Where did all my other decisions go?"): the
// grill writes what the owner decides into the ticket's `## Decisions` section, one numbered line each,
// word for word, and the plan maps every decision to a ticket criterion or a behaviour in its
// "Acceptance criteria -> behaviors" section (`- Decision 2 -> behaviors 3` or
// `- Decision 2 -> criteria 1`, criteria counted in ticket order). The cross-artifact check refuses
// a decision left unmapped, naming it.

import { sections, type PlanFinding } from './lint.ts';

export interface Decision {
  n: number;
  text: string;
}

export interface DecisionMapping {
  decision: number;
  to: 'behaviour' | 'criterion';
  targets: number[];
}

const bodies = (text: string, title: string) =>
  sections(text)
    .filter((s) => s.title === title)
    .map((s) => s.body);

export function ticketDecisions(ticket: string): Decision[] {
  const lines = bodies(ticket, 'Decisions').flatMap((body) => [...body.matchAll(/^[ \t]*(\d+)\.[ \t]+(.+?)[ \t]*$/gm)]);
  return lines.map((m) => ({ n: Number(m[1]), text: m[2]! }));
}

/** A mapping line's decision, its kind of target and the target numbers. */
export const DECISION_LINE = /^[ \t]*-[ \t]*Decision (\d+)[ \t]*->[ \t]*(behaviou?rs?|criteri(?:on|a)) ([\d, ]+)$/gm;

export function mappedDecisions(plan: string): DecisionMapping[] {
  const lines = bodies(plan, 'Acceptance criteria -> behaviors').flatMap((body) => [...body.matchAll(DECISION_LINE)]);
  return lines.map((m) => ({ decision: Number(m[1]), to: m[2]!.startsWith('b') ? 'behaviour' : 'criterion', targets: m[3]!.split(',').map(Number) }));
}

function targetErrors(m: DecisionMapping, criteria: number, have: Set<number>): PlanFinding[] {
  const owner = m.to === 'behaviour' ? 'plan' : 'ticket';
  const exists = (t: number) => (m.to === 'behaviour' ? have.has(t) : t >= 1 && t <= criteria);
  return m.targets.filter((t) => !exists(t)).map((t) => ({ message: `decision ${m.decision} maps to ${m.to} ${t}, which the ${owner} does not have` }));
}

/** Every ticket decision mapped, and every mapping pointing at a real decision, criterion or behaviour. */
export function decisionFindings(plan: string, ticket: string, criteria: number, have: Set<number>): PlanFinding[] {
  const decisions = ticketDecisions(ticket);
  const mapped = mappedDecisions(plan);
  const unmapped = decisions.filter((d) => !mapped.some((m) => m.decision === d.n));
  const known = (m: DecisionMapping) => decisions.some((d) => d.n === m.decision);
  return [
    ...unmapped.map((d) => ({ message: `decision ${d.n} is not mapped to a criterion or behaviour: "${d.text}"` })),
    ...mapped.flatMap((m) => (known(m) ? targetErrors(m, criteria, have) : [{ message: `mapped decision ${m.decision} is not in the ticket` }])),
  ];
}
