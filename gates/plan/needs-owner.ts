// Ticket 49: every question a plan puts to the owner ("Needs the owner's own eyes") carries the answer the
// planner would pick and one line on why it matters, so the owner can accept it in one word; "I don't
// know" is a valid reply. Each item is a list line (`- `, `* ` or `1. `) with indented lines:
//   - Should slugs keep accented letters?
//     Recommended: no, ASCII only.
//     Why it matters: it fixes every URL the app will ever print.
// Prose with no list is one item; a section that opens with `None.` has none (a closing remark
// on the commands may follow it). The briefing's plan card reads the same items.

// lint.ts's PlanFinding, spelled out: lint.ts imports this module, and a type import back would be a cycle.
type PlanFinding = { message: string };

export interface NeedsOwnerItem {
  question: string;
  recommended: string | undefined;
  why: string | undefined;
}

const ITEM = /^(?:[-*]|\d+\.) /;
const field = (lines: string[], label: string) => lines.map((l) => l.trim()).find((l) => l.startsWith(label))?.slice(label.length).trim() || undefined;

function itemOf(lines: string[]): NeedsOwnerItem {
  return { question: lines[0]!.replace(ITEM, '').trim(), recommended: field(lines, 'Recommended:'), why: field(lines, 'Why it matters:') };
}

/** The section's items, in order; none for `None.`. */
export function needsOwnerItems(body: string): NeedsOwnerItem[] {
  const lines = body.split('\n').filter((l) => l.trim() !== '');
  if (lines.length === 0 || lines[0]!.trim() === 'None.') return [];
  const groups: string[][] = [];
  for (const line of lines) {
    if (ITEM.test(line) || groups.length === 0) groups.push([line]);
    else groups[groups.length - 1]!.push(line);
  }
  return groups.map(itemOf);
}

const SECTION = `"Needs the owner's own eyes"`;
const NO_RECOMMENDATION = `has no "Recommended:" line: give the answer you would pick, so the owner can accept it in one word ("I don't know" is a valid reply)`;
const NO_WHY = 'has no "Why it matters:" line: one line on what the answer changes';

function itemFindings(item: NeedsOwnerItem, n: number): PlanFinding[] {
  const name = `${SECTION} item ${n} ("${item.question}")`;
  return [...(item.recommended === undefined ? [{ message: `${name} ${NO_RECOMMENDATION}` }] : []), ...(item.why === undefined ? [{ message: `${name} ${NO_WHY}` }] : [])];
}

/** One finding per item missing its recommended answer or its why. */
export const needsOwnerFindings = (body: string): PlanFinding[] => needsOwnerItems(body).flatMap((item, i) => itemFindings(item, i + 1));
