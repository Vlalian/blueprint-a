// Decision 39: tests are the default, but a plan may mark a behaviour (a Pass when claim) as
// needing named non-test evidence, for what a test cannot show. In place of its ts test block
// and failure line, such a behaviour reads:
//   Evidence: non-test
//   Evidence by: coder   (the build role that makes it, ticket 36: its brief lists the behaviour)
//   Evidence file: docs/evidence/<ticket NN>-<evidence name>.png   (a saved screenshot or recording)
//   Evidence report: docs/evidence/<ticket NN>-<evidence name>.json   (checked by gates/evidence against its schema)
// The paths are plain, not backticked: the evidence is made after the build, so cross-artifact
// does not look for them.

import { evidenceKind } from '../evidence/report.ts';

// lint.ts's PlanFinding, spelled out: lint.ts imports this module, and a type import back would be a cycle.
type PlanFinding = { message: string };

const MARK = /^Evidence: non-test\s*$/m;
export const FILE = /^Evidence file: (\S+)\s*$/m;
export const REPORT = /^Evidence report: (\S+\.json)\s*$/m;
export const PRODUCER = /^Evidence by: (coder|cleaner|hardener)\s*$/m;

export const needsEvidence = (body: string) => MARK.test(body);

export function evidenceFindings(b: { n: number; body: string }): PlanFinding[] {
  const file = FILE.exec(b.body);
  const out: PlanFinding[] = [];
  if (file === null || evidenceKind(file[1]) === undefined) {
    out.push({
      message: `behaviour ${b.n} needs non-test evidence but names no screenshot or recording: write "Evidence file: <path>" ending in .png, .jpg, .jpeg, .webp, .mp4, .webm, .mov or .gif`,
    });
  }
  if (!REPORT.test(b.body)) out.push({ message: `behaviour ${b.n} needs non-test evidence but names no report: write "Evidence report: <path>.json" (checked by gates/evidence)` });
  if (!PRODUCER.test(b.body)) {
    out.push({ message: `behaviour ${b.n} needs non-test evidence but names no producer: write "Evidence by: <role>", the build role that makes it (coder, cleaner or hardener)` });
  }
  return out;
}

/** A marked behaviour's producer and evidence paths (empty when it leaves one out); none for an unmarked one. */
export function evidenceOf(b: { n: number; title: string; body: string }): Array<{ n: number; title: string; by: string; file: string; report: string }> {
  if (!needsEvidence(b.body)) return [];
  const field = (re: RegExp) => re.exec(b.body)?.[1] ?? '';
  return [{ n: b.n, title: b.title, by: field(PRODUCER), file: field(FILE), report: field(REPORT) }];
}
