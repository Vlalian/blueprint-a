// Plan linter (pstack's check-plan, applied to the plan-afk template in templates/plan.md): the
// plan's structure is checked by code before the owner reads it. A thin plan is refused with
// line-level repair messages; the build then reads it cold in a fresh session.

import { evidenceFindings, needsEvidence } from './evidence.ts';
import { needsOwnerFindings } from './needs-owner.ts';

export interface PlanFinding {
  message: string;
}

export const REQUIRED_HEADERS = ['Plan for:', 'Created:', 'Status:'];

export const REQUIRED_SECTIONS = [
  'What this is',
  'What I verified in the code',
  'Approach',
  'Patterns to mirror',
  'Behavior list',
  'Acceptance criteria -> behaviors',
  'Out of scope',
  'Risks for an unattended build',
  "Needs the owner's own eyes",
];

/** Each `## ` section's title and body, in file order. */
export function sections(plan: string): Array<{ title: string; body: string }> {
  const parts = plan.split(/^## /m).slice(1);
  return parts.map((part) => {
    const newline = part.indexOf('\n');
    return { title: part.slice(0, newline === -1 ? undefined : newline).trim(), body: newline === -1 ? '' : part.slice(newline + 1) };
  });
}

/** Each `### N. title` behaviour with its number, title and body. */
export function behaviours(behaviorList: string): Array<{ n: number; title: string; body: string }> {
  // Groups 2 and 3 always take part in a match (they may be empty), so they are never undefined.
  return [...behaviorList.matchAll(/^### (\d+)\.([^\n]*)\n([\s\S]*?)(?=^### |(?![\s\S]))/gm)].map((m) => ({ n: Number(m[1]), title: m[2]!.trim(), body: m[3]! }));
}

// Leftover template text (group-2 decision 31): the placeholders templates/plan.md ships with,
// then ECC's two release-gate shapes, a tag that says todo/tbd/placeholder and the bare words.
export const TEMPLATE_PLACEHOLDERS = [
  '<path to the ticket>',
  'YYYY-MM-DD',
  '<title>',
  'path:line',
  '<behavior>',
  '<what it guarantees>',
  '<the error or wrong value>',
  '<criterion, word for word from the ticket>',
  '<ticket NN>',
  '<evidence name>',
];
const PLACEHOLDER_SHAPES = [/<[^>]*(?:todo|tbd|placeholder)[^>]*>/i, /\b(?:TODO|TBD|PLACEHOLDER)\b/];

/** The first leftover template text on a line, if any. */
function leftover(line: string): string | undefined {
  return TEMPLATE_PLACEHOLDERS.find((p) => line.includes(p)) ?? PLACEHOLDER_SHAPES.map((re) => re.exec(line)?.[0]).find((hit) => hit !== undefined);
}

function placeholderFindings(plan: string): PlanFinding[] {
  return plan.split('\n').flatMap((line, i) => {
    const hit = leftover(line);
    return hit === undefined ? [] : [{ message: `line ${i + 1}: leftover template text "${hit}"` }];
  });
}

function headerFindings(plan: string): PlanFinding[] {
  return REQUIRED_HEADERS.filter((h) => !new RegExp(`^${h}\\s*\\S`, 'm').test(plan)).map((h) => ({ message: `missing header line "${h}"` }));
}

function sectionFindings(found: Array<{ title: string; body: string }>): PlanFinding[] {
  const titles = found.map((s) => s.title);
  const out: PlanFinding[] = [];
  // The earliest index the next required section may sit at: one past the latest one seen.
  let next = 0;
  for (const required of REQUIRED_SECTIONS) {
    const at = titles.indexOf(required);
    if (at === -1) out.push({ message: `missing section "## ${required}"` });
    else if (at < next) out.push({ message: `section "## ${required}" is out of order` });
    else if (found[at]!.body.trim() === '') out.push({ message: `section "## ${required}" is empty (write "None." if there is nothing)` });
    next = Math.max(next, at + 1);
  }
  return out;
}

function numberingFindings(items: Array<{ n: number }>): PlanFinding[] {
  if (items.length === 0) return [{ message: 'the behavior list has no behaviours' }];
  const numbers = items.map((b) => b.n);
  return numbers.every((n, i) => n === i + 1) ? [] : [{ message: `behaviours must be numbered 1..n in order; found ${numbers.join(', ')}` }];
}

// An assertion call: vitest's expect( or node:assert, as a word of its own.
const ASSERTION = /\bexpect\(|\bassert\b/;

function behaviourBodyFindings(b: { n: number; body: string }): PlanFinding[] {
  const out: PlanFinding[] = [];
  const blocks = [...b.body.matchAll(/```ts\n([\s\S]*?)\n```/g)].map((m) => m[1]!);
  if (blocks.length === 0) out.push({ message: `behaviour ${b.n} has no \`\`\`ts test block` });
  else if (!blocks.some((code) => ASSERTION.test(code))) out.push({ message: `behaviour ${b.n}'s test block has no assertion (expect( or assert)` });
  if (!/^Fails before implementation with:\s*\S/m.test(b.body)) out.push({ message: `behaviour ${b.n} does not say how it fails before implementation` });
  return out;
}

function behaviourFindings(found: Array<{ title: string; body: string }>): PlanFinding[] {
  const list = found.find((s) => s.title === 'Behavior list');
  if (!list) return [];
  const items = behaviours(list.body);
  // A behaviour marked as needing non-test evidence names it instead of a test (decision 39).
  return [...numberingFindings(items), ...items.flatMap((b) => (needsEvidence(b.body) ? evidenceFindings(b) : behaviourBodyFindings(b)))];
}

/** Ticket 49: each question for the owner carries a recommended answer and why it matters. */
const ownerFindings = (found: Array<{ title: string; body: string }>) => needsOwnerFindings(found.find((s) => s.title === "Needs the owner's own eyes")?.body ?? '');

export function lintPlan(plan: string): PlanFinding[] {
  const found = sections(plan);
  return [...headerFindings(plan), ...sectionFindings(found), ...behaviourFindings(found), ...ownerFindings(found), ...placeholderFindings(plan)];
}
