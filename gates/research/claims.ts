// The researcher's claims file (ticket 24, decision 3): research/<date>-<slug>.md. It reads:
//   Research: <the question>
//   Date: YYYY-MM-DD
//   Status: complete | partial            (partial: a cap stopped the research)
//   ## Answer        a short answer
//   ## Claims        | ID | Tier | Claim | Source | Quote | Date |
//   ## Gaps          what it could not find (also "## Don't know"); mandatory and never empty
// Tiers are pstack's epistemic ladder, from seen to not known: Direct (read at the source),
// Supported (the source says so), Inferred (follows from sources), Speculative, Unknown. A source
// is a `path:line`, a `path:from-to` or a URL; Direct and Supported claims quote the text they rest
// on, which the spot-check (spot-check.ts) finds again at the cited place.

export const TIERS = ['Direct', 'Supported', 'Inferred', 'Speculative', 'Unknown'] as const;
export type Tier = (typeof TIERS)[number];

export interface Claim {
  id: string;
  tier: string;
  claim: string;
  /** The citation, unwrapped; '' for none. */
  source: string;
  /** The quoted text, unwrapped; '' for none. */
  quote: string;
  date: string;
  /** How many cells the row had: a claim row has 6. */
  cells?: number;
}

export interface ClaimsFile {
  question: string | undefined;
  date: string | undefined;
  status: string | undefined;
  answer: string;
  claims: Claim[];
  /** The Gaps section's items; undefined when there is no such section. */
  gaps: string[] | undefined;
}

export interface Cite {
  /** A repo path or a URL. */
  target: string;
  from?: number;
  to?: number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const GAPS = /^(?:Gaps|Don['’]t know|Gaps \/ Don['’]t know)$/;
const QUOTED = /^(["`])([\s\S]+)\1$/;
const PATH_LINE = /^(\S+):(\d+)(?:-(\d+))?$/;
const URL = /^https?:\/\/\S+$/;

const header = (text: string, name: string) => new RegExp(`^${name}: *(.+)`, 'm').exec(text)?.[1].trim();

/** Each `## ` section by title, body below it. */
function sectionsOf(text: string): Map<string, string> {
  return new Map(
    text
      .split(/^## /m)
      .slice(1)
      .map((part) => [part.slice(0, part.indexOf('\n')).trim(), part.slice(part.indexOf('\n') + 1)]),
  );
}

/** A cell without one pair of wrapping quotes or backticks; '' for a dash. Cells come trimmed. */
const unwrap = (c: string) => (c === '-' ? '' : (QUOTED.exec(c)?.[2] ?? c));

/** A table row's cells, between its outer pipes, split on pipes that are not escaped. */
const cellsOf = (line: string) =>
  line
    .split(/(?<!\\)\|/)
    .slice(1, -1)
    .map((c) => c.replaceAll('\\|', '|'));

function claimOf(line: string): Claim {
  const cells = cellsOf(line);
  const [id, tier, claim, source, quote, date] = cells.map((c) => c.trim());
  return { id, tier, claim, source: unwrap(String(source)), quote: unwrap(String(quote)), date: String(date), cells: cells.length };
}

/** The claim rows of a Claims section: its table rows but the header and the separator. A missing section reads as "undefined", which has none. */
const rows = (body: string | undefined) =>
  String(body)
    .split('\n')
    .filter((l) => l.startsWith('|'))
    .map(claimOf)
    .filter((c) => c.id !== 'ID' && !/^:?-/.test(c.id));

export function parseClaims(text: string): ClaimsFile {
  const sections = sectionsOf(text);
  const gapsTitle = [...sections.keys()].find((t) => GAPS.test(t));
  return {
    question: header(text, 'Research'),
    date: header(text, 'Date'),
    status: header(text, 'Status'),
    answer: (sections.get('Answer') ?? '').trim(),
    claims: rows(sections.get('Claims')).map(({ cells: _, ...c }) => c),
    gaps:
      gapsTitle === undefined
        ? undefined
        : (sections.get(gapsTitle) as string)
            .split('\n')
            .map((l) => /^[-*] +(.+)/.exec(l.trim())?.[1])
            .filter((g): g is string => g !== undefined),
  };
}

/** A `path:line`, `path:from-to` or URL citation, split; undefined for anything else. */
export function citeOf(source: string): Cite | undefined {
  if (URL.test(source)) return { target: source };
  const m = PATH_LINE.exec(source);
  return m === null ? undefined : { target: m[1], from: Number(m[2]), to: Number(m[3] ?? m[2]) };
}

const SOURCE_KINDS = 'path:line, path:from-to or a URL';

/** What is wrong with a row's shape: its cells, its ID, its tier; undefined when it is a claim row. */
function shapeProblem(c: Claim): string | undefined {
  if (c.cells !== 6) return `${c.id}: a claim row has 6 cells (ID, tier, claim, source, quote, date); this one has ${c.cells}`;
  if (!/^C\d+$/.test(c.id)) return `claim "${c.id}": the ID must be C and a number`;
  return (TIERS as readonly string[]).includes(c.tier) ? undefined : `${c.id}: tier "${c.tier}" is not one of ${TIERS.join(', ')}`;
}

const quoteProblems = (c: Claim) => (['Direct', 'Supported'].includes(c.tier) && c.quote === '' ? [`${c.id}: a ${c.tier} claim needs the quoted text from its source`] : []);

function rowProblems(c: Claim): string[] {
  const shape = shapeProblem(c);
  if (shape !== undefined) return [shape];
  return [...(c.claim === '' ? [`${c.id}: the claim is empty`] : []), ...sourceProblems(c), ...quoteProblems(c), ...(DATE.test(c.date) ? [] : [`${c.id}: the date must be YYYY-MM-DD`])];
}

function sourceProblems(c: Claim): string[] {
  const optional = ['Speculative', 'Unknown'].includes(c.tier);
  if (citeOf(c.source) !== undefined || (optional && c.source === '')) return [];
  return optional ? [`${c.id}: the source "${c.source}" is not ${SOURCE_KINDS}`] : [`${c.id}: an ${c.tier} claim needs a source: ${SOURCE_KINDS}`];
}

function headProblems(f: ClaimsFile, hasClaims: boolean): string[] {
  return [
    ...(f.question === undefined ? ['the file names no question: write "Research: <question>" first'] : []),
    ...(DATE.test(String(f.date)) ? [] : ['the file has no "Date: YYYY-MM-DD" line']),
    ...(['complete', 'partial'].includes(String(f.status)) ? [] : ['the file has no "Status: complete" or "Status: partial" line']),
    ...(f.answer === '' ? ['the "## Answer" section is empty'] : []),
    ...(hasClaims ? [] : ['the file has no "## Claims" table']),
  ];
}

function gapProblems(gaps: string[] | undefined): string[] {
  if (gaps === undefined) return ['the file has no "## Gaps" (or "## Don\'t know") section: name what the research could not find'];
  return gaps.length === 0 ? ['the Gaps section is empty: no research finds everything; list at least one thing not checked or not known'] : [];
}

const duplicates = (claims: Claim[]) => claims.filter((c, i) => claims.findIndex((d) => d.id === c.id) !== i).map((c) => `${c.id} is used twice`);

function sourceCap(claims: Claim[], max: number): string[] {
  const targets = new Set(claims.flatMap((c) => citeOf(c.source)?.target ?? []));
  return targets.size > max ? [`the file cites ${targets.size} sources, over the cap of ${max}`] : [];
}

/** What is wrong with a claims file, as repair messages; empty when it fits the schema. */
export function claimsProblems(text: string, opts: { maxSources: number }): string[] {
  const f = parseClaims(text);
  const all = rows(sectionsOf(text).get('Claims'));
  return [
    ...headProblems(f, sectionsOf(text).has('Claims')),
    ...all.flatMap(rowProblems),
    ...duplicates(all),
    ...sourceCap(all, opts.maxSources),
    ...gapProblems(f.gaps),
  ];
}
