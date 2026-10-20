// Cross-artifact check (Spec Kit's "analyze" step, as code): the plan and its ticket agree.
// Every ticket criterion maps to a behaviour, every mapping points at a real behaviour and a
// real criterion, every behaviour is claimed, and every file the plan cites as evidence exists.
// Group-2 decision 46: every named path is checked, with or without a slash; a path with a ..
// segment is refused wherever it stands (gates/plan/repo-path.ts resolves symlinks for the rest);
// a file under "## Approach" may be missing only when its line says the build creates it; and a
// section written twice is flagged.

import { adrFindings } from './adr.ts';
import { decisionFindings } from './decisions.ts';
import { behaviours, sections, type PlanFinding } from './lint.ts';

const BULLET = /^\s*-\s*(?:\[[ xX]\]\s*)?(.+?)\s*$/;

// The readers below take every matching section (normally there is one), so a missing section
// reads as no lines at all without a fallback body. Capture groups that always take part in a
// match are read with `!`.

export function ticketCriteria(ticket: string): string[] {
  const lines = [...ticket.matchAll(/^## Acceptance criteria\s*\n([\s\S]*?)(?=^## |(?![\s\S]))/gm)].flatMap((m) => m[1]!.split('\n'));
  return lines.flatMap((line) => {
    const m = BULLET.exec(line);
    return m?.[1] ? [m[1]] : [];
  });
}

/** The body of every `## title` section in the plan. */
const bodies = (plan: string, title: string) =>
  sections(plan)
    .filter((s) => s.title === title)
    .map((s) => s.body);

export function mappedCriteria(plan: string): Array<{ criterion: string; behaviours: number[] }> {
  // (.+?) is lazy between \s* runs, so the criterion never has edge whitespace; Number() ignores
  // the spaces around each behaviour number.
  const lines = bodies(plan, 'Acceptance criteria -> behaviors').flatMap((body) => [...body.matchAll(/^\s*-\s*(.+?)\s*->\s*behaviou?rs?\s([\d,\s]+)$/gm)]);
  // A decision's mapping line (decisions.ts, ticket 50) is not a criterion.
  const criteria = lines.filter((m) => !/^Decision \d+$/.test(m[1]!));
  return criteria.map((m) => ({ criterion: m[1]!, behaviours: m[2]!.split(',').map(Number) }));
}

// A file named without a slash counts as a path only with one of these extensions, so code such as
// `Array.from` is not read as a file.
export const NAMED_FILE_EXTENSIONS = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'md', 'yaml', 'yml'];

/** Backticked repo-relative paths, with any :line or :line-line removed. */
export function namedPaths(text: string): string[] {
  const found = [...text.matchAll(/`([\w.-]+(?:\/[\w.-]+)*\.([a-z]+))(?::\d+(?:-\d+)?)?`/g)];
  return found.filter((m) => m[1]!.includes('/') || NAMED_FILE_EXTENSIONS.includes(m[2]!)).map((m) => m[1]!);
}

type Mapping = { criterion: string; behaviours: number[] };

function unmappedFindings(wanted: string[], mapped: Mapping[]): PlanFinding[] {
  const none = wanted.length === 0 ? [{ message: 'the ticket has no acceptance criteria' }] : [];
  const unmapped = wanted.filter((c) => !mapped.some((m) => m.criterion === c));
  return [...none, ...unmapped.map((c) => ({ message: `criterion not mapped to a behaviour: "${c}"` }))];
}

function mappingErrors(m: Mapping, wanted: string[], have: Set<number>): PlanFinding[] {
  const out: PlanFinding[] = [];
  if (!wanted.includes(m.criterion)) out.push({ message: `mapped criterion is not in the ticket: "${m.criterion}"` });
  for (const n of m.behaviours.filter((b) => !have.has(b))) {
    out.push({ message: `criterion maps to behaviour ${n}, which the plan does not have` });
  }
  return out;
}

const behaviourNumbers = (plan: string) => new Set(bodies(plan, 'Behavior list').flatMap((body) => behaviours(body)).map((b) => b.n));

function mappingFindings(plan: string, ticket: string): PlanFinding[] {
  const wanted = ticketCriteria(ticket);
  const mapped = mappedCriteria(plan);
  const have = behaviourNumbers(plan);
  const claimed = new Set(mapped.flatMap((m) => m.behaviours));
  const unclaimed = [...have].filter((b) => !claimed.has(b)).map((n) => ({ message: `behaviour ${n} is not claimed by any criterion` }));
  return [...unmappedFindings(wanted, mapped), ...mapped.flatMap((m) => mappingErrors(m, wanted, have)), ...unclaimed];
}

// An Approach line that says the build makes the file it names.
const NEW_FILE = /\b(?:creates?|new)\b/i;

function pathFinding(path: string, cited: boolean, declared: boolean, exists: (path: string) => boolean): PlanFinding[] {
  if (path.split('/').includes('..')) return [{ message: `cited path leaves the repo: ${path}` }];
  if (exists(path)) return [];
  if (cited) return [{ message: `cited file does not exist: ${path}` }];
  return declared ? [] : [{ message: `Approach names a file that does not exist and does not say it is new: ${path}` }];
}

function fileFindings(plan: string, exists: (path: string) => boolean): PlanFinding[] {
  const found = sections(plan);
  const cited = new Set(found.filter((s) => s.title !== 'Approach').flatMap((s) => namedPaths(s.body)));
  // A file cited outside Approach must exist whatever its line says, so "new" is read on every line.
  const lines = found.flatMap((s) => s.body.split('\n'));
  const declared = new Set(lines.filter((line) => NEW_FILE.test(line)).flatMap(namedPaths));
  const named = new Set(lines.flatMap(namedPaths));
  return [...named].flatMap((p) => pathFinding(p, cited.has(p), declared.has(p), exists));
}

function duplicateFindings(plan: string): PlanFinding[] {
  const titles = sections(plan).map((s) => s.title);
  const twice = new Set(titles.filter((t, i) => titles.indexOf(t) !== i));
  return [...twice].map((t) => ({ message: `section "## ${t}" appears more than once` }));
}

/** Ticket 50: every decision in the ticket's ledger maps to a criterion or a behaviour. */
const ledgerFindings = (plan: string, ticket: string) => decisionFindings(plan, ticket, ticketCriteria(ticket).length, behaviourNumbers(plan));

export function crossArtifact(plan: string, ticket: string, exists: (path: string) => boolean): PlanFinding[] {
  return [...duplicateFindings(plan), ...mappingFindings(plan, ticket), ...ledgerFindings(plan, ticket), ...adrFindings(plan), ...fileFindings(plan, exists)];
}
