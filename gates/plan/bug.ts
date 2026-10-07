// The bug variant of the plan (ticket 51; Matt Pocock's diagnosing-bugs, v1.3.1 scrape item 7). A
// ticket with a `Category: bug` line gets a bug plan: besides the template's sections it has a
// reproduction that can fail first, minimised; 3-5 ranked hypotheses, each falsifiable by a named
// check; and the test seam, where "no good test seam" is a finding to state, never a reason to
// skip the test. A performance bug (`Category: bug (performance)`) measures a baseline first.
// Secrets pasted from logs are refused anywhere in a bug plan. The plan linter's findings, from
// the plan gate (gate.ts).

import { sections, type PlanFinding } from './lint.ts';

const CATEGORY = /^Category:[ \t]*bug\b([^\n]*)/im;

/** Whether the ticket's own Category line says it is a bug. */
export const isBugTicket = (ticket: string) => CATEGORY.test(ticket);

/** A bug ticket's Category line says performance: `Category: bug (performance)`. */
const isPerformance = (category: RegExpExecArray) => /\bperformance\b/i.test(category[1]!);

// vitest's expect( or node:assert, as in the plan linter's behaviours.
const ASSERTION = /\bexpect\(|\bassert\b/;

function reproduction(body: string): string[] {
  const blocks = [...body.matchAll(/```ts\n([\s\S]*?)\n```/g)].map((m) => m[1]!);
  return [
    ...(blocks.some((code) => ASSERTION.test(code)) ? [] : ['the reproduction has no ```ts test that asserts (expect( or assert)']),
    ...(/^Fails before the fix with:[ \t]*\S/m.test(body) ? [] : ['the reproduction does not say how it fails before the fix ("Fails before the fix with: …")']),
    ...(/^Minimised:[ \t]*\S/m.test(body) ? [] : ['the reproduction does not say how it was minimised ("Minimised: …")']),
  ];
}

/** Each `N. ` item of a numbered list, with the lines that follow it up to the next item. */
function numbered(body: string): Array<{ n: number; text: string }> {
  const items: Array<{ n: number; text: string }> = [];
  for (const line of body.split('\n')) {
    const item = /^(\d+)\. (.*)/.exec(line);
    if (item !== null) items.push({ n: Number(item[1]), text: item[2]! });
    else if (items.length > 0) items.at(-1)!.text += `\n${line}`;
  }
  return items;
}

function hypotheses(body: string): string[] {
  const items = numbered(body);
  const count = items.length >= 3 && items.length <= 5 ? [] : [`a bug plan has 3 to 5 ranked hypotheses; found ${items.length}`];
  const ns = items.map((h) => h.n);
  const ranked = ns.every((n, i) => n === i + 1) ? [] : [`hypotheses are ranked 1..n in order, most likely first; found ${ns.join(', ')}`];
  const checks = items.filter((h) => !/\bCheck:[ \t]*\S/.test(h.text)).map((h) => `hypothesis ${h.n} names no check that would falsify it ("Check: …")`);
  return [...count, ...ranked, ...checks];
}

const SKIPS = /\bskip(?:s|ped|ping)?\b|\bwithout (?:a )?tests?\b|\bno tests?\b(?! seam)/i;

function testSeam(body: string): string[] {
  if (body.trim() === '') return ['section "## Test seam" is empty: name the seam the reproduction goes through, or state that there is no good one'];
  return SKIPS.test(body) ? ['the test seam section skips the test: "no good test seam" is a finding the plan states, never a reason to skip the test'] : [];
}

const baseline = (body: string) => (/\d/.test(body) ? [] : ['the baseline names no measured number']);

const RULES: Array<[string, (body: string) => string[]]> = [
  ['Reproduction', reproduction],
  ['Hypotheses', hypotheses],
  ['Test seam', testSeam],
];

const SECRETS: Array<[string, RegExp]> = [
  ['a token', /\b(?:ghp_|github_pat_|sk-|xox[bp]-|AKIA)[\w-]{12}/],
  ['a bearer token', /\bBearer [\w.~+/-]{12}/],
  ['a credential', /\b(?:password|passwd|secret|token|api_?key)[:=]\s*(?!\[REDACTED\])\S{6}/i],
];

function secretFindings(plan: string): string[] {
  return plan.split('\n').flatMap((line, i) => {
    const hit = SECRETS.find(([, re]) => re.test(line));
    return hit === undefined ? [] : [`line ${i + 1}: ${hit[0]} in the plan; redact it as [REDACTED]`];
  });
}

/** What a bug ticket's plan still lacks; nothing for a ticket that is not a bug. */
export function bugPlanFindings(plan: string, ticket: string): PlanFinding[] {
  const category = CATEGORY.exec(ticket);
  if (category === null) return [];
  const found = sections(plan);
  const rules: typeof RULES = isPerformance(category) ? [['Baseline', baseline], ...RULES] : RULES;
  const messages = rules.flatMap(([title, check]) => {
    const section = found.find((s) => s.title === title);
    return section === undefined ? [`missing section "## ${title}" (the ticket is a bug)`] : check(section.body);
  });
  return [...messages, ...secretFindings(plan)].map((message) => ({ message }));
}

const ASK =
  'This ticket is a bug (its Category line): write the bug plan of your skill. Before "## Behavior list" add "## Reproduction", "## Hypotheses" and "## Test seam"; behaviour 1 is the reproduction test.';
const ASK_BASELINE = 'It is a performance bug: add "## Baseline" first, with the number you measure before any change.';

/** The planning prompt's lines for a bug ticket; none for any other. */
export function bugPromptLines(ticket: string): string[] {
  const category = CATEGORY.exec(ticket);
  if (category === null) return [];
  return ['', ASK, ...(isPerformance(category) ? [ASK_BASELINE] : [])];
}
