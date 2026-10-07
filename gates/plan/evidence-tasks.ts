// Ticket 36: the non-test behaviours of a ticket's plan (decision 39), with who produces each and
// where its evidence goes, so that role's brief lists them and the role does them before it stops.
// Read from the ticket as the build gets it: the approved plan sits inside it, under `## Plan`.

import { evidenceOf } from './evidence.ts';
import { behaviours, sections } from './lint.ts';

export interface EvidenceTask {
  n: number;
  title: string;
  /** The build role that makes it; empty when the plan names none. */
  by: string;
  file: string;
  report: string;
}

/** The plan's behaviours marked `Evidence: non-test`, in plan order; none for a ticket without a plan. */
export function evidenceTasks(ticketText: string): EvidenceTask[] {
  const list = sections(ticketText).find((s) => s.title === 'Behavior list');
  return list === undefined ? [] : behaviours(list.body).flatMap((b) => evidenceOf(b));
}
