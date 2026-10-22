// Ticket files: markdown with a leading `Status: <token>` line, one file per ticket.
// The token vocabulary comes from the AFK flow's TASK-STATE.md.

export type TicketStatus = 'ready-for-agent' | 'planned' | 'claimed' | 'ready-for-review' | 'done' | TriageStatus;

/** Ticket 51: a needs-triage ticket's triage sets one of these (dispatcher/triage.ts). */
export type TriageStatus = 'needs-info' | 'closed';

export interface Ticket {
  id: string;
  file: string;
  title: string;
  status: string;
  text: string;
}

// No trailing `$`: `[^\n]*` is greedy, so the match already runs to the end of the line.
const STATUS_LINE = /^Status:[^\n]*/m;
// Group 1 is not optional, so a match always carries the title. A single `\s` after the number
// is enough: any further spaces land in the title and `trim` takes them off.
const HEADING = /^#\s+(?:\d+\s)?(.+)/m;
const STATUS_TOKEN = /^Status:\s*([a-z-]+)/m;

function titleOf(file: string, text: string): string {
  const heading = HEADING.exec(text);
  return heading ? heading[1].trim() : file;
}

function statusOf(text: string): string {
  return STATUS_TOKEN.exec(text)?.[1] ?? '';
}

export function parseTicket(file: string, text: string): Ticket {
  // `split` always returns at least one element, so the first is the whole name when there is no '-'.
  const [id] = file.split('-');
  return { id, file, title: titleOf(file, text), status: statusOf(text), text };
}

export function setStatus(text: string, status: TicketStatus, date: string): string {
  if (!STATUS_LINE.test(text)) throw new Error('Ticket has no Status line; refusing to guess where to write it.');
  return text.replace(STATUS_LINE, `Status: ${status} (${date})`);
}

export function appendComment(text: string, comment: string, date: string): string {
  const line = `- ${date}: ${comment}\n`;
  const base = text.endsWith('\n') ? text : `${text}\n`;
  if (/^## Comments\s*$/m.test(base)) return base + line;
  return `${base}\n## Comments\n${line}`;
}

export interface AcceptanceTest {
  path: string;
  content: string;
}

const ACCEPTANCE_FILE = /^File:\s*(\S+)\s*\n```[a-z]*\n([\s\S]*?)^```/gm;
const PROTECTED = /^tests\/protected\/[\w.-]+(\/[\w.-]+)*$/;

// Acceptance tests ship with the ticket and are written before the coder starts. They may only
// land under tests/protected/, which the coder cannot edit.
export function extractAcceptanceTests(text: string): AcceptanceTest[] {
  // Both groups are mandatory, so every match carries a path and a content.
  return [...text.matchAll(ACCEPTANCE_FILE)].map(([, path, content]) => {
    if (!PROTECTED.test(path) || path.split('/').includes('..')) {
      throw new Error(`Acceptance test path must be inside tests/protected/: ${path}`);
    }
    return { path, content };
  });
}

export function selectBuildable(tickets: Ticket[], limit: number): Ticket[] {
  return tickets
    .filter((t) => t.status === 'planned')
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, limit);
}
