// Selection misses (ticket 56): the full run is the safety net under the fast merge gate's test
// selection. A test file that fails there was broken by a merge after the last run that ran it (a
// merge gate that selected it, or ran everything); when such merges exist and none of them selected
// it, the selection missed it, and the missing edge runs from that test to one of the files those
// merges changed. A failure with no merge after its last run (a flake, or a direct commit) is no miss.
// Pure: records in, misses out.

import type { Observation } from './observations.ts';

type Of<K extends Observation['kind']> = Extract<Observation, { kind: K }>;

export type Miss = { test: string; merges: string[]; changed: string[] };

const ms = (r: Observation) => Date.parse(r.at);
const ofKind = <K extends Observation['kind']>(records: Observation[], kind: K) => records.filter((r): r is Of<K> => r.kind === kind);

/** The merge selections since the last full run, oldest first. */
function selectionsSince(records: Observation[]): Of<'selection'>[] {
  const lastFull = Math.max(-Infinity, ...ofKind(records, 'full-run').map(ms));
  return ofKind(records, 'selection')
    .filter((s) => ms(s) > lastFull)
    .sort((a, b) => ms(a) - ms(b));
}

const unique = (values: string[]) => [...new Set(values)].sort();

/** Each failing test file that no merge since its last run selected, with those merges and what they changed. */
export function selectionMisses(records: Observation[], failing: string[]): Miss[] {
  const selections = selectionsSince(records);
  return failing.flatMap((test) => {
    const after = selections.slice(selections.findLastIndex((s) => s.all || s.tests.includes(test)) + 1);
    return after.length === 0 ? [] : [{ test, merges: unique(after.map((s) => s.ticket)), changed: unique(after.flatMap((s) => s.changed)) }];
  });
}

/** How a miss reads on the full run's output and the briefing: the test, the merges, the missing edge. */
export const missLine = (m: { test: string; merges: string[]; changed: string[] }) =>
  `${m.test} failed in the full run, and no merge since it last ran selected it (${m.merges.join(', ')}); missing edge: ${m.test} depends on one of ${m.changed.join(', ')}`;
