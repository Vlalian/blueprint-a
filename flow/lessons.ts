// flow apply-lessons (ticket 84 review, the generic step of scripts/apply-lesson-core.ts): writes
// the lessons the owner accepted, and only those. learn files each lesson as a waiting item in
// config/flow.json's pendingFolder (lesson/<run>-<n>.json); the owner accepts or rejects it in the
// decisions file (decisions.ts's list, config/flow.json's decisions). An accepted lesson goes
// where the owner's decision says, else where the lesson suggests, with its approval id (the item
// and the moment the owner accepted it), and is never written twice:
// - directive: a section in config/flow.json's directivesFile (AGENTS.md by default);
// - skill: a rule appended to <skillsFolder>/<skill>/SKILL.md (the coder's when the lesson names
//   none), a skill that must be there;
// - gate: a gate is code, so the lesson is filed as a ticket draft in <stateDir>/lessons/gate/.
// A rejected lesson changes nothing; one that does not check out is refused and reported, and
// nothing is written for it. With the files injected.

import { DESTINATIONS, parseDecisions, type Decision, type Destination } from './decisions.ts';
import type { FlowConfig } from './config.ts';
import { flowPath, jsonText, repoPath } from './state.ts';

export interface LessonsIo {
  root: string;
  read(path: string): string | undefined;
  write(path: string, text: string): void;
  out(text: string): void;
}

export interface Applied {
  item: string;
  approval: string;
  path: string;
}

type LessonsConfig = Pick<FlowConfig, 'stateDir' | 'decisions' | 'pendingFolder' | 'directivesFile' | 'skillsFolder'>;

interface Lesson {
  project: string;
  seen: string;
  change: string;
  destination: Destination;
  skill: string;
}

const NAME = /^[\w-]+$/;

/** The skill a rule goes in when its lesson names none. */
const CODER = 'coder';

export const approvalIdOf = (e: { itemId: string; decidedAt: string }) => `${e.itemId}@${e.decidedAt}`;

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/** The text appended for one lesson, with its approval id and `how` it was accepted and applied. */
export function lessonBlock(e: { itemId: string; decidedAt: string; note: string }, l: { change: string; seen: string }, how: string): string {
  const note = oneLine(e.note) === '' ? [] : [`- Your note: ${oneLine(e.note)}`];
  return ['', `## Lesson ${e.itemId}`, '', l.change, '', `- Seen: ${l.seen}`, ...note, `- Approval: ${approvalIdOf(e)} (${how})`, ''].join('\n');
}

function objectOf(text: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {}
  if (typeof value !== 'object' || value === null) throw new Error('it is not a JSON object');
  return value as Record<string, unknown>;
}

/** The waiting lesson's file, as an object with its change and what was seen as text. */
function waiting(d: Decision, c: LessonsConfig, io: LessonsIo): Record<string, unknown> & { change: string; seen: string } {
  const text = io.read(repoPath(io.root, `${c.pendingFolder}/${d.itemId}`));
  if (text === undefined) throw new Error(`it is not waiting in ${c.pendingFolder}`);
  const l = objectOf(text);
  if (typeof l.change !== 'string' || typeof l.seen !== 'string') throw new Error('it has no change or seen as text');
  return l as Record<string, unknown> & { change: string; seen: string };
}

/** The destination the owner chose, else the one the lesson suggests. */
function destinationOf(chosen: Destination | undefined, suggested: unknown): Destination {
  const destination = chosen ?? suggested;
  if (!DESTINATIONS.includes(destination as Destination)) throw new Error('it names no destination of directive, skill or gate');
  return destination as Destination;
}

/** The waiting lesson an accepted decision is about, with the destination the owner chose or it suggests. */
function lessonOf(d: Decision, c: LessonsConfig, io: LessonsIo): Lesson {
  const l = waiting(d, c, io);
  return { project: String(l.project ?? ''), seen: l.seen, change: l.change, destination: destinationOf(d.destination, l.destination), skill: String(l.skill ?? CODER) };
}

/** Where the lesson goes, and the file's text to start from when it may not exist yet. */
type Target = { path: string; fresh?: string };

const TARGETS: Record<Destination, (d: Decision, l: Lesson, c: LessonsConfig, io: LessonsIo) => Target> = {
  directive: (_d, _l, c, io) => ({ path: repoPath(io.root, c.directivesFile), fresh: '# Directives\n' }),
  skill: (_d, l, c, io) => {
    const path = repoPath(io.root, `${c.skillsFolder}/${l.skill}/SKILL.md`);
    if (!NAME.test(l.skill) || io.read(path) === undefined) throw new Error(`skill "${l.skill}" is not a skill in ${c.skillsFolder}`);
    return { path };
  },
  gate: (d, l, c, io) => ({
    path: flowPath(io.root, c, `lessons/gate/${d.itemId.replaceAll('/', '-').replace(/\.json$/, '')}.md`),
    fresh: `# Code gate: ${l.change}\n\nStatus: needs-ticket\nFor: ${l.project || 'every project'}\n`,
  }),
};

/** Writes one accepted lesson where it goes, unless it is there under this approval already. */
function applyOne(d: Decision, c: LessonsConfig, io: LessonsIo): Applied {
  const l = lessonOf(d, c, io);
  const target = TARGETS[l.destination](d, l, c, io);
  // A skill's file was just read, so only a directive or gate may start fresh.
  const before = (io.read(target.path) ?? target.fresh) as string;
  const approval = approvalIdOf(d);
  if (!before.includes(`- Approval: ${approval} `)) io.write(target.path, `${before}${lessonBlock(d, l, `accepted in ${c.decisions}, applied by flow apply-lessons`)}`);
  return { item: d.itemId, approval, path: target.path };
}

/** Applies every lesson the decisions file accepts; what was applied and what was refused. */
export function applyAccepted(c: LessonsConfig, io: LessonsIo): { applied: Applied[]; problems: string[] } {
  const read = parseDecisions(io.read(repoPath(io.root, c.decisions)));
  const applied: Applied[] = [];
  const problems = [...read.problems];
  for (const d of read.decisions.filter((x) => x.decision === 'accept' && x.itemId.startsWith('lesson/'))) {
    try {
      applied.push(applyOne(d, c, io));
    } catch (e) {
      problems.push(`Lesson ${d.itemId} was not applied: ${(e as Error).message}.`);
    }
  }
  return { applied, problems };
}

/** `flow apply-lessons`: prints what was applied and refused as JSON; 1 when a lesson was refused, 2 for any argument. */
export function flowApplyLessons(argv: string[], c: LessonsConfig, io: LessonsIo): number {
  if (argv.length > 0) return (io.out('usage: flow apply-lessons\n'), 2);
  const r = applyAccepted(c, io);
  io.out(jsonText(r));
  return r.problems.length > 0 ? 1 : 0;
}
