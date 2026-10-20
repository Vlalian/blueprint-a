// Decision 39: a plan may mark a claim as needing named non-test evidence (a saved screenshot or
// recording plus a schema-checked report) instead of a test. The linter accepts such a behaviour
// when it names both, and still asks every other behaviour for its test.
import { describe, expect, it } from 'vitest';
import { evidenceFindings, needsEvidence } from './evidence.ts';
import { evidenceTasks } from './evidence-tasks.ts';
import { GOOD_PLAN, GOOD_TICKET } from './fixtures.ts';
import { planGate } from './gate.ts';
import { lintPlan } from './lint.ts';

const MARKED = 'Evidence: non-test\nEvidence by: coder\nEvidence file: docs/evidence/01-slug-page.png\nEvidence report: docs/evidence/01-slug-page.json\n';
const NO_PRODUCER = 'behaviour 3 needs non-test evidence but names no producer: write "Evidence by: <role>", the build role that makes it (coder, cleaner or hardener)';

/** The good plan with behaviour 2's test block and failure line replaced by `body`. */
const withBehaviour2 = (body: string) =>
  GOOD_PLAN.replace(/(### 2\. Empty stays empty\n)[\s\S]*?(\n## Acceptance)/, `$1${body}$2`);

const messages = (plan: string) => lintPlan(plan).map((f) => f.message);

describe('needsEvidence', () => {
  it('reads the mark on a line of its own', () => {
    expect(needsEvidence(MARKED)).toBe(true);
    expect(needsEvidence('x\nEvidence: non-test  \ny')).toBe(true);
  });

  it('reads nothing else as the mark', () => {
    expect(needsEvidence('Evidence: non-test, maybe')).toBe(false);
    expect(needsEvidence('See: Evidence: non-test')).toBe(false);
    expect(needsEvidence('Evidence: a test')).toBe(false);
  });
});

describe('evidenceFindings', () => {
  it('accepts a behaviour that names a screenshot or recording and a JSON report', () => {
    expect(evidenceFindings({ n: 3, body: MARKED })).toEqual([]);
    expect(evidenceFindings({ n: 3, body: MARKED.replace('01-slug-page.png', '01-flow.webm') })).toEqual([]);
  });

  it('asks for the evidence file when it is missing or not a screenshot or recording', () => {
    const want = 'behaviour 3 needs non-test evidence but names no screenshot or recording: write "Evidence file: <path>" ending in .png, .jpg, .jpeg, .webp, .mp4, .webm, .mov or .gif';
    expect(evidenceFindings({ n: 3, body: MARKED.replace('Evidence file: docs/evidence/01-slug-page.png\n', '') }).map((f) => f.message)).toEqual([want]);
    expect(evidenceFindings({ n: 3, body: MARKED.replace('01-slug-page.png', '01-slug-page.txt') }).map((f) => f.message)).toEqual([want]);
    expect(evidenceFindings({ n: 3, body: MARKED.replace('docs/evidence/01-slug-page.png', '`docs/evidence/01-slug-page.png`') }).map((f) => f.message)).toEqual([want]);
    expect(evidenceFindings({ n: 3, body: MARKED.replace('docs/evidence/01-slug-page.png', 'docs/evidence/01-slug-page.png later') }).map((f) => f.message)).toEqual([want]);
  });

  it('asks for the JSON report when it is missing or not .json', () => {
    const want = 'behaviour 3 needs non-test evidence but names no report: write "Evidence report: <path>.json" (checked by gates/evidence)';
    expect(evidenceFindings({ n: 3, body: MARKED.replace('Evidence report: docs/evidence/01-slug-page.json\n', '') }).map((f) => f.message)).toEqual([want]);
    expect(evidenceFindings({ n: 3, body: MARKED.replace('01-slug-page.json', '01-slug-page.md') }).map((f) => f.message)).toEqual([want]);
    expect(evidenceFindings({ n: 3, body: MARKED.replace('Evidence report: docs', 'Evidence report: x docs') }).map((f) => f.message)).toEqual([want]);
  });

  it('accepts the lines in any order, with spaces after the path', () => {
    expect(evidenceFindings({ n: 3, body: 'Evidence: non-test\nEvidence report: a/b.json  \nEvidence file: a/b.png  \nShows the page.\nEvidence by: hardener  ' })).toEqual([]);
    expect(evidenceFindings({ n: 3, body: 'Evidence by: cleaner\nEvidence: non-test\nEvidence report: a/b.json\nEvidence file: a/b.png' })).toEqual([]);
  });

  it('needs the report path to end in .json', () => {
    expect(evidenceFindings({ n: 3, body: 'Evidence: non-test\nEvidence by: coder\nEvidence report: a/b.json.md\nEvidence file: a/b.png' })).toHaveLength(1);
  });

  it('reads each line only at the start of a line', () => {
    const body = 'Evidence: non-test\nSee Evidence file: a/b.png\nSee Evidence report: a/b.json\nSee Evidence by: coder\n';
    expect(evidenceFindings({ n: 1, body })).toHaveLength(3);
  });

  // Ticket 36: a non-test behaviour names who produces it, so that role's brief lists it.
  it('asks who produces the evidence when no build role is named', () => {
    const findings = (body: string) => evidenceFindings({ n: 3, body }).map((f) => f.message);
    expect(findings(MARKED.replace('Evidence by: coder\n', ''))).toEqual([NO_PRODUCER]);
    expect(findings(MARKED.replace('Evidence by: coder', 'Evidence by: the owner'))).toEqual([NO_PRODUCER]);
    expect(findings(MARKED.replace('Evidence by: coder', 'Evidence by: specifier'))).toEqual([NO_PRODUCER]);
    expect(findings(MARKED.replace('Evidence by: coder', 'Evidence by: coder later'))).toEqual([NO_PRODUCER]);
    expect(findings(MARKED.replace('Evidence by: coder', 'Evidence by: coders'))).toEqual([NO_PRODUCER]);
  });
});

describe('lintPlan with a behaviour marked for non-test evidence', () => {
  it('accepts it without a test block or a failure line', () => {
    expect(messages(withBehaviour2(MARKED))).toEqual([]);
  });

  it('reports what the marked behaviour is missing instead of a test', () => {
    expect(messages(withBehaviour2('Evidence: non-test\n'))).toEqual([
      'behaviour 2 needs non-test evidence but names no screenshot or recording: write "Evidence file: <path>" ending in .png, .jpg, .jpeg, .webp, .mp4, .webm, .mov or .gif',
      'behaviour 2 needs non-test evidence but names no report: write "Evidence report: <path>.json" (checked by gates/evidence)',
      NO_PRODUCER.replace('behaviour 3', 'behaviour 2'),
    ]);
  });

  it('still asks an unmarked behaviour for its test', () => {
    expect(messages(withBehaviour2('Evidence file: docs/evidence/01-slug-page.png\n'))).toEqual([
      'behaviour 2 has no ```ts test block',
      'behaviour 2 does not say how it fails before implementation',
    ]);
  });

  it('passes every plan gate: the evidence paths are not cited files, since the evidence comes after the build', () => {
    const plan = withBehaviour2(MARKED);
    const result = planGate({ plan: 'p.md', ticket: 't.md' }, { readPlan: () => plan, readTicket: () => GOOD_TICKET, exists: (p) => p === 'src/is-even.ts' });
    expect(result).toEqual({ gate: 'plan', pass: true, checks: { lint: [], 'cross-artifact': [], ears: [], commands: [], facts: [] } });
  });
});

describe('evidenceTasks', () => {
  const ticket = (plan: string) => `Status: planned\n# 01 Slugs\n\n## What\nSlugs.\n\n## Plan\n${plan}\n## Comments\n- 2026-10-05: approved\n`;

  it("lists each non-test behaviour of the ticket's plan with its producer and evidence paths", () => {
    expect(evidenceTasks(ticket(withBehaviour2(MARKED)))).toEqual([
      { n: 2, title: 'Empty stays empty', by: 'coder', file: 'docs/evidence/01-slug-page.png', report: 'docs/evidence/01-slug-page.json' },
    ]);
  });

  it('reads the producer and paths at the start of their lines, with spaces after them', () => {
    const body = 'Evidence: non-test\nEvidence by: hardener  \nEvidence report: a/b.json \nEvidence file: a/b.png\nSee Evidence by: coder\n';
    expect(evidenceTasks(ticket(withBehaviour2(body)))).toEqual([{ n: 2, title: 'Empty stays empty', by: 'hardener', file: 'a/b.png', report: 'a/b.json' }]);
  });

  it('gives what a behaviour leaves out as empty, and lists nothing for a plan with only tests, or a ticket without a plan', () => {
    expect(evidenceTasks(ticket(withBehaviour2('Evidence: non-test\n')))).toEqual([{ n: 2, title: 'Empty stays empty', by: '', file: '', report: '' }]);
    expect(evidenceTasks(ticket(GOOD_PLAN))).toEqual([]);
    expect(evidenceTasks('Status: planned\n# 01 Slugs\n')).toEqual([]);
  });
});
