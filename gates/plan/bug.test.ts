import { describe, expect, it } from 'vitest';
import { BUG_PLAN, BUG_TICKET } from './bug-fixtures.ts';
import { bugPlanFindings, bugPromptLines, isBugTicket } from './bug.ts';
import { GOOD_PLAN, GOOD_TICKET } from './fixtures.ts';

const messages = (plan: string, ticket = BUG_TICKET) => bugPlanFindings(plan, ticket).map((f) => f.message);
const PERF_TICKET = BUG_TICKET.replace('Category: bug\n', 'Category: bug (performance)\n');
const BASELINE = '## Baseline\nThe page takes 840 ms at the median of 20 loads.\n\n';
const PERF_PLAN = BUG_PLAN.replace('## Reproduction', `${BASELINE}## Reproduction`);
const SLACK = ['xo', 'x'].join('');

/** The bug plan with one section's body replaced. */
const withBody = (title: string, body: string) => BUG_PLAN.replace(new RegExp(`## ${title}\\n[\\s\\S]*?(?=\\n## )`), `## ${title}\n${body}\n`);

describe('the bug fixtures', () => {
  it('are the good ticket with a Category line under its Status line, and the good plan with the bug sections before its Behavior list', () => {
    expect(BUG_TICKET.split('\n').slice(0, 5)).toEqual(['# 01 Add slugify', '', 'Status: ready-for-agent', 'Category: bug', '']);
    expect(BUG_PLAN.indexOf('## Test seam')).toBeLessThan(BUG_PLAN.indexOf('## Behavior list'));
    expect(BUG_PLAN.indexOf('## Reproduction')).toBeGreaterThan(BUG_PLAN.indexOf('## Patterns to mirror'));
  });
});

describe('isBugTicket', () => {
  it('is a ticket with a "Category: bug" line, in any case, with words after it', () => {
    expect(isBugTicket(BUG_TICKET)).toBe(true);
    expect(isBugTicket('# 01 X\n\ncategory: Bug (performance)\n')).toBe(true);
    expect(isBugTicket('# 01 X\nCategory:bug\n')).toBe(true);
    expect(isBugTicket(GOOD_TICKET)).toBe(false);
    expect(isBugTicket('# 01 X\nCategory: bugfix\n')).toBe(false);
    expect(isBugTicket('# 01 X\nThe Category: bug line is missing.\n')).toBe(false);
  });
});

describe('bugPlanFindings', () => {
  it('passes a bug plan with a reproduction, ranked hypotheses and a test seam', () => {
    expect(messages(BUG_PLAN)).toEqual([]);
  });

  it('asks nothing of a plan whose ticket is not a bug', () => {
    expect(messages(GOOD_PLAN, GOOD_TICKET)).toEqual([]);
  });

  it('refuses a bug plan without the bug sections, naming each', () => {
    expect(messages(GOOD_PLAN)).toEqual([
      'missing section "## Reproduction" (the ticket is a bug)',
      'missing section "## Hypotheses" (the ticket is a bug)',
      'missing section "## Test seam" (the ticket is a bug)',
    ]);
  });

  it('needs a reproduction test that asserts, how it fails before the fix, and how it was minimised', () => {
    expect(messages(withBody('Reproduction', 'Open the page and look.'))).toEqual([
      'the reproduction has no ```ts test that asserts (expect( or assert)',
      'the reproduction does not say how it fails before the fix ("Fails before the fix with: …")',
      'the reproduction does not say how it was minimised ("Minimised: …")',
    ]);
    expect(messages(withBody('Reproduction', '```ts\nslugify(x);\n```\nFails before the fix with: x\nMinimised: one line'))).toEqual([
      'the reproduction has no ```ts test that asserts (expect( or assert)',
    ]);
    expect(messages(withBody('Reproduction', '```ts\nassert.equal(slugify(x), y);\n```\nFails before the fix with:x\nMinimised:one line'))).toEqual([]);
    expect(messages(withBody('Reproduction', '```ts\nexpect(1);\n```\nFails before the fix with:\nMinimised:'))).toEqual([
      'the reproduction does not say how it fails before the fix ("Fails before the fix with: …")',
      'the reproduction does not say how it was minimised ("Minimised: …")',
    ]);
    expect(messages(withBody('Reproduction', '```ts\nexpect(1);\n```\nNote: Fails before the fix with: x\nNote: Minimised: y'))).toHaveLength(2);
  });

  it('needs 3 to 5 hypotheses', () => {
    const two = '1. A. Check: a.\n2. B. Check: b.';
    expect(messages(withBody('Hypotheses', two))).toEqual(['a bug plan has 3 to 5 ranked hypotheses; found 2']);
    const six = [1, 2, 3, 4, 5, 6].map((n) => `${n}. H${n}. Check: c${n}.`).join('\n');
    expect(messages(withBody('Hypotheses', six))).toEqual(['a bug plan has 3 to 5 ranked hypotheses; found 6']);
    const five = [1, 2, 3, 4, 5].map((n) => `${n}. H${n}. Check: c${n}.`).join('\n');
    expect(messages(withBody('Hypotheses', five))).toEqual([]);
    expect(messages(withBody('Hypotheses', 'None yet.'))).toEqual(['a bug plan has 3 to 5 ranked hypotheses; found 0']);
  });

  it('counts hypotheses numbered past 9, and only lines that start with a number', () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `${i + 1}. H. Check: c.`).join('\n');
    expect(messages(withBody('Hypotheses', eleven))).toEqual(['a bug plan has 3 to 5 ranked hypotheses; found 11']);
    expect(messages(withBody('Hypotheses', '1. A.\n   Check: step 2. passes\n2. B. Check:b.\n3. C. Check: c.'))).toEqual([]);
  });

  it('needs the hypotheses ranked 1..n in order', () => {
    expect(messages(withBody('Hypotheses', '1. A. Check: a.\n3. B. Check: b.\n2. C. Check: c.'))).toEqual(['hypotheses are ranked 1..n in order, most likely first; found 1, 3, 2']);
  });

  it('needs each hypothesis to name the check that would falsify it, on its own line or the next', () => {
    expect(messages(withBody('Hypotheses', '1. A. Check: a.\n2. B, look around.\n3. C.\n   Check: run the repro with a space.'))).toEqual([
      'hypothesis 2 names no check that would falsify it ("Check: …")',
    ]);
    expect(messages(withBody('Hypotheses', '1. A. Check: a.\n2. B. Check:\n3. C. Check: c.'))).toEqual(['hypothesis 2 names no check that would falsify it ("Check: …")']);
    expect(messages(withBody('Hypotheses', '1. A. Check: a.\n2. B. Checks: b.\n3. C. Check: c.'))).toEqual(['hypothesis 2 names no check that would falsify it ("Check: …")']);
  });

  it('refuses a test seam section that skips the test; no good seam is a finding, not a reason', () => {
    const why = 'the test seam section skips the test: "no good test seam" is a finding the plan states, never a reason to skip the test';
    expect(messages(withBody('Test seam', 'No good seam, so we skip the repro test.'))).toEqual([why]);
    expect(messages(withBody('Test seam', 'We skipped the test.'))).toEqual([why]);
    expect(messages(withBody('Test seam', 'Fixed without a test.'))).toEqual([why]);
    expect(messages(withBody('Test seam', 'Fixed without tests.'))).toEqual([why]);
    expect(messages(withBody('Test seam', 'There is no test for this.'))).toEqual([why]);
    expect(messages(withBody('Test seam', 'There are no tests for this.'))).toEqual([why]);
    expect(messages(withBody('Test seam', 'There is no test seam; the repro goes through main.'))).toEqual([]);
    expect(messages(withBody('Test seam', 'The skipper module is the seam.'))).toEqual([]);
  });

  it('refuses an empty test seam section', () => {
    expect(messages(withBody('Test seam', ''))).toEqual(['section "## Test seam" is empty: name the seam the reproduction goes through, or state that there is no good one']);
  });

  it('needs a measured baseline first for a performance bug', () => {
    expect(messages(PERF_PLAN, PERF_TICKET)).toEqual([]);
    expect(messages(BUG_PLAN, PERF_TICKET)).toEqual(['missing section "## Baseline" (the ticket is a bug)']);
    expect(messages(PERF_PLAN.replace('840 ms at the median of 20 loads', 'slow'), PERF_TICKET)).toEqual(['the baseline names no measured number']);
    expect(messages(BUG_PLAN, BUG_TICKET.replace('Category: bug\n', 'Category: bug, Performance\n'))).toEqual(['missing section "## Baseline" (the ticket is a bug)']);
    expect(messages(BUG_PLAN, `${BUG_TICKET}\nIt is a performance problem.\n`)).toEqual([]);
  });

  it.each([
    ['ghp_abcdefghij12', 'a token'],
    ['github_pat_abcdefghij12', 'a token'],
    ['sk-ant-api03-abcd', 'a token'],
    // Slack-shaped strings are built, so the Blueprint A export's own secret scan passes this file.
    [`${SLACK}b-123456789012`, 'a token'],
    [`${SLACK}p-123456789012`, 'a token'],
    ['AKIAabcdefghij12', 'a token'],
    ['Bearer eyJhbGciOi.J9', 'a bearer token'],
    ['Bearer abc~+/-_.12345', 'a bearer token'],
    ['password=hunter', 'a credential'],
    ['passwd: hunter', 'a credential'],
    ['secret=hunter', 'a credential'],
    ['token:  hunter', 'a credential'],
    ['api_key=hunter', 'a credential'],
    ['apikey=hunter', 'a credential'],
    ['PASSWORD=hunter', 'a credential'],
  ])('refuses %s in a bug plan as %s: secrets are redacted', (secret, kind) => {
    const plan = BUG_PLAN.replace('## Test seam\n', `## Test seam\nThe log says ${secret} here.\n`);
    const line = plan.split('\n').findIndex((l) => l.includes(secret)) + 1;
    expect(messages(plan)).toEqual([`line ${line}: ${kind} in the plan; redact it as [REDACTED]`]);
  });

  it.each([
    'ghp_abcdefghij1',
    `${SLACK}a-123456789012`,
    'Bearer abcdefghij1',
    'Bearer  abcdefghij12',
    'password=[REDACTED]',
    'password=hunte',
    'password hunter22',
    'the token: abc',
    'mysk-abcdefghijkl',
  ])('lets %s through', (text) => {
    expect(messages(BUG_PLAN.replace('## Test seam\n', `## Test seam\nThe log says ${text} here.\n`))).toEqual([]);
  });

  it('names every line with a secret', () => {
    const plan = BUG_PLAN.replace('## Test seam\n', '## Test seam\npassword=hunter22\nfine\nBearer abcdefghij12\n');
    const at = plan.split('\n').indexOf('password=hunter22') + 1;
    expect(messages(plan)).toEqual([`line ${at}: a credential in the plan; redact it as [REDACTED]`, `line ${at + 2}: a bearer token in the plan; redact it as [REDACTED]`]);
  });

  it('leaves secrets in a plan whose ticket is not a bug to the other checks', () => {
    expect(messages(`${GOOD_PLAN}password=hunter22\n`, GOOD_TICKET)).toEqual([]);
  });
});

describe('bugPromptLines', () => {
  it('tells the planner of a bug ticket to write the bug sections, and says nothing for other tickets', () => {
    expect(bugPromptLines(GOOD_TICKET)).toEqual([]);
    expect(bugPromptLines(BUG_TICKET)).toEqual([
      '',
      'This ticket is a bug (its Category line): write the bug plan of your skill. Before "## Behavior list" add "## Reproduction", "## Hypotheses" and "## Test seam"; behaviour 1 is the reproduction test.',
    ]);
    expect(bugPromptLines(PERF_TICKET)).toEqual([
      '',
      'This ticket is a bug (its Category line): write the bug plan of your skill. Before "## Behavior list" add "## Reproduction", "## Hypotheses" and "## Test seam"; behaviour 1 is the reproduction test.',
      'It is a performance bug: add "## Baseline" first, with the number you measure before any change.',
    ]);
  });
});
