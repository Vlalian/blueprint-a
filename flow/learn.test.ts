import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lessonOfFile, learnNote, learnPrompt, parseLessons, runLearn, type LearnIo, type Lesson } from './learn.ts';
import { parseObservations, type Observation } from '../runner/observations.ts';

const ROOT = resolve(import.meta.dirname, '..');
const FIXTURE = readFileSync(join(ROOT, 'test', 'fixtures', 'observations', 'run.jsonl'), 'utf8');

const lesson: Lesson = {
  project: 'sample',
  seen: { summary: 'Tests fail first on tab characters.', count: 3, examples: ['FAIL src/count.test.ts > counts tabs', 'FAIL src/split.test.ts > splits on tabs'] },
  change: 'Treat tabs as whitespace everywhere text is split; say so in each plan.',
  destination: 'directive',
};
const ONE = JSON.stringify({ lessons: [lesson] });

function memory(over: Partial<LearnIo> = {}, log: string | undefined = FIXTURE, cursor?: string) {
  const filed: [string, unknown][] = [];
  const prompts: string[] = [];
  let written: string | undefined;
  const io: LearnIo = {
    observations: () => log,
    cursor: () => cursor,
    writeCursor: (text) => void (written = text),
    skill: () => 'SKILL',
    analyse: (prompt) => (prompts.push(prompt), ONE),
    fileLesson: (id, text) => void filed.push([id, JSON.parse(text)]),
    ...over,
  };
  return { io, filed, prompts, cursor: () => written };
}

describe('Pass when: a fixture observation log gives one lesson', () => {
  it('makes one model call over the new observations and files the one lesson it returns as a waiting tier-2 item', () => {
    const w = memory();
    expect(runLearn('r1', w.io)).toEqual({ status: 'learned', observations: 14, lessons: ['lesson/r1-1.json'] });
    expect(w.prompts).toHaveLength(1);
    expect(w.filed).toEqual([
      [
        'lesson/r1-1.json',
        {
          project: 'sample',
          seen: 'Tests fail first on tab characters. Seen 3 times, for example: FAIL src/count.test.ts > counts tabs; FAIL src/split.test.ts > splits on tabs.',
          change: lesson.change,
          destination: 'directive',
          count: 3,
          examples: lesson.seen.examples,
          run: 'r1',
        },
      ],
    ]);
    expect(JSON.parse(w.cursor()!)).toEqual({ records: 14, run: 'r1' });
  });
});

describe('runLearn: once per run, only over what is new', () => {
  it('reads only the records after the cursor', () => {
    const w = memory({}, FIXTURE, JSON.stringify({ records: 12 }));
    expect(runLearn('r2', w.io)).toMatchObject({ status: 'learned', observations: 2 });
    expect(w.prompts[0]).toContain('2 new records');
    expect(JSON.parse(w.cursor()!)).toEqual({ records: 14, run: 'r2' });
  });

  it('makes no model call when nothing is new, and leaves the cursor alone', () => {
    // A default parameter would turn an undefined log back into the fixture, so it goes in as an override.
    for (const [log, cursor] of [[undefined, undefined], ['', undefined], [FIXTURE, JSON.stringify({ records: 14 })]] as const) {
      const w = memory({ observations: () => log }, FIXTURE, cursor);
      expect(runLearn('r2', w.io)).toEqual({ status: 'nothing-new' });
      expect([w.prompts, w.filed, w.cursor()]).toEqual([[], [], undefined]);
    }
  });

  it("leaves out the function ledger's session, hook and stream records: on their own they are nothing new", () => {
    const at = '2026-10-04T10:00:00.000Z';
    const base = { at, run: 'r3', project: 'sample', ticket: 't', role: 'coder' };
    const ledger = [
      { ...base, kind: 'session', fn: 'role:coder', model: 'm', tokensIn: 1, tokensOut: 1, cacheRead: 0, cacheWrite: 0, ms: 1, outcome: 'ok', skills: [] },
      { ...base, kind: 'hook', hook: 'observe', ms: 5, outcome: 'allow' },
      { ...base, kind: 'stream', stream: 'a/b', items: 1, ideas: 0 },
    ].map((r) => JSON.stringify(r));
    const quiet = memory({}, [FIXTURE.trimEnd(), ...ledger].join('\n'), JSON.stringify({ records: 14 }));
    expect(runLearn('r3', quiet.io)).toEqual({ status: 'nothing-new' });
    const busy = memory({}, [FIXTURE.trimEnd(), ...ledger].join('\n'), JSON.stringify({ records: 12 }));
    expect(runLearn('r3', busy.io)).toMatchObject({ status: 'learned', observations: 2 });
    expect(busy.prompts[0]).not.toContain('"kind":"hook"');
    expect(JSON.parse(busy.cursor()!)).toEqual({ records: 17, run: 'r3' });
  });

  it("leaves out a session's denial records (ticket 52): they come with its result, for the improver's session facts", () => {
    const denial = JSON.stringify({ at: '2026-10-04T10:00:00.000Z', run: 'r3', project: 'sample', ticket: 't', role: 'coder', kind: 'denial', tool: 'Bash', target: 'git push' });
    const quiet = memory({}, [FIXTURE.trimEnd(), denial].join('\n'), JSON.stringify({ records: 14 }));
    expect(runLearn('r3', quiet.io)).toEqual({ status: 'nothing-new' });
  });

  it('leaves out plan approval records (tickets 33, 43): they are for the evaluation, so on their own they are nothing new', () => {
    const approval = JSON.stringify({ at: '2026-10-04T10:00:00.000Z', run: 'r3', project: 'sample', ticket: '03', role: 'controller', kind: 'approval', item: 'plan/sample/03.md', approval: 'owner', reason: 'r' });
    expect(runLearn('r3', memory({}, [FIXTURE.trimEnd(), approval].join('\n'), JSON.stringify({ records: 14 })).io)).toEqual({ status: 'nothing-new' });
  });

  it('starts over when the cursor is past the end of the log (a new log) or cannot be read', () => {
    for (const cursor of [JSON.stringify({ records: 99 }), '{nope', JSON.stringify({ records: -1 }), JSON.stringify({ records: 1.5 }), JSON.stringify({}), 'null']) {
      expect(runLearn('r2', memory({}, FIXTURE, cursor).io)).toMatchObject({ observations: 14 });
    }
  });

  it('files every lesson under its own id and records a skill when one is named', () => {
    const two = { lessons: [lesson, { ...lesson, project: '', destination: 'skill', skill: 'coder' }] };
    const w = memory({ analyse: () => JSON.stringify(two) });
    expect(runLearn('r1', w.io)).toMatchObject({ lessons: ['lesson/r1-1.json', 'lesson/r1-2.json'] });
    expect(w.filed[1]![1]).toMatchObject({ project: '', destination: 'skill', skill: 'coder' });
    expect(w.filed[0]![1]).not.toHaveProperty('skill');
  });

  it('advances the cursor when the model found no lesson', () => {
    const w = memory({ analyse: () => '{"lessons":[]}' });
    expect(runLearn('r1', w.io)).toEqual({ status: 'learned', observations: 14, lessons: [] });
    expect(w.cursor()).toBeDefined();
  });

  it('fails closed on malformed output: no lessons, reported, and the observations stay new for the next run', () => {
    const w = memory({ analyse: () => 'I think you should use tabs.' });
    expect(runLearn('r1', w.io)).toEqual({ status: 'failed', observations: 14, problem: "the model's answer was malformed (it holds no JSON object)" });
    expect([w.filed, w.cursor()]).toEqual([[], undefined]);
  });

  it('reports a model call that failed the same way', () => {
    const w = memory({
      analyse: () => {
        throw new Error('claude -p failed: usage limit');
      },
    });
    expect(runLearn('r1', w.io)).toEqual({ status: 'failed', observations: 14, problem: 'the model call failed (claude -p failed: usage limit)' });
    expect([w.filed, w.cursor()]).toEqual([[], undefined]);
  });
});

describe('parseLessons: the schema the model must meet', () => {
  it('accepts lessons, inside a code fence or prose too', () => {
    expect(parseLessons(ONE)).toEqual({ lessons: [lesson] });
    expect(parseLessons(`Here they are:\n\`\`\`json\n${ONE}\n\`\`\`\nDone.`)).toEqual({ lessons: [lesson] });
    expect(parseLessons('{"lessons":[]}')).toEqual({ lessons: [] });
  });

  const bad = (over: Record<string, unknown>) => JSON.stringify({ lessons: [{ ...lesson, ...over }] });
  const seen = (over: Record<string, unknown>) => bad({ seen: { ...lesson.seen, ...over } });

  it.each([
    ['', 'it holds no JSON object'],
    ['{', 'it holds no JSON object'],
    ['}', 'it holds no JSON object'],
    ['}{', 'it is not valid JSON'],
    ['{nope}', 'it is not valid JSON'],
    ['{"lesson":[]}', 'lessons is not a list'],
    [JSON.stringify({ lessons: Array(6).fill(lesson) }), 'more than 5 lessons'],
    [JSON.stringify({ lessons: [3] }), 'lesson 1: it is not an object'],
    [JSON.stringify({ lessons: [null] }), 'lesson 1: it is not an object'],
    [bad({ project: 3 }), 'lesson 1: the project is not a project name or empty'],
    [bad({ project: '../x' }), 'lesson 1: the project is not a project name or empty'],
    [bad({ project: 'a b' }), 'lesson 1: the project is not a project name or empty'],
    [bad({ seen: 'x' }), 'lesson 1: seen is not an object'],
    [bad({ seen: null }), 'lesson 1: seen is not an object'],
    [seen({ summary: ' ' }), 'lesson 1: seen.summary is empty or not text'],
    [seen({ summary: 1 }), 'lesson 1: seen.summary is empty or not text'],
    [seen({ count: 0 }), 'lesson 1: seen.count is not a whole number of at least 1'],
    [seen({ count: 1.5 }), 'lesson 1: seen.count is not a whole number of at least 1'],
    [seen({ count: '3' }), 'lesson 1: seen.count is not a whole number of at least 1'],
    [seen({ examples: [] }), 'lesson 1: seen.examples is not 1 to 5 examples as text'],
    [seen({ examples: 'a' }), 'lesson 1: seen.examples is not 1 to 5 examples as text'],
    [seen({ examples: Array(6).fill('a') }), 'lesson 1: seen.examples is not 1 to 5 examples as text'],
    [seen({ examples: ['a', ' '] }), 'lesson 1: seen.examples is not 1 to 5 examples as text'],
    [seen({ examples: ['a', 2] }), 'lesson 1: seen.examples is not 1 to 5 examples as text'],
    [bad({ change: '' }), 'lesson 1: change is empty or not text'],
    [bad({ change: ['x'] }), 'lesson 1: change is empty or not text'],
    [bad({ destination: 'adr' }), 'lesson 1: the destination is not directive, skill or gate'],
    [bad({ project: '' }), 'lesson 1: a project directive needs its project'],
    [bad({ skill: 'Coder' }), 'lesson 1: the skill is not a skill name'],
    [bad({ skill: 'coder!' }), 'lesson 1: the skill is not a skill name'],
    [bad({ skill: '' }), 'lesson 1: the skill is not a skill name'],
    [bad({ skill: 3 }), 'lesson 1: the skill is not a skill name'],
    [bad({ skill: ['coder'] }), 'lesson 1: the skill is not a skill name'],
  ])('rejects %s: %s', (text, problem) => {
    expect(parseLessons(text)).toEqual({ problem });
  });

  it('rejects everything when one lesson of several is malformed, naming it', () => {
    expect(parseLessons(JSON.stringify({ lessons: [lesson, { ...lesson, change: '' }] }))).toEqual({ problem: 'lesson 2: change is empty or not text' });
  });

  it('accepts exactly 5 lessons and 5 examples, a project-wide lesson for a skill or gate, and a named skill', () => {
    expect(parseLessons(JSON.stringify({ lessons: Array(5).fill(lesson) }))).toMatchObject({ lessons: Array(5).fill(lesson) });
    const wide = { ...lesson, project: '', destination: 'gate', skill: 'no-ai-slop', seen: { ...lesson.seen, count: 1, examples: Array(5).fill('e') } };
    expect(parseLessons(JSON.stringify({ lessons: [wide] }))).toEqual({ lessons: [wide] });
    const single = { ...lesson, seen: { ...lesson.seen, examples: ['only one'] } };
    expect(parseLessons(JSON.stringify({ lessons: [single] }))).toEqual({ lessons: [single] });
  });
});

describe('learnPrompt', () => {
  it('is the skill, then the new observations: tool calls counted, failed calls listed, every other record whole', () => {
    const records = parseObservations(FIXTURE);
    const others = records.filter((r) => r.kind !== 'tool').map((r) => JSON.stringify(r));
    expect(learnPrompt('SKILL', records)).toBe(
      [
        'SKILL',
        '',
        '## Observations',
        '',
        '14 new records.',
        '',
        '### Tool calls by role, tool and result',
        '',
        '- coder Edit ok: 3',
        '- coder Bash error: 1',
        '- coder Read ok: 1',
        '',
        '### Failed tool calls',
        '',
        '- coder sample-03-coder Bash: npm test',
        '',
        '### Run outcomes and choices',
        '',
        ...others,
        '',
      ].join('\n'),
    );
  });

  it('lists at most 20 failed calls and the newest 300 other records', () => {
    const at = '2026-10-04T20:00:00.000Z';
    const base = { at, run: 'r', project: 'p', ticket: 't', role: 'coder' };
    const failed = Array.from({ length: 25 }, (_, i): Observation => ({ ...base, kind: 'tool', tool: 'Bash', target: `c${i}`, result: 'error' }));
    const retries = Array.from({ length: 305 }, (_, i): Observation => ({ ...base, kind: 'retry', reason: `r${i}` }));
    const prompt = learnPrompt('S', [...failed, ...retries]);
    expect(prompt).toContain('- coder t Bash: c19\n');
    expect(prompt).not.toContain('- coder t Bash: c20\n');
    expect(prompt).toContain('"reason":"r5"');
    expect(prompt).not.toContain('"reason":"r4"');
    expect(prompt).toContain('- coder Bash error: 25\n');
  });

  it('says so when there were no tool calls or no other records', () => {
    expect(learnPrompt('S', [])).toBe(['S', '', '## Observations', '', '0 new records.', '', '### Tool calls by role, tool and result', '', 'None.', '', '### Failed tool calls', '', 'None.', '', '### Run outcomes and choices', '', 'None.', ''].join('\n'));
  });

  it('orders tool counts by count, then by name', () => {
    const base = { at: 'a', run: 'r', project: 'p', ticket: 't', role: 'coder' };
    const tool = (name: string): Observation => ({ ...base, kind: 'tool', tool: name, target: '', result: 'ok' });
    const prompt = learnPrompt('S', [tool('Read'), tool('Glob'), tool('Read'), tool('Edit')]);
    expect(prompt).toContain('- coder Read ok: 2\n- coder Edit ok: 1\n- coder Glob ok: 1\n');
  });
});

describe('lessonOfFile', () => {
  it('says "time" once and "times" otherwise', () => {
    const once = { ...lesson, seen: { summary: 'S.', count: 1, examples: ['e'] } };
    expect(JSON.parse(lessonOfFile(once, 'r')).seen).toBe('S. Seen 1 time, for example: e.');
  });
});

describe('learnNote: what the run says about the learning loop', () => {
  it.each([
    [{ status: 'nothing-new' as const }, 'Learning loop: no new observations, so no analysis this run.'],
    [{ status: 'learned' as const, observations: 14, lessons: ['a', 'b'] }, 'Learning loop: 14 new observations analysed; 2 lessons wait for your approval.'],
    [{ status: 'learned' as const, observations: 1, lessons: ['a'] }, 'Learning loop: 1 new observation analysed; 1 lesson waits for your approval.'],
    [{ status: 'learned' as const, observations: 3, lessons: [] }, 'Learning loop: 3 new observations analysed; no lessons this time.'],
    [{ status: 'failed' as const, observations: 3, problem: 'p' }, 'Learning loop: no lessons this run, p. The 3 new observations are read again next run.'],
  ])('%j', (result, note) => {
    expect(learnNote(result)).toBe(note);
  });
});
