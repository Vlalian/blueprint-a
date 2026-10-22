// The owner's decisions on the briefing page's tier-2 items (blueprint-b sections 3 and 9), behind
// DecisionStore so where they are kept can change without touching the read-back step. Today the
// store is a local file, state/decisions.json: the page's 'download decisions' button writes the
// same JSON list. Reading fails closed: a malformed decision, or one item decided twice, is
// ignored and reported, never guessed at.

export type Destination = 'directive' | 'skill' | 'gate';
export const DESTINATIONS: readonly Destination[] = ['directive', 'skill', 'gate'];

export interface Decision {
  /** The item's path under state/approvals/pending/, e.g. plan/sample/03-x.md or lesson/l1.json. */
  itemId: string;
  decision: 'accept' | 'reject';
  /** The owner's optional note; empty when none. */
  note: string;
  /** A lesson's destination as the owner left it; absent for plans and proposals. */
  destination?: Destination;
  /**
   * For a plan: the sha256 of the plan the page showed (planHash). An approval without it, or with another, is void.
   * Ticket 46: for an improvement, its proposalHash; for a built improvement's check (built/<name>.json), its confirmHash.
   */
  planHash?: string;
  decidedAt: string;
}

export interface ReadDecisions {
  decisions: Decision[];
  /** Why a decision, or the whole file, was ignored. */
  problems: string[];
}

export interface DecisionStore {
  read(): ReadDecisions;
  /** Replaces the stored decisions with these (the ones not yet acted on). */
  write(decisions: Decision[]): void;
}

// A kind, then one or more plain segments: none empty or starting with a dot, so no `..`.
// Ticket 46: built/ is a built improvement's check, read by dispatcher/guardrails-confirm.ts.
// Ticket 61: suppressed/ is a suppressed mutant's check, read by dispatcher/suppression-check.ts.
// Ticket 62: merge/ is a reviewed PR waiting for the owner's merge, read by dispatcher/pr-merge.ts.
export const ITEM_ID = /^(?:plan|lesson|proposal|idea|improvement|discovery|built|suppressed|merge)(?:\/[\w-][\w.-]*)+$/;

type Check = [(d: Record<string, unknown>) => boolean, string];

const CHECKS: Check[] = [
  [(d) => typeof d.itemId === 'string' && ITEM_ID.test(d.itemId), 'the item id is not a plan/, lesson/, proposal/, idea/, improvement/, discovery/, built/, suppressed/ or merge/ path'],
  [(d) => d.decision === 'accept' || d.decision === 'reject', 'the decision is not accept or reject'],
  [(d) => d.note === undefined || typeof d.note === 'string', 'the note is not text'],
  [(d) => d.destination === undefined || DESTINATIONS.includes(d.destination as Destination), 'the destination is not directive, skill or gate'],
  [(d) => typeof d.decidedAt === 'string' && !Number.isNaN(Date.parse(d.decidedAt)), 'decidedAt is not a date'],
  [(d) => d.planHash === undefined || (typeof d.planHash === 'string' && /^[0-9a-f]{64}$/.test(d.planHash)), 'the plan hash is not a sha256 hex digest'],
];

function problemOf(entry: unknown): string | undefined {
  if (typeof entry !== 'object' || entry === null) return 'it is not an object';
  return CHECKS.find(([holds]) => !holds(entry as Record<string, unknown>))?.[1];
}

function label(entry: unknown): string {
  const id = (entry as { itemId?: unknown } | null)?.itemId;
  return typeof id === 'string' ? JSON.stringify(id) : 'no item id';
}

const asDecision = (d: Decision): Decision => ({ ...d, note: d.note ?? '' });

/** Drops every decision on an item that appears more than once. */
function once(decisions: Decision[], problems: string[]): Decision[] {
  const count = (id: string) => decisions.filter((d) => d.itemId === id).length;
  for (const id of new Set(decisions.map((d) => d.itemId).filter((id) => count(id) > 1))) {
    problems.push(`${id} was decided ${count(id)} times in one file; all of them were ignored. Decide it once on the page.`);
  }
  return decisions.filter((d) => count(d.itemId) === 1);
}

function fromList(list: unknown[]): ReadDecisions {
  const problems: string[] = [];
  const valid = list.filter((entry, i) => {
    const problem = problemOf(entry);
    if (problem !== undefined) problems.push(`Decision ${i + 1} (${label(entry)}) was ignored: ${problem}.`);
    return problem === undefined;
  });
  const decisions = once((valid as Decision[]).map(asDecision), problems);
  return { decisions, problems };
}

export function parseDecisions(text: string | undefined): ReadDecisions {
  if (text === undefined) return { decisions: [], problems: [] };
  let list: unknown;
  try {
    list = JSON.parse(text);
  } catch (e) {
    return { decisions: [], problems: [`The decisions file is not valid JSON: ${(e as Error).message}. Nothing in it was applied.`] };
  }
  if (!Array.isArray(list)) return { decisions: [], problems: ['The decisions file is not a list of decisions; nothing in it was applied.'] };
  return fromList(list);
}

export interface StoreFileIo {
  /** The file's text, or undefined when it does not exist. */
  read(path: string): string | undefined;
  write(path: string, text: string): void;
}

/** The local-file store: a JSON list of decisions at `path` (state/decisions.json). */
export function fileDecisionStore(path: string, io: StoreFileIo): DecisionStore {
  return {
    read: () => parseDecisions(io.read(path)),
    write: (decisions) => io.write(path, `${JSON.stringify(decisions, null, 2)}\n`),
  };
}
