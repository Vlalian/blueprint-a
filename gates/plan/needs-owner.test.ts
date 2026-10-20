import { describe, expect, it } from 'vitest';
import { GOOD_PLAN } from './fixtures.ts';
import { lintPlan } from './lint.ts';
import { needsOwnerFindings, needsOwnerItems } from './needs-owner.ts';

const withNeeds = (body: string) => GOOD_PLAN.replace("## Needs the owner's own eyes\nNone.\n", `## Needs the owner's own eyes\n${body}\n`);

const ASKED = [
  '- Should slugs keep accented letters?',
  '  Recommended: no, ASCII only.',
  '  Why it matters: it fixes every URL the app will ever print.',
].join('\n');

describe('needsOwnerItems', () => {
  it('reads None. or nothing as no item', () => {
    expect(needsOwnerItems('None.\n\nRun `npm test`.')).toEqual([]);
    expect(needsOwnerItems('')).toEqual([]);
  });

  it('reads each list item with its indented lines', () => {
    const two = `${ASKED}\n* Which theme first?\n  Recommended: light.\n1. Ship on Friday?`;
    expect(needsOwnerItems(two)).toEqual([
      { question: 'Should slugs keep accented letters?', recommended: 'no, ASCII only.', why: 'it fixes every URL the app will ever print.' },
      { question: 'Which theme first?', recommended: 'light.', why: undefined },
      { question: 'Ship on Friday?', recommended: undefined, why: undefined },
    ]);
  });

  it('trims, starts an item only at a list mark at the start of a line, and counts past 9', () => {
    const body = '- First?  \n  Recommended: a - b  \n   \n  Why it matters: c\n10. Tenth?\n';
    expect(needsOwnerItems(body)).toEqual([
      { question: 'First?', recommended: 'a - b', why: 'c' },
      { question: 'Tenth?', recommended: undefined, why: undefined },
    ]);
    expect(needsOwnerItems('None. \n')).toEqual([]);
    expect(needsOwnerItems('   \n- Q?')).toEqual([{ question: 'Q?', recommended: undefined, why: undefined }]);
  });

  it('reads prose with no list as one item', () => {
    expect(needsOwnerItems('Pick the colour.\nRecommended: blue.\n')).toEqual([{ question: 'Pick the colour.', recommended: 'blue.', why: undefined }]);
  });

  it('skips a blank line and ignores text after the last field', () => {
    expect(needsOwnerItems('\n- Q?\n\n  Recommended: yes\n  Why it matters: money\n')).toEqual([{ question: 'Q?', recommended: 'yes', why: 'money' }]);
  });
});

describe('a Needs-the owner item without a recommendation (ticket 49)', () => {
  it('passes an item with a recommended answer and why it matters', () => {
    expect(lintPlan(withNeeds(ASKED))).toEqual([]);
  });

  it('refuses an item with no recommended answer', () => {
    const plan = withNeeds(ASKED.replace('  Recommended: no, ASCII only.\n', ''));
    expect(lintPlan(plan).map((f) => f.message)).toEqual([
      `"Needs the owner's own eyes" item 1 ("Should slugs keep accented letters?") has no "Recommended:" line: give the answer you would pick, so the owner can accept it in one word ("I don't know" is a valid reply)`,
    ]);
  });

  it('refuses an item with no line on why it matters', () => {
    const plan = withNeeds(ASKED.replace('\n  Why it matters: it fixes every URL the app will ever print.', ''));
    expect(lintPlan(plan).map((f) => f.message)).toEqual([
      `"Needs the owner's own eyes" item 1 ("Should slugs keep accented letters?") has no "Why it matters:" line: one line on what the answer changes`,
    ]);
  });

  it('refuses an empty recommendation and names each item by number', () => {
    const body = `${ASKED}\n- Second?\n  Recommended:\n  Why it matters: cost`;
    expect(needsOwnerFindings(body).map((f) => f.message)).toEqual([
      `"Needs the owner's own eyes" item 2 ("Second?") has no "Recommended:" line: give the answer you would pick, so the owner can accept it in one word ("I don't know" is a valid reply)`,
    ]);
  });

  it('adds nothing when the plan has no such section', () => {
    expect(lintPlan(GOOD_PLAN.replace("## Needs the owner's own eyes\nNone.\n", '')).map((f) => f.message)).toEqual([`missing section "## Needs the owner's own eyes"`]);
  });

  it('passes None.', () => {
    expect(needsOwnerFindings('None.')).toEqual([]);
  });
});
