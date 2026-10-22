import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { memFs, ROOT } from '../test/helpers/flow-fakes.ts';
import { DEFAULTS } from './config.ts';
import { applyAccepted, approvalIdOf, flowApplyLessons, lessonBlock, type LessonsIo } from './lessons.ts';

const AT = '2026-10-21T09:00:00.000Z';
const c = { ...DEFAULTS, decisions: 'state/decisions.json', pendingFolder: 'state/approvals/pending', directivesFile: 'docs/rules.md', skillsFolder: 'agents/skills' };
const DECISIONS = join(ROOT, 'state', 'decisions.json');
const RULES = join(ROOT, 'docs', 'rules.md');
const pending = (id: string) => join(ROOT, 'state', 'approvals', 'pending', 'lesson', id);
const lesson = (o: object = {}) => JSON.stringify({ project: 'web', seen: 'Seen 2 times.', change: 'Run the linter before handover.', destination: 'directive', ...o });
const accept = (id: string, o: object = {}) => ({ itemId: `lesson/${id}`, decision: 'accept', note: '', decidedAt: AT, ...o });

function world(decisions: object[] | string, files: Record<string, string> = {}) {
  const fs = memFs({ [DECISIONS]: typeof decisions === 'string' ? decisions : JSON.stringify(decisions), ...files });
  const said: string[] = [];
  const io: LessonsIo = { root: ROOT, read: fs.read, write: fs.write, out: (t) => void said.push(t) };
  return { io, fs, said: () => said.join('') };
}

describe('flow apply-lessons', () => {
  it("writes an accepted directive lesson into the configured directives file, with its approval, and only once", () => {
    const w = world([accept('r1-1.json', { note: ' keep\nit short ' })], { [pending('r1-1.json')]: lesson() });
    expect(applyAccepted(c, w.io)).toEqual({ applied: [{ item: 'lesson/r1-1.json', approval: `lesson/r1-1.json@${AT}`, path: RULES }], problems: [] });
    const once = w.fs.read(RULES);
    expect(once).toBe(
      `# Directives\n\n## Lesson lesson/r1-1.json\n\nRun the linter before handover.\n\n- Seen: Seen 2 times.\n- Your note: keep it short\n- Approval: lesson/r1-1.json@${AT} (accepted in state/decisions.json, applied by flow apply-lessons)\n`,
    );
    applyAccepted(c, w.io);
    expect(w.fs.read(RULES)).toBe(once);
  });

  it('appends to a directives file that exists', () => {
    const w = world([accept('r1-1.json')], { [pending('r1-1.json')]: lesson(), [RULES]: '# Rules\n' });
    applyAccepted(c, w.io);
    expect(w.fs.read(RULES)).toMatch(/^# Rules\n\n## Lesson lesson\/r1-1\.json\n/);
  });

  it("takes the owner's destination over the suggested one: a skill's rule, or a gate's ticket draft", () => {
    const skill = join(ROOT, 'agents', 'skills', 'reviewer', 'SKILL.md');
    const coder = join(ROOT, 'agents', 'skills', 'coder', 'SKILL.md');
    const draft = join(ROOT, 'state', 'flow', 'lessons', 'gate', 'lesson-r1.json-3.md');
    const w = world([accept('r1-1.json', { destination: 'skill' }), accept('r1-2.json', { destination: 'skill' }), accept('r1.json-3.json', { destination: 'gate' })], {
      [pending('r1-1.json')]: lesson({ skill: 'reviewer' }),
      [pending('r1-2.json')]: lesson(),
      [pending('r1.json-3.json')]: lesson({ project: undefined }),
      [skill]: '# Reviewer\n',
      [coder]: '# Coder\n',
    });
    expect(applyAccepted(c, w.io).applied.map((a) => a.path)).toEqual([skill, coder, draft]);
    expect(w.fs.read(skill)).toMatch(/^# Reviewer\n\n## Lesson lesson\/r1-1\.json\n/);
    expect(w.fs.read(coder)).toMatch(/^# Coder\n\n## Lesson lesson\/r1-2\.json\n/);
    expect(w.fs.read(draft)).toMatch(/^# Code gate: Run the linter before handover\.\n\nStatus: needs-ticket\nFor: every project\n\n## Lesson lesson\/r1\.json-3\.json\n/);
    expect(w.fs.read(RULES)).toBeUndefined();
  });

  it('names the project a gate draft is for', () => {
    const w = world([accept('r1-1.json', { destination: 'gate' })], { [pending('r1-1.json')]: lesson() });
    applyAccepted(c, w.io);
    expect(w.fs.read(join(ROOT, 'state', 'flow', 'lessons', 'gate', 'lesson-r1-1.md'))).toContain('\nFor: web\n');
  });

  it('applies nothing rejected and nothing that is not a lesson', () => {
    const w = world([accept('r1-1.json', { decision: 'reject' }), { itemId: 'plan/web/1.md', decision: 'accept', note: '', decidedAt: AT }], { [pending('r1-1.json')]: lesson() });
    expect(applyAccepted(c, w.io)).toEqual({ applied: [], problems: [] });
    expect(w.fs.writes).toEqual([]);
  });

  it('refuses, writing nothing for it, a lesson it cannot check: not waiting, broken, without a destination, or a skill that is not there', () => {
    const odd = (name: string) => [accept(name, { destination: 'skill' }), pending(name)] as const;
    const w = world([accept('gone.json'), accept('bad.json'), accept('null.json'), accept('word.json'), accept('text.json'), accept('seen.json'), accept('nowhere.json'), accept('skill.json', { destination: 'skill' }), accept('odd.json', { destination: 'skill' }), odd('nested.json')[0]], {
      [pending('bad.json')]: '{',
      [pending('null.json')]: 'null',
      [pending('word.json')]: '"word"',
      [pending('text.json')]: lesson({ change: 3 }),
      [pending('seen.json')]: lesson({ seen: 3 }),
      [odd('nested.json')[1]]: lesson({ skill: 'a/b' }),
      [join(ROOT, 'agents', 'skills', 'a', 'b', 'SKILL.md')]: '# Nested\n',
      [pending('nowhere.json')]: lesson({ destination: 'wiki' }),
      [pending('skill.json')]: lesson({ skill: 'tester' }),
      [pending('odd.json')]: lesson({ skill: '../x' }),
    });
    expect(applyAccepted(c, w.io)).toEqual({
      applied: [],
      problems: [
        'Lesson lesson/gone.json was not applied: it is not waiting in state/approvals/pending.',
        'Lesson lesson/bad.json was not applied: it is not a JSON object.',
        'Lesson lesson/null.json was not applied: it is not a JSON object.',
        'Lesson lesson/word.json was not applied: it is not a JSON object.',
        'Lesson lesson/text.json was not applied: it has no change or seen as text.',
        'Lesson lesson/seen.json was not applied: it has no change or seen as text.',
        'Lesson lesson/nowhere.json was not applied: it names no destination of directive, skill or gate.',
        'Lesson lesson/skill.json was not applied: skill "tester" is not a skill in agents/skills.',
        'Lesson lesson/odd.json was not applied: skill "../x" is not a skill in agents/skills.',
        'Lesson lesson/nested.json was not applied: skill "a/b" is not a skill in agents/skills.',
      ],
    });
    expect(w.fs.writes).toEqual([]);
  });

  it("reports the decisions file's own problems", () => {
    expect(applyAccepted(c, world('[1]').io).problems).toEqual(['Decision 1 (no item id) was ignored: it is not an object.']);
    expect(applyAccepted(c, { ...world([]).io, read: () => undefined })).toEqual({ applied: [], problems: [] });
  });

  it('prints what it applied and refused as JSON, exiting 1 when it refused one and 2 for an argument', () => {
    const good = world([accept('r1-1.json')], { [pending('r1-1.json')]: lesson() });
    expect(flowApplyLessons([], c, good.io)).toBe(0);
    expect(JSON.parse(good.said())).toEqual({ applied: [{ item: 'lesson/r1-1.json', approval: `lesson/r1-1.json@${AT}`, path: RULES }], problems: [] });
    const bad = world([accept('gone.json')]);
    expect(flowApplyLessons([], c, bad.io)).toBe(1);
    expect(JSON.parse(bad.said()).problems).toHaveLength(1);
    const arg = world([]);
    expect(flowApplyLessons(['--x'], c, arg.io)).toBe(2);
    expect(arg.said()).toBe('usage: flow apply-lessons\n');
  });
});

describe('a lesson block', () => {
  it('carries the approval id, the item and the moment the owner accepted it, and says how it got there', () => {
    expect(approvalIdOf({ itemId: 'lesson/x.json', decidedAt: AT })).toBe(`lesson/x.json@${AT}`);
    expect(lessonBlock({ itemId: 'lesson/x.json', decidedAt: AT, note: '' }, { change: 'Do it.', seen: 'Once.' }, 'by hand')).toBe(`\n## Lesson lesson/x.json\n\nDo it.\n\n- Seen: Once.\n- Approval: lesson/x.json@${AT} (by hand)\n`);
  });
});
