// Ticket 50's Pass-when, through the whole plan gate with fake file I/O: a plan that leaves a
// ticket decision unmapped is refused and names it; a mapped one passes; a plan whose Approach
// contradicts an ADR without the flag is refused. (The grill skill's round, confirm and slicing
// rules are checked in skills/grill/skill.test.ts.)
import { describe, expect, it } from 'vitest';
import { GOOD_PLAN, GOOD_TICKET } from './fixtures.ts';
import { planGate, type PlanIo } from './gate.ts';

const TICKET = `${GOOD_TICKET}\n## Decisions\n1. A title of only symbols gives an empty slug, never an error.\n`;
const MAPPED = GOOD_PLAN.replace('## Out of scope', '- Decision 1 -> behaviors 2\n\n## Out of scope');

const gate = (plan: string, ticket = TICKET) => {
  const files: Record<string, string> = { 'plan.md': plan, 'ticket.md': ticket };
  const io: PlanIo = { readPlan: (p) => files[p]!, readTicket: (p) => files[p]!, exists: (p) => p === 'src/is-even.ts' };
  return planGate({ plan: 'plan.md', ticket: 'ticket.md' }, io);
};

describe('ticket 50 pass-when: grill decisions and ADRs reach the plan gate', () => {
  it('refuses a plan that leaves a ticket decision unmapped, naming the decision', () => {
    const result = gate(GOOD_PLAN);
    expect(result.pass).toBe(false);
    expect(result.checks['cross-artifact']).toEqual([{ message: 'decision 1 is not mapped to a criterion or behaviour: "A title of only symbols gives an empty slug, never an error."' }]);
  });

  it('passes the plan that maps it', () => {
    expect(gate(MAPPED)).toMatchObject({ pass: true });
  });

  it('refuses a plan whose Approach contradicts an ADR without the flag, and passes it with the flag', () => {
    const against = MAPPED.replace('New pure function in `src/slugify.ts`.', 'New pure function in `src/slugify.ts`, one process per role, against ADR-0005.');
    const refused = gate(against);
    expect(refused.pass).toBe(false);
    expect(refused.checks['cross-artifact']).toEqual([{ message: 'Approach contradicts ADR-0005 without the flag "Contradicts ADR-0005, worth reopening because ..."' }]);
    const flagged = against.replace("## Needs the owner's own eyes\nNone.", "## Needs the owner's own eyes\n- Contradicts ADR-0005, worth reopening because the pilot needs a third controller.\n  Recommended: reopen ADR-0005 for the pilot only.\n  Why it matters: it changes how many controllers may run at once.");
    expect(gate(flagged)).toMatchObject({ pass: true });
  });
});
