// The fact lint (ticket 24, decision 5), in the spirit of pstack's check-plan: a plan or a spec
// that states an outside or API fact (how a library, package, endpoint, service or version
// behaves) must cite where it comes from: a research claim by ID (`<date>-<slug>#C<n>`, the
// claims file research/<date>-<slug>.md and its claim) or the code that was read (`path:line`).
// A fact nobody looked up is an assumption; the lint refuses it with the line to fix. Given the
// ticket's claims files (ticket 35: under state/research/<project>/<ticket>/), every cited claim
// ID must be one of them.
// Headings and code fences are not prose and are skipped.

import { parseClaims } from './claims.ts';

export interface FactFinding {
  message: string;
}

// The words that mark a line as talking about something outside this repo. A word glued to a
// path (`docs/adr`, `package.json`) is a file name, not a fact.
const MARKER =
  /(?<![\w/.-])(?:APIs?|SDKs?|endpoints?|librar(?:y|ies)|packages?|upstream|vendors?|docs|documentation|deprecated|rate[- ]limit(?:s|ed)?|HTTP \d{3}|status code \d{3}|v\d+(?:\.\d+)+|version \d+)(?![\w/-]|\.\w)/i;
const CLAIM_ID = /\b\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*#C\d+\b/;
// A file with an extension, a colon and a line number, anywhere in the line.
const PATH_LINE = /\w\.[A-Za-z]\w*:\d/;

export const statesFact = (line: string) => MARKER.test(line);

export const isCited = (line: string) => CLAIM_ID.test(line) || PATH_LINE.test(line);

/** A prose line (not a heading) that states an outside fact and cites nothing. */
const uncited = (line: string) => !line.startsWith('#') && statesFact(line) && !isCited(line);

// Every claim ID in a text, with the claims file's name and the claim apart.
const CLAIM_REFS = /(?<![\w-])(\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*)#(C\d+)\b/g;

/**
 * Each claim ID a text cites that the ticket's claims files do not hold (ticket 35): `claims`
 * gives a claims file's text by its name, from state/research/<project>/<ticket>/.
 */
export function claimFindings(text: string, claims: (name: string) => string | undefined): FactFinding[] {
  const refs = new Map([...text.matchAll(CLAIM_REFS)].map((m) => [m[0], m]));
  return [...refs.values()].flatMap(([ref, name, id]) => {
    const file = claims(name as string);
    if (file === undefined) return [{ message: `${ref} cites ${name}.md, which is not among this ticket's claims files` }];
    return parseClaims(file).claims.some((c) => c.id === id) ? [] : [{ message: `${ref} cites a claim ${name}.md does not hold` }];
  });
}

/** How a plan cites claim `id` of a claims file: the file's name without .md, `#`, the ID. */
export const claimRef = (file: string, id: string) => `${file.split(/[\\/]/).at(-1)!.replace(/\.md$/, '')}#${id}`;

const shown = (line: string) => (line.length > 80 ? `${line.slice(0, 80)}…` : line);

/** Each prose line that states an outside fact with no claim ID or path:line, by line number. */
export function factFindings(text: string): FactFinding[] {
  let fenced = false;
  const out: FactFinding[] = [];
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (line.startsWith('```')) fenced = !fenced;
    if (fenced || !uncited(line)) return;
    out.push({
      message: `line ${i + 1} states an outside or API fact without a claim ID or file:line: "${shown(line)}" Cite a research claim (<date>-<slug>#C<n>) or the code you read (path:line).`,
    });
  });
  return out;
}
