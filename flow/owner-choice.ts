// Only the owner chooses how the workflow changes (ticket 64; AGENTS.md). Which ticket the owner chose is
// adapters/claude-code/ticket-ready.ts (ownerChoice); this is what the merge gate asks of a commit
// (scripts/self-gate-chosen.ts): one that changes the workflow's code (WORKFLOW_CODE) is merged only
// when it names a ticket the owner chose, or rides the branch of one. Docs-only commits stay free.

/** The workflow's code: a commit that changes any of it needs a ticket the owner chose; docs stay free. */
export const WORKFLOW_CODE = ['gates/', 'adapters/', 'dispatcher/', 'scripts/', 'skills/', 'agents/', 'config/', 'templates/'];

const slash = (p: string) => p.split('\\').join('/');

/** The paths that are the workflow's code. */
export const workflowCodeIn = (paths: string[]) => paths.filter((p) => WORKFLOW_CODE.some((dir) => slash(p).startsWith(dir)));

/** The ticket numbers a commit message names (`Ticket 64`, `ticket 15b`), once each, without leading zeros. */
export function ticketsNamed(message: string): string[] {
  const ids = [...message.matchAll(/\btickets? (\d+)([a-z]?)\b/gi)].map((m) => `${Number(m[1])}${m[2]!.toLowerCase()}`);
  return [...new Set(ids)];
}

/** The number of a ticket file or branch (`64-only-owner.md`, `ticket/64-only-owner`, `flow/60`), without leading zeros; undefined when it names none. */
export function ticketNumberOf(name: string): string | undefined {
  const m = /^(\d+)([a-z]?)(?:-|\.md$|$)/.exec(name.split('/').at(-1)!);
  return m === null ? undefined : `${Number(m[1])}${m[2]}`;
}
