// Handoff validator (from swarm-forge's handoff protocol, rewritten; that repo has no licence).
// Agents never write handoff files themselves: they write a short draft of headers, and this
// validator either refuses it with repair messages or returns the canonical file, with the
// sender, id, timestamps, full commit SHA and body generated here.

export interface HandoffIo {
  roles: string[];
  /** The role sending this handoff (from the agent's own environment, never the draft). */
  from: string;
  /** The full SHA, 'ambiguous', or null when the abbreviation names no commit. */
  resolveCommit(abbrev: string): { sha: string } | 'ambiguous' | null;
  now(): string;
  sequence(): number;
}

export interface HandoffResult {
  errors: string[];
  /** The canonical handoff, only when there are no errors. */
  file?: { name: string; text: string };
}

const RESERVED = ['id', 'from', 'role', 'recipient', 'created_at', 'enqueued_at', 'dequeued_at', 'completed_at'];
// A Map, not an object literal: a draft's `type: constructor` must not find Object's own keys.
const REQUIRED = new Map([
  ['git_handoff', ['to', 'priority', 'task', 'commit']],
  ['note', ['to', 'priority', 'message']],
  // Ticket 24: a role that needs a fact asks the controller, which runs the researcher; no role
  // spawns an agent itself. It names no recipient: it always goes to the controller.
  ['research_request', ['priority', 'question']],
]);
// Only hex reaches `git rev-parse`: a revision expression or an option is not a commit.
const HEX_SHA = /^[0-9a-f]{7,40}$/;
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Anything a reader could take for a line break (control characters, NEL, U+2028/9): the body
// line after the headers is an instruction, so a message must not be able to forge one.
const LINE_BREAKING = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

function headers(draft: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of draft.split(/\r?\n/)) {
    // `s`: a value keeps a stray line-breaking character, so the message check below sees it.
    const m = /^([a-z_]+):(.*)/s.exec(line);
    if (m) out.set(m[1]!, m[2]!.trim());
  }
  return out;
}

const oneLine = (v: string, max: number) => v.length <= max && !LINE_BREAKING.test(v);

function recipientErrors(to: string, io: HandoffIo): string[] {
  const roles = to.split(',').map((r) => r.trim());
  const unknown = roles.filter((r) => !io.roles.includes(r)).map((r) => `to: unknown role "${r}" (known: ${io.roles.join(', ')})`);
  return roles.includes(io.from) ? [...unknown, 'to: a role cannot hand off to itself'] : unknown;
}

const FIELD_CHECKS = new Map<string, (value: string, io: HandoffIo) => string[]>([
  ['priority', (v) => (/^\d{2}$/.test(v) ? [] : [`priority must be two digits from 00 to 99; got "${v}"`])],
  ['to', recipientErrors],
  ['task', (v) => (KEBAB.test(v) && v.length <= 40 ? [] : [`task must be a short-kebab-name (a-z, 0-9, -; at most 40); got "${v}"`])],
  ['commit', (v) => (HEX_SHA.test(v) ? [] : [`commit must be a hex SHA of 7 to 40 characters; got "${v}"`])],
  ['message', (v) => (oneLine(v, 80) ? [] : ['message must be one line of at most 80 characters'])],
  ['question', (v) => (oneLine(v, 200) ? [] : ['question must be one line of at most 200 characters'])],
]);

function fieldErrors(h: Map<string, string>, io: HandoffIo): string[] {
  if (h.get('type') === 'research_request' && h.has('to')) return ['to: a research_request always goes to the controller; leave out to'];
  return [...FIELD_CHECKS].flatMap(([field, check]) => (h.has(field) ? check(h.get(field)!, io) : []));
}

/** The sender comes from the environment; one that is not a known role cannot sign a handoff. */
function senderErrors(io: HandoffIo): string[] {
  return io.roles.includes(io.from) ? [] : [`sender "${io.from}" (WORKFLOW_ROLE) is not a known role`];
}

/** Resolves a well-formed commit; a missing or malformed one is reported by the checks above. */
function commitCheck(header: string | undefined, io: HandoffIo): { errors: string[]; sha?: string } {
  // A missing commit reads as "undefined", which is not hex either.
  const abbrev = String(header);
  if (!HEX_SHA.test(abbrev)) return { errors: [] };
  const resolved = io.resolveCommit(abbrev);
  if (resolved === 'ambiguous') return { errors: [`commit "${abbrev}" is ambiguous; use at least 10 characters`] };
  return resolved === null ? { errors: [`commit "${abbrev}" does not resolve to a commit`] } : { errors: [], sha: resolved.sha };
}

const BODY: Record<string, (h: Map<string, string>, io: HandoffIo, sha: string | undefined) => string> = {
  git_handoff: (_h, io, sha) => `merge_and_process ${io.from} ${sha}`,
  note: (h) => h.get('message')!,
  research_request: (h) => `research: ${h.get('question')}`,
};

function stamp(iso: string): string {
  return iso.replace(/[-:]/g, '').replace(/\.\d+/, '');
}

function render(h: Map<string, string>, io: HandoffIo, sha: string | undefined): { name: string; text: string } {
  const type = h.get('type')!;
  const to = (h.get('to') ?? 'controller').split(',').map((r) => r.trim());
  const created = io.now();
  const seq = String(io.sequence()).padStart(6, '0');
  const id = `${stamp(created)}_${seq}_from_${io.from}`;
  const lines = [`id: ${id}`, `from: ${io.from}`, `to: ${to.join(',')}`, `priority: ${h.get('priority')}`, `type: ${type}`];
  if (type === 'git_handoff') lines.push(`role: ${io.from}`, `task: ${h.get('task')}`, `commit: ${sha}`);
  if (type === 'research_request') lines.push(`question: ${h.get('question')}`);
  lines.push(`created_at: ${created}`, '', 'Re-read your role brief.', '');
  lines.push(BODY[type](h, io, sha), '');
  return { name: `${h.get('priority')}_${id}_to_${to.join('_')}.handoff`, text: lines.join('\n') };
}

export function validateHandoff(draft: string, io: HandoffIo): HandoffResult {
  const h = headers(draft);
  const type = h.get('type') ?? '';
  const reserved = [...h.keys()].filter((k) => RESERVED.includes(k)).map((k) => `header "${k}" is reserved and must not be written by agents`);
  const required = REQUIRED.get(type);
  if (!required) return { errors: [...reserved, `type must be git_handoff, note or research_request; got "${type}"`] };
  const missing = required.filter((f) => !h.get(f)).map((f) => `${type} needs "${f}"`);
  const commit = type === 'git_handoff' ? commitCheck(h.get('commit'), io) : { errors: [] };
  const errors = [...reserved, ...senderErrors(io), ...missing, ...fieldErrors(h, io), ...commit.errors];
  return errors.length > 0 ? { errors } : { errors, file: render(h, io, commit.sha) };
}
