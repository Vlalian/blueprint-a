// ADR conflicts (ticket 50, Matt's domain.md): a plan never overrides a decision record silently.
// An Approach line that names an ADR (`ADR-0005` or `docs/adr/0005-…`) with a word that goes against
// it (contradicts, overrides, reverses, against, instead of, drops, …) needs the flag
// "Contradicts ADR-0005, worth reopening because <reason>" somewhere in the plan. The flag escalates:
// a plan that carries one waits for the owner (dispatcher/agreed.ts), since only he reopens a decision.
// The check reads what the plan says; the controller is told to read the ADRs for the area and to
// write the flag when its Approach goes against one.

import { sections, type PlanFinding } from './lint.ts';

const ADR = /\bADR-(\d{4})\b|\bdocs\/adr\/(\d{4})-/g;
const AGAINST =
  /\b(?:contradict(?:s|ed|ing)?|overrid(?:e|es|ing|den)|overturn(?:s|ed|ing)?|revers(?:e|es|ed|ing)|against|despite|instead of|ignor(?:e|es|ed|ing)|depart(?:s|ed|ing)? from|drop(?:s|ped|ping)?|replac(?:e|es|ed|ing))\b/i;
const FLAG = /\bContradicts ADR-(\d{4}), worth reopening because \S/g;

/** The ADRs a line names, as ADR-NNNN. */
const adrsIn = (line: string) => [...line.matchAll(ADR)].map((m) => `ADR-${m[1] ?? m[2]}`);

/** The ADRs the plan flags as worth reopening, once each, in order. */
export const adrFlags = (plan: string) => [...new Set([...plan.matchAll(FLAG)].map((m) => `ADR-${m[1]}`))];

export function adrFindings(plan: string): PlanFinding[] {
  const lines = sections(plan)
    .filter((s) => s.title === 'Approach')
    .flatMap((s) => s.body.split('\n'));
  const contradicted = new Set(lines.filter((line) => AGAINST.test(line)).flatMap(adrsIn));
  const flagged = adrFlags(plan);
  return [...contradicted].filter((id) => !flagged.includes(id)).map((id) => ({ message: `Approach contradicts ${id} without the flag "Contradicts ${id}, worth reopening because ..."` }));
}
