// The flow tools' settings (ticket 84): everything the flow needs to know about the team that runs
// it, read from config/flow.json. A field the file leaves out keeps its default (DEFAULTS,
// documented in docs/blueprint-a/02-flow-and-roles.md); a field of the wrong type is an error that
// names it. The model families are configuration, never code: each names the shell command that
// builds and the one that reviews, so Codex, Claude Code, opencode or a local model plug in alike,
// and the other-family rule (model-run.ts) reads its families from here. The host the PR and CI
// tools talk to is adapters/host's "pr" shape (github, or azure-devops with its organization,
// project and repository). Pure: the file's text in, the settings out.

import { hostConfigOf, type HostConfig } from '../adapters/host/config.ts';

/** One model family: its name, the shell command that builds a round, the one that reviews, and how long either may take. */
export interface Family {
  name: string;
  build: string;
  review: string;
  timeoutMs: number;
}

export interface FlowConfig {
  /** The branch tickets merge into, and the base merged into every open ticket branch. */
  integrationBranch: string;
  /** The most builds in flight at a time, every family counted together. */
  buildCap: number;
  /** Who says yes to a merge; named in the merge commit. */
  owner: string;
  /** The folder of the ticket files, `<NN-name>.md`. */
  ticketFolder: string;
  /** A ticket branch is this prefix and the ticket file's name. */
  branchPrefix: string;
  remote: string;
  /** Where the flow keeps its state, relative to the repo. */
  stateDir: string;
  /** Where the flow makes its worktrees, relative to the repo. */
  worktreeDir: string;
  /** adapters/host's host: github, or azure-devops with organization, project and repository. */
  host: HostConfig;
  families: Family[];
  /** Shell commands the gate queue runs on the merge of base and branch, in order; {base} and {branch} are filled in. */
  gate: string[];
  /** Shell commands the builder's round must pass before handover (11-optimisations item 6). */
  checks: string[];
  /** The command that typechecks a branch after the base is merged into it. */
  typecheck: string;
  /** Shell commands run in the merge before its commit, and the files they write that the commit takes. */
  afterMerge: { commands: string[]; add: string[] };
  /** The owner's decisions on waiting items (decisions.ts's JSON list), relative to the repo. */
  decisions: string;
  /** Where learn files the waiting lessons (lesson/<run>-<n>.json), relative to the repo. */
  pendingFolder: string;
  /** The file an accepted directive lesson is appended to, relative to the repo. */
  directivesFile: string;
  /** The skills an accepted skill lesson goes in, <skill>/SKILL.md each, relative to the repo. */
  skillsFolder: string;
}

export const FLOW_CONFIG = 'config/flow.json';

export const DEFAULTS: FlowConfig = {
  integrationBranch: 'main',
  buildCap: 3,
  owner: 'the owner',
  ticketFolder: 'docs/tickets',
  branchPrefix: 'ticket/',
  remote: 'origin',
  stateDir: 'state/flow',
  worktreeDir: '.worktrees',
  host: { host: 'github' },
  families: [],
  gate: ['npm run gate -- --base {base} --merge {branch}'],
  checks: ['npx tsc --noEmit', 'npx vitest run'],
  typecheck: 'npx tsc --noEmit',
  afterMerge: { commands: [], add: [] },
  decisions: 'state/decisions.json',
  pendingFolder: 'state/approvals/pending',
  directivesFile: 'AGENTS.md',
  skillsFolder: 'skills',
};

const FAMILY = 'a list of {name, build, review, timeoutMs?} with distinct names';

const isText = (v: unknown): v is string => typeof v === 'string';
const isTexts = (v: unknown): v is string[] => Array.isArray(v) && v.every(isText);
const isCount = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;

type Rule = [check: (v: unknown) => boolean, says: string];

const RULES: Partial<Record<keyof FlowConfig, Rule>> = {
  buildCap: [isCount, 'a whole number above 0'],
  gate: [isTexts, 'a list of strings'],
  checks: [isTexts, 'a list of strings'],
};

const fail = (name: string, says: string): never => {
  throw new Error(`${FLOW_CONFIG}: ${name} is not ${says}`);
};

/** A family as written, its timeout an hour when it names none; throws naming the field. */
function familyOf(raw: unknown): Family {
  const f = Object(raw) as Record<string, unknown>;
  const timeoutMs = f.timeoutMs ?? 3_600_000;
  const ok = [f.name, f.build, f.review].every((v) => isText(v) && v.trim() !== '') && isCount(timeoutMs);
  return ok ? { name: f.name as string, build: f.build as string, review: f.review as string, timeoutMs: timeoutMs as number } : fail('families', FAMILY);
}

function familiesOf(raw: unknown): Family[] {
  if (!Array.isArray(raw)) return fail('families', FAMILY);
  const families = raw.map(familyOf);
  return new Set(families.map((f) => f.name)).size === families.length ? families : fail('families', FAMILY);
}

function afterMergeOf(raw: unknown): FlowConfig['afterMerge'] {
  const a = Object(raw) as Record<string, unknown>;
  const value = { commands: a.commands ?? [], add: a.add ?? [] };
  return isTexts(value.commands) && isTexts(value.add) ? (value as FlowConfig['afterMerge']) : fail('afterMerge', 'an object of {commands, add}, each a list of strings');
}

/** A plain field: the file's value when it has its rule's (or its default's) type. */
function plain(name: keyof FlowConfig, value: unknown): unknown {
  const [check, says] = RULES[name] ?? [isText, 'a string'];
  return check(value) ? value : fail(name, says);
}

function hostOf(raw: unknown): HostConfig {
  try {
    return hostConfigOf(raw);
  } catch (e) {
    throw new Error(`${FLOW_CONFIG}: host: ${(e as Error).message}`);
  }
}

const SPECIAL: Partial<Record<keyof FlowConfig, (v: unknown) => unknown>> = {
  families: familiesOf,
  afterMerge: afterMergeOf,
  host: hostOf,
};

function fieldOf(name: keyof FlowConfig, value: unknown): unknown {
  if (value === undefined) return DEFAULTS[name];
  return (SPECIAL[name] ?? ((v: unknown) => plain(name, v)))(value);
}

/** The settings in config/flow.json's text, defaults for what it leaves out; all defaults for no file. Throws on a broken file. */
export function parseFlowConfig(text: string | undefined): FlowConfig {
  if (text === undefined) return DEFAULTS;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`${FLOW_CONFIG} is not JSON`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error(`${FLOW_CONFIG} is not a JSON object`);
  const file = raw as Record<string, unknown>;
  return Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, fieldOf(k as keyof FlowConfig, file[k])])) as unknown as FlowConfig;
}
