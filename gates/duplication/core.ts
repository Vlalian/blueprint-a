// Duplication on changed code only: jscpd reports every clone in the tree, and the cleaner is
// held to the clones its change is part of. A clone that lies wholly in code the change did not
// touch was there before and is not this ticket's to fix.

import type { AddedLine } from '../lib/diff.ts';

export interface Fragment {
  file: string;
  start: number;
  end: number;
}

export interface Clone {
  first: Fragment;
  second: Fragment;
  lines: number;
}

type ReportFragment = { name: string; start: number; end: number };
type Report = { duplicates?: Array<{ firstFile: ReportFragment; secondFile: ReportFragment; lines: number }> };

// jscpd names files relative to the scanned folder, with backslashes on Windows.
const fragment = (f: ReportFragment): Fragment => ({ file: f.name.split('\\').join('/'), start: f.start, end: f.end });

/** The clones in jscpd's JSON report (`--reporters json`, jscpd-report.json). */
export function parseReport(json: string): Clone[] {
  const report = JSON.parse(json) as Report;
  return (report.duplicates ?? []).map((d) => ({ first: fragment(d.firstFile), second: fragment(d.secondFile), lines: d.lines }));
}

const touches = (f: Fragment, changed: AddedLine[]) => changed.some((c) => c.file === f.file && c.line >= f.start && c.line <= f.end);

/** The clones with a changed line inside either of their two fragments. */
export function clonesTouching(clones: Clone[], changed: AddedLine[]): Clone[] {
  return clones.filter((c) => touches(c.first, changed) || touches(c.second, changed));
}
