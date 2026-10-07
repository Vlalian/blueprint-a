import { describe, expect, it } from 'vitest';
import { crossArtifact, mappedCriteria } from './cross-artifact.ts';
import { decisionFindings, mappedDecisions, ticketDecisions } from './decisions.ts';
import { GOOD_PLAN, GOOD_TICKET } from './fixtures.ts';

// Ticket 50: the grill writes the owner's decisions into the ticket word for word; the plan maps each one.
const DECIDED = `${GOOD_TICKET}\n## Decisions\n1. A title of only symbols gives an empty slug, not an error.\n2. Digits stay in the slug.\n`;
const MAPPED = GOOD_PLAN.replace('## Out of scope', '- Decision 1 -> criteria 2\n- Decision 2 -> behaviors 1\n\n## Out of scope');

const exists = (p: string) => p === 'src/is-even.ts';
const messages = (plan: string, ticket = DECIDED) => crossArtifact(plan, ticket, exists).map((f) => f.message);

describe('ticketDecisions', () => {
  it('reads each numbered line under ## Decisions, word for word', () => {
    expect(ticketDecisions(DECIDED)).toEqual([
      { n: 1, text: 'A title of only symbols gives an empty slug, not an error.' },
      { n: 2, text: 'Digits stay in the slug.' },
    ]);
  });

  it('reads indented lines and skips lines that are not numbered, and other sections', () => {
    const ticket = '## Decisions\n  3.  Indented.  \nA note.\n- 4. A bullet.\n5.No space.\n## Notes\n6. Not a decision.\n';
    expect(ticketDecisions(ticket)).toEqual([{ n: 3, text: 'Indented.' }]);
  });

  it('reads a decision number of more than one digit', () => {
    expect(ticketDecisions('## Decisions\n12. Twelve.\n')).toEqual([{ n: 12, text: 'Twelve.' }]);
  });

  it('reads nothing from a ticket without the section', () => {
    expect(ticketDecisions(GOOD_TICKET)).toEqual([]);
  });
});

describe('mappedDecisions', () => {
  it('reads "Decision n -> behaviors" and "Decision n -> criteria" lines under the mapping section', () => {
    const plan = '## Acceptance criteria -> behaviors\n- Decision 1 -> behaviors 1, 3\n  -  Decision 2  ->  criterion 2\n-Decision 3->behavior 4\n- Decision 4 -> criteria 1,2\n';
    expect(mappedDecisions(plan)).toEqual([
      { decision: 1, to: 'behaviour', targets: [1, 3] },
      { decision: 2, to: 'criterion', targets: [2] },
      { decision: 3, to: 'behaviour', targets: [4] },
      { decision: 4, to: 'criterion', targets: [1, 2] },
    ]);
  });

  it('reads a decision number of more than one digit', () => {
    expect(mappedDecisions('## Acceptance criteria -> behaviors\n- Decision 12 -> behaviors 1\n')).toEqual([{ decision: 12, to: 'behaviour', targets: [1] }]);
  });

  it('skips lines that are not decision mappings, and mappings in other sections', () => {
    const plan = '## Acceptance criteria -> behaviors\nNote Decision 1 -> behaviors 1\nNote - Decision 4 -> behaviors 1\n- Decision 2 -> behaviors 2 and more\n- Decision x -> behaviors 1\n- Decision 3 -> tests 1\n## Out of scope\n- Decision 5 -> behaviors 1\n';
    expect(mappedDecisions(plan)).toEqual([]);
  });
});

describe('mappedCriteria beside decision mappings', () => {
  it('leaves out only lines that map a decision by its number, of any length', () => {
    const plan = '## Acceptance criteria -> behaviors\n- Decision 12 -> behaviors 1\n- Old Decision 2 -> behaviors 1\n- Decision 2 stands -> behaviors 2\n';
    expect(mappedCriteria(plan)).toEqual([
      { criterion: 'Old Decision 2', behaviours: [1] },
      { criterion: 'Decision 2 stands', behaviours: [2] },
    ]);
  });
});

describe('decisionFindings', () => {
  it('checks criterion targets against the ticket and behaviour targets against the plan', () => {
    const plan = '## Acceptance criteria -> behaviors\n- Decision 1 -> criteria 1, 3\n- Decision 2 -> behaviors 2, 3\n';
    const ticket = '## Decisions\n1. One.\n2. Two.\n';
    expect(decisionFindings(plan, ticket, 3, new Set([3])).map((f) => f.message)).toEqual(['decision 2 maps to behaviour 2, which the plan does not have']);
    expect(decisionFindings(plan, ticket, 2, new Set([2, 3])).map((f) => f.message)).toEqual(['decision 1 maps to criterion 3, which the ticket does not have']);
  });

  it('passes a plan that maps every decision to a criterion or a behaviour', () => {
    expect(decisionFindings(MAPPED, DECIDED, 2, new Set([1, 2]))).toEqual([]);
    expect(messages(MAPPED)).toEqual([]);
  });

  it('refuses a plan that leaves a decision unmapped, and names it', () => {
    const plan = MAPPED.replace('- Decision 2 -> behaviors 1\n', '');
    expect(messages(plan)).toEqual(['decision 2 is not mapped to a criterion or behaviour: "Digits stay in the slug."']);
  });

  it('refuses a mapping to a decision the ticket does not have', () => {
    expect(messages(MAPPED.replace('- Decision 2 ->', '- Decision 3 -> behaviors 2\n- Decision 2 ->'))).toEqual(['mapped decision 3 is not in the ticket']);
  });

  it('refuses a mapping to a behaviour or criterion that does not exist', () => {
    const plan = MAPPED.replace('Decision 1 -> criteria 2', 'Decision 1 -> criteria 0, 2, 3').replace('Decision 2 -> behaviors 1', 'Decision 2 -> behaviors 1, 3');
    expect(messages(plan)).toEqual([
      'decision 1 maps to criterion 0, which the ticket does not have',
      'decision 1 maps to criterion 3, which the ticket does not have',
      'decision 2 maps to behaviour 3, which the plan does not have',
    ]);
  });

  it('does not read a decision mapping as a criterion mapping', () => {
    expect(messages(MAPPED, GOOD_TICKET)).toEqual(['mapped decision 1 is not in the ticket', 'mapped decision 2 is not in the ticket']);
  });
});
