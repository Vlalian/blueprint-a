// Owner consent as a gate (ticket 72; ticket 64 in the reference build). Only the owner chooses how
// the guarded code changes. A ticket in the ticket folder is buildable only with an `Agreed:` line in
// its header that quotes the owner choosing it (`Agreed: 2026-10-07 (<owner>: "...")`, `(<owner>
// picked "...")`) or names an improvement the owner accepted (`Agreed: <date> (briefing, improvement
// <id>)`). Without one its status can only be `proposed`; and a locked path changes only on the branch
// of such a ticket (`ticket/<id>-<name>`). The owner's name and the ticket folder are configuration.
// No imports: a harness hook loads this on every edit, and a hook that cannot load fails open.

export interface ConsentConfig {
  /** The name the owner's quotes carry in an Agreed line. */
  owner: string;
  /** The repo folder the tickets are in, forward slashes (`docs/tickets`). */
  tickets: string;
}

const AGREED = /^Agreed: \d{4}-\d{2}-\d{2} \((.+)\)\s*$/m;
const IMPROVEMENT = /\bimprovement \S+$/;
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const quotes = (owner: string) => new RegExp(`\\b${escaped(owner)}\\b[^"“]*["“][^"”]+["”]`);

/** The header before the first `## ` section. */
const headerOf = (text: string) => text.split(/^## /m)[0]!;

/** What the ticket's Agreed line says when it quotes the owner or names an improvement the owner accepted; undefined otherwise. */
export function ownerChoice(text: string, owner: string): string | undefined {
  // No Agreed line reads as "undefined", which neither quotes the owner nor names an improvement.
  const where = String(AGREED.exec(headerOf(text))?.[1]);
  return quotes(owner).test(where) || IMPROVEMENT.test(where) ? where : undefined;
}

/** The statuses a tracker takes a ticket in: each makes it buildable. */
export const BUILDABLE = ['needs-triage', 'ready-for-agent', 'planned', 'claimed', 'ready-for-review'];
// The first Status line anywhere, as a tracker reads it.
const statusOf = (text: string) => /^Status:\s*([a-z-]+)/m.exec(text)?.[1];
const buildableUnchosen = (text: string, owner: string) => BUILDABLE.includes(String(statusOf(text))) && ownerChoice(text, owner) === undefined;
/** A ticket that already stood so in the same status (written before the gate) may still be edited otherwise. */
// No old text reads as "undefined", which has no Status line, so it never stood so.
const stoodSo = (old: string | undefined, next: string, owner: string) => buildableUnchosen(String(old), owner) && statusOf(String(old)) === statusOf(next);

/**
 * Why a ticket's new text may not be written: it puts the ticket in a buildable status (BUILDABLE)
 * without an Agreed line that quotes the owner or names an improvement the owner accepted. Undefined
 * when the write may go ahead.
 */
export function readyRefusal(old: string | undefined, next: string, owner: string): string | undefined {
  if (!buildableUnchosen(next, owner) || stoodSo(old, next, owner)) return undefined;
  return `a ticket is buildable (${BUILDABLE.join(', ')}) only when its Agreed line quotes ${owner} choosing it or names an improvement ${owner} accepted; leave it proposed and put it to ${owner} as a choice`;
}

const slash = (p: string) => p.replaceAll('\\', '/');

/** Whether a path is a ticket file in the ticket folder (`<tickets>/<id>-<name>.md`). */
export function isTicket(path: string, config: ConsentConfig): boolean {
  return ticketId(path, config) !== undefined;
}

const ticketId = (path: string, config: ConsentConfig) => new RegExp(`^${escaped(slash(config.tickets))}/(\\d+[a-z]?)-[^/]+\\.md$`).exec(slash(path))?.[1];

/** Whether the branch (`ticket/<id>-<name>`, or its `origin/` ref) builds a ticket whose header records the owner's choice. */
export function agreedBranch(branch: string, io: { list(): string[]; read(path: string): unknown }, config: ConsentConfig): boolean {
  const id = /^(?:origin\/)?ticket\/(\d+[a-z]?)-/.exec(branch)?.[1];
  if (id === undefined) return false;
  const file = io.list().find((p) => ticketId(p, config) === id);
  return file !== undefined && ownerChoice(String(io.read(file)), config.owner) !== undefined;
}

/** A consent config read from JSON: an owner and a ticket folder, both non-empty strings. */
export function parseConsent(text: string): ConsentConfig {
  const value = JSON.parse(text) as Partial<ConsentConfig>;
  for (const key of ['owner', 'tickets'] as const) {
    if (typeof value[key] !== 'string' || value[key] === '') throw new Error(`consent config needs a non-empty "${key}"`);
  }
  return { owner: value.owner!, tickets: value.tickets! };
}
