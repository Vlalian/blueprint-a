// The learning loop's analysis (blueprint-b section 8), once per run: one model call reads the
// observations logged since the last analysis (but the function ledger's session, hook and stream
// records, which are cost data) (skills/learn/SKILL.md says what to look for) and
// returns lessons, each with what was seen (a count and examples), the proposed change and a
// suggested destination. The answer is checked against a schema and fails closed: anything
// malformed gives no lessons, is reported, and leaves the observations new for the next run. Each
// lesson is filed as a waiting tier-2 item (state/approvals/pending/lesson/<run>-<n>.json); nothing
// applies until the owner accepts it on the briefing and apply-lesson writes it.

import { DESTINATIONS, type Destination } from './decisions.ts';
import { parseObservations, type Observation } from '../runner/observations.ts';

export interface Lesson {
  /** Empty for a lesson about every project. */
  project: string;
  seen: { summary: string; count: number; examples: string[] };
  change: string;
  destination: Destination;
  /** For a workflow rule: the skill it goes in (apply-lesson uses the coder's when none is named). */
  skill?: string;
}

export interface LearnIo {
  /** state/logs/observations.jsonl, or undefined when there is none yet. */
  observations(): string | undefined;
  /** state/learn/cursor.json, or undefined before the first analysis. */
  cursor(): string | undefined;
  writeCursor(text: string): void;
  /** skills/learn/SKILL.md */
  skill(): string;
  /** The one model call; returns its text, throws when it fails. */
  analyse(prompt: string): string;
  /** Writes a waiting item under state/approvals/pending/. */
  fileLesson(id: string, text: string): void;
}

export type LearnResult =
  | { status: 'nothing-new' }
  | { status: 'learned'; observations: number; lessons: string[] }
  | { status: 'failed'; observations: number; problem: string };

const MAX_LESSONS = 5;
const MAX_EXAMPLES = 5;
const MAX_FAILED_CALLS = 20;
const MAX_OTHER_RECORDS = 300;
const PROJECT = /^[\w-]+$/;
const SKILL = /^[a-z][a-z0-9-]*$/;

type Check = [(l: Record<string, unknown>) => boolean, string];

const filled = (v: unknown) => typeof v === 'string' && v.trim() !== '';
const seenOf = (l: Record<string, unknown>) => l.seen as Record<string, unknown>;

const CHECKS: Check[] = [
  [(l) => typeof l.project === 'string' && (l.project === '' || PROJECT.test(l.project)), 'the project is not a project name or empty'],
  [(l) => typeof l.seen === 'object' && l.seen !== null, 'seen is not an object'],
  [(l) => filled(seenOf(l).summary), 'seen.summary is empty or not text'],
  [(l) => Number.isInteger(seenOf(l).count) && (seenOf(l).count as number) >= 1, 'seen.count is not a whole number of at least 1'],
  [(l) => examplesOk(seenOf(l).examples), `seen.examples is not 1 to ${MAX_EXAMPLES} examples as text`],
  [(l) => filled(l.change), 'change is empty or not text'],
  [(l) => DESTINATIONS.includes(l.destination as Destination), 'the destination is not directive, skill or gate'],
  [(l) => l.destination !== 'directive' || l.project !== '', 'a project directive needs its project'],
  [(l) => l.skill === undefined || (typeof l.skill === 'string' && SKILL.test(l.skill)), 'the skill is not a skill name'],
];

function examplesOk(examples: unknown): boolean {
  return Array.isArray(examples) && examples.length >= 1 && examples.length <= MAX_EXAMPLES && examples.every(filled);
}

function problemOf(entry: unknown): string | undefined {
  if (typeof entry !== 'object' || entry === null) return 'it is not an object';
  return CHECKS.find(([holds]) => !holds(entry as Record<string, unknown>))?.[1];
}

/** The JSON object in the model's answer, which may sit in a code fence or in prose. */
export function objectIn(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('it holds no JSON object');
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error('it is not valid JSON');
  }
}

function lessonsIn(text: string): Lesson[] {
  const list = (objectIn(text) as { lessons?: unknown }).lessons;
  if (!Array.isArray(list)) throw new Error('lessons is not a list');
  if (list.length > MAX_LESSONS) throw new Error(`more than ${MAX_LESSONS} lessons`);
  list.forEach((entry, i) => {
    const problem = problemOf(entry);
    if (problem !== undefined) throw new Error(`lesson ${i + 1}: ${problem}`);
  });
  return list as Lesson[];
}

/** The model's lessons, or why its answer was rejected as a whole. */
export function parseLessons(text: string): { lessons: Lesson[] } | { problem: string } {
  try {
    return { lessons: lessonsIn(text) };
  } catch (e) {
    return { problem: (e as Error).message };
  }
}

function toolCounts(tools: Observation[]): string[] {
  const counts = new Map<string, number>();
  for (const t of tools as Extract<Observation, { kind: 'tool' }>[]) {
    const key = `${t.role} ${t.tool} ${t.result}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const sorted = [...counts].sort(([a, m], [b, n]) => n - m || a.localeCompare(b));
  return sorted.map(([key, n]) => `- ${key}: ${n}`);
}

const orNone = (lines: string[]) => (lines.length === 0 ? ['None.'] : lines);

/** The one model call's prompt: the skill, then the new observations, tool calls counted rather than listed. */
export function learnPrompt(skill: string, records: Observation[]): string {
  const tools = records.filter((r) => r.kind === 'tool');
  const failed = tools.filter((t) => t.result === 'error').slice(0, MAX_FAILED_CALLS);
  const others = records.filter((r) => r.kind !== 'tool').slice(-MAX_OTHER_RECORDS);
  return [
    skill,
    '',
    '## Observations',
    '',
    `${records.length} new records.`,
    '',
    '### Tool calls by role, tool and result',
    '',
    ...orNone(toolCounts(tools)),
    '',
    '### Failed tool calls',
    '',
    ...orNone(failed.map((t) => `- ${t.role} ${t.ticket} ${t.tool}: ${t.target}`)),
    '',
    '### Run outcomes and choices',
    '',
    ...orNone(others.map((r) => JSON.stringify(r))),
    '',
  ].join('\n');
}

/** A lesson as its waiting-item file: what the briefing shows, plus the count, examples and run. */
export function lessonOfFile(l: Lesson, run: string): string {
  const times = l.seen.count === 1 ? 'time' : 'times';
  const seen = `${l.seen.summary} Seen ${l.seen.count} ${times}, for example: ${l.seen.examples.join('; ')}.`;
  // JSON leaves out a skill that is undefined.
  return `${JSON.stringify({ project: l.project, seen, change: l.change, destination: l.destination, skill: l.skill, count: l.seen.count, examples: l.seen.examples, run }, null, 2)}\n`;
}

/** How many records the last analysis read; 0 when unknown, so a broken cursor reads everything again. */
function cursorOf(text: string | undefined): number {
  let records: unknown;
  try {
    records = (JSON.parse(text as string) as { records?: unknown }).records;
  } catch {}
  return /^\d+$/.test(String(records)) ? Number(records) : 0;
}

function analysed(fresh: Observation[], io: LearnIo): { text: string } | { problem: string } {
  try {
    return { text: io.analyse(learnPrompt(io.skill(), fresh)) };
  } catch (e) {
    return { problem: `the model call failed (${(e as Error).message})` };
  }
}

/**
 * The function ledger's records (ticket 15c) are cost data, not outcomes, plan approvals (tickets 33, 43) are for the
 * evaluation, and a session's denials (ticket 52) come with its result for the improver's session facts: the analysis
 * leaves them out.
 */
const LEDGER_KINDS: string[] = ['session', 'hook', 'stream', 'approval', 'denial'];

export function runLearn(run: string, io: LearnIo): LearnResult {
  const all = parseObservations(io.observations());
  const from = cursorOf(io.cursor());
  const fresh = all.slice(from > all.length ? 0 : from).filter((r) => !LEDGER_KINDS.includes(r.kind));
  if (fresh.length === 0) return { status: 'nothing-new' };
  const answer = analysed(fresh, io);
  const parsed = 'text' in answer ? parseLessons(answer.text) : answer;
  if ('problem' in parsed) {
    const problem = 'text' in answer ? `the model's answer was malformed (${parsed.problem})` : parsed.problem;
    return { status: 'failed', observations: fresh.length, problem };
  }
  const lessons = parsed.lessons.map((l, i) => {
    const id = `lesson/${run}-${i + 1}.json`;
    io.fileLesson(id, lessonOfFile(l, run));
    return id;
  });
  io.writeCursor(JSON.stringify({ records: all.length, run }));
  return { status: 'learned', observations: fresh.length, lessons };
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const NOTES: { [S in LearnResult['status']]: (r: Extract<LearnResult, { status: S }>) => string } = {
  'nothing-new': () => 'no new observations, so no analysis this run.',
  learned: (r) => {
    const waiting = r.lessons.length === 0 ? 'no lessons this time' : `${count(r.lessons.length, 'lesson waits', 'lessons wait')} for your approval`;
    return `${count(r.observations, 'new observation', 'new observations')} analysed; ${waiting}.`;
  },
  failed: (r) => `no lessons this run, ${r.problem}. The ${r.observations} new observations are read again next run.`,
};

/** One line for the briefing on what the learning loop did this run. */
export const learnNote = (r: LearnResult) => `Learning loop: ${NOTES[r.status](r as never)}`;
