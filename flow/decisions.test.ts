import { describe, expect, it } from 'vitest';
import { fileDecisionStore, parseDecisions, type Decision } from './decisions.ts';

const ok: Decision = { itemId: 'plan/sample/03-plan-me.md', decision: 'accept', note: '', decidedAt: '2026-10-04T20:00:00.000Z' };

describe('parseDecisions', () => {
  it('reads nothing, with no problem, when there is no decisions file', () => {
    expect(parseDecisions(undefined)).toEqual({ decisions: [], problems: [] });
  });

  it('reads well-formed decisions, a missing note as empty and a lesson destination as given', () => {
    const lesson = { itemId: 'lesson/l1.json', decision: 'reject', note: 'too broad', destination: 'gate', decidedAt: '2026-10-04T20:01:00Z' };
    const { note: _, ...noNote } = ok;
    const others = (['skill', 'directive'] as const).map((destination) => ({ ...lesson, itemId: `lesson/${destination}.json`, destination }));
    expect(parseDecisions(JSON.stringify([noNote, lesson, ...others]))).toEqual({ decisions: [ok, lesson, ...others], problems: [] });
  });

  it('fails closed on a file that is not JSON or not a list: no decisions, one problem', () => {
    expect(parseDecisions('{nope')).toEqual({ decisions: [], problems: [expect.stringMatching(/^The decisions file is not valid JSON: /)] });
    expect(parseDecisions('{"itemId":"x"}')).toEqual({ decisions: [], problems: ['The decisions file is not a list of decisions; nothing in it was applied.'] });
  });

  it('ignores each malformed decision and says which and why, keeping the good ones', () => {
    const bad = [
      null,
      'accept',
      { ...ok, itemId: ['lesson/a'] },
      { ...ok, itemId: 7 },
      { ...ok, itemId: 'plan/../secrets' },
      { ...ok, itemId: 'other/x.md' },
      { ...ok, decision: 'maybe' },
      { ...ok, note: 3 },
      { ...ok, destination: 'everywhere' },
      { ...ok, decidedAt: 'yesterday' },
      { ...ok, decidedAt: 5 },
      { ...ok, planHash: 'abc' },
      { ...ok, planHash: 'A'.repeat(64) },
      { ...ok, planHash: 7 },
      { ...ok, planHash: `${'a'.repeat(64)}\n` },
      { ...ok, planHash: `x${'a'.repeat(64)}` },
      { ...ok, planHash: ['a'.repeat(64)] },
    ];
    const { decisions, problems } = parseDecisions(JSON.stringify([...bad, { ...ok, itemId: 'proposal/p.json' }, { ...ok, itemId: 'idea/feedback-1.json' }, { ...ok, itemId: 'improvement/r3-1.json' }, { ...ok, itemId: 'suppressed/app/02/src-a-ts-3-ConditionalExpression' }, { ...ok, itemId: 'merge/app-12.json' }]));
    expect(decisions).toEqual([{ ...ok, itemId: 'proposal/p.json' }, { ...ok, itemId: 'idea/feedback-1.json' }, { ...ok, itemId: 'improvement/r3-1.json' }, { ...ok, itemId: 'suppressed/app/02/src-a-ts-3-ConditionalExpression' }, { ...ok, itemId: 'merge/app-12.json' }]);
    expect(problems).toEqual([
      'Decision 1 (no item id) was ignored: it is not an object.',
      'Decision 2 (no item id) was ignored: it is not an object.',
      'Decision 3 (no item id) was ignored: the item id is not a plan/, lesson/, proposal/, idea/, improvement/, discovery/, built/, suppressed/ or merge/ path.',
      'Decision 4 (no item id) was ignored: the item id is not a plan/, lesson/, proposal/, idea/, improvement/, discovery/, built/, suppressed/ or merge/ path.',
      'Decision 5 ("plan/../secrets") was ignored: the item id is not a plan/, lesson/, proposal/, idea/, improvement/, discovery/, built/, suppressed/ or merge/ path.',
      'Decision 6 ("other/x.md") was ignored: the item id is not a plan/, lesson/, proposal/, idea/, improvement/, discovery/, built/, suppressed/ or merge/ path.',
      'Decision 7 ("plan/sample/03-plan-me.md") was ignored: the decision is not accept or reject.',
      'Decision 8 ("plan/sample/03-plan-me.md") was ignored: the note is not text.',
      'Decision 9 ("plan/sample/03-plan-me.md") was ignored: the destination is not directive, skill or gate.',
      'Decision 10 ("plan/sample/03-plan-me.md") was ignored: decidedAt is not a date.',
      'Decision 11 ("plan/sample/03-plan-me.md") was ignored: decidedAt is not a date.',
      'Decision 12 ("plan/sample/03-plan-me.md") was ignored: the plan hash is not a sha256 hex digest.',
      'Decision 13 ("plan/sample/03-plan-me.md") was ignored: the plan hash is not a sha256 hex digest.',
      'Decision 14 ("plan/sample/03-plan-me.md") was ignored: the plan hash is not a sha256 hex digest.',
      'Decision 15 ("plan/sample/03-plan-me.md") was ignored: the plan hash is not a sha256 hex digest.',
      'Decision 16 ("plan/sample/03-plan-me.md") was ignored: the plan hash is not a sha256 hex digest.',
      'Decision 17 ("plan/sample/03-plan-me.md") was ignored: the plan hash is not a sha256 hex digest.',
    ]);
  });

  it('accepts ids with one or more path segments and refuses an empty or dotted first segment', () => {
    const ids = ['lesson/a', 'plan/p/x.md', 'proposal/-x', 'lesson/', 'lesson/.hidden', 'lessonx/a', ' lesson/a', 'lesson/a b'];
    const { decisions } = parseDecisions(JSON.stringify(ids.map((itemId) => ({ ...ok, itemId }))));
    expect(decisions.map((d) => d.itemId)).toEqual(['lesson/a', 'plan/p/x.md', 'proposal/-x']);
  });

  it('ignores every decision on an item decided twice in one file: which one was meant is not known', () => {
    const twice = [ok, { ...ok, decision: 'reject' }, { ...ok, itemId: 'lesson/l.json' }];
    expect(parseDecisions(JSON.stringify(twice))).toEqual({
      decisions: [{ ...ok, itemId: 'lesson/l.json' }],
      problems: ['plan/sample/03-plan-me.md was decided 2 times in one file; all of them were ignored. Decide it once on the page.'],
    });
  });
});

describe('parseDecisions: the plan hash an approval was given on', () => {
  it('keeps the hash of the plan the page showed', () => {
    const withHash = { ...ok, planHash: '0123456789abcdef'.repeat(4) };
    expect(parseDecisions(JSON.stringify([withHash]))).toEqual({ decisions: [withHash], problems: [] });
  });
});

describe('fileDecisionStore (state/decisions.json)', () => {
  it('reads the file through parseDecisions and writes the given decisions back as JSON', () => {
    const files = new Map<string, string>([['d.json', JSON.stringify([ok])]]);
    const store = fileDecisionStore('d.json', { read: (p) => files.get(p), write: (p, t) => files.set(p, t) });
    expect(store.read()).toEqual({ decisions: [ok], problems: [] });
    store.write([]);
    expect(files.get('d.json')).toBe('[]\n');
    store.write([ok]);
    expect(files.get('d.json')).toBe(`${JSON.stringify([ok], null, 2)}\n`);
  });
});
