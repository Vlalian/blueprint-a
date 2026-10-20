// Ticket 06's Pass when: four broken fixtures, each made from the good plan and ticket by one
// break, fail exactly one of the four plan gates (decision 39 reopened 06 until this had a test).
import { describe, expect, it } from 'vitest';
import { GOOD_PLAN, GOOD_TICKET } from './fixtures.ts';
import { planGate } from './gate.ts';

const VAGUE = 'Slugs work properly.';

/** Each break, and the one gate it must fail. */
const BROKEN = [
  {
    gate: 'lint',
    what: 'a required section is missing',
    plan: GOOD_PLAN.replace('## Out of scope\nNone.\n\n', ''),
    ticket: GOOD_TICKET,
  },
  {
    gate: 'cross-artifact',
    what: 'the plan cites a file that does not exist as evidence',
    plan: GOOD_PLAN.replace('`src/is-even.ts:1` shows the module style', '`src/is-odd.ts:1` shows the module style'),
    ticket: GOOD_TICKET,
  },
  {
    gate: 'ears',
    what: 'a ticket criterion is not in EARS form',
    plan: GOOD_PLAN.replace('- If the title is empty, then the system shall return an empty string. -> behaviors 2', `- ${VAGUE} -> behaviors 2`),
    ticket: GOOD_TICKET.replace('- [ ] If the title is empty, then the system shall return an empty string.', `- [ ] ${VAGUE}`),
  },
  {
    gate: 'commands',
    what: 'the plan runs a command that is not on the allowlist',
    plan: `${GOOD_PLAN}\nThen \`git push --force\` the branch.\n`,
    ticket: GOOD_TICKET,
  },
] as const;

const run = (plan: string, ticket: string) =>
  planGate({ plan: 'plan.md', ticket: 'ticket.md' }, { readPlan: () => plan, readTicket: () => ticket, exists: (p) => p === 'src/is-even.ts' });

describe('Pass when (ticket 06): each broken fixture fails exactly one plan gate', () => {
  it('starts from a good plan and ticket that pass every gate', () => {
    expect(run(GOOD_PLAN, GOOD_TICKET).pass).toBe(true);
  });

  it.each(BROKEN)('fails only $gate when $what', ({ gate, plan, ticket }) => {
    expect(plan === GOOD_PLAN && ticket === GOOD_TICKET).toBe(false);
    const result = run(plan, ticket);
    expect(result.pass).toBe(false);
    const failing = Object.entries(result.checks).filter(([, findings]) => findings.length > 0).map(([name]) => name);
    expect(failing).toEqual([gate]);
  });

  it('covers each of the four gates once', () => {
    expect(BROKEN.map((b) => b.gate).sort()).toEqual(['commands', 'cross-artifact', 'ears', 'lint']);
  });
});
