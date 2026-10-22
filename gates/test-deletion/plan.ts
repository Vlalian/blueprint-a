// The plan's Delete section as the guard reads it (ticket 70): each test the change removes, on a
// line `- Test: <file>[::<title>] -> <file>[::<title>]`, with the test at the new interface that
// replaces it after the arrow. Paths are plain, not backticked: the replacement may not exist yet
// when the plan is written, and the cross-artifact check refuses a backticked file that does not.

import { isTestFile } from '../lib/test-files.ts';
import { sections } from '../plan/lint.ts';
import { testCases, type DeletedTest } from './core.ts';

export interface PlannedDeletion {
  /** `file` or `file::title`, as --allow takes it. */
  test: string;
  /** The replacing test, `file` or `file::title`; undefined when the line names none. */
  replacement: string | undefined;
}

const TEST_LINE = /^\s*- Test:(.*)/gm;

function deletionOf(line: string): PlannedDeletion {
  const [test, replacement] = line.split('->');
  return { test: test!.trim(), replacement: replacement?.trim() || undefined };
}

export function planDeletions(plan: string): PlannedDeletion[] {
  const listed = sections(plan).filter((s) => s.title === 'Delete');
  return listed.flatMap((s) => [...s.body.matchAll(TEST_LINE)]).map((m) => deletionOf(m[1]!));
}

export interface Unreplaced extends DeletedTest {
  replacement: string | undefined;
  reason: string;
}

/** Whether `ref` (`file` or `file::title`) names an active test in the working tree. */
function onBranch(ref: string, readHead: (path: string) => string | undefined): boolean {
  const [file, title] = ref.split('::');
  const text = readHead(file!);
  return text !== undefined && testCases(text, file!).some((c) => c.active && (title === undefined || c.title === title));
}

function unreplaced(d: DeletedTest, p: PlannedDeletion, readHead: (path: string) => string | undefined): Unreplaced[] {
  const name = `${d.file}::${d.title}`;
  if (p.replacement === undefined) return [{ ...d, replacement: undefined, reason: `${name} is listed under Delete with no replacing test` }];
  // A README or doc holding an it('...') example is not a replacing test (review of ticket 70).
  if (!isTestFile(p.replacement.split('::')[0]!)) return [{ ...d, replacement: p.replacement, reason: `${name} is listed under Delete, but its replacing test ${p.replacement} is not in a test file` }];
  if (onBranch(p.replacement, readHead)) return [];
  return [{ ...d, replacement: p.replacement, reason: `${name} is listed under Delete, but its replacing test ${p.replacement} is not on the branch` }];
}

/**
 * The deleted tests the plan does not list, which fail as before, and the listed ones whose
 * replacing test is missing, which fail naming both.
 */
export function checkPlanned(
  gone: DeletedTest[],
  planned: PlannedDeletion[],
  readHead: (path: string) => string | undefined,
): { deleted: DeletedTest[]; unreplaced: Unreplaced[] } {
  const listing = (d: DeletedTest) => planned.find((p) => p.test === d.file || p.test === `${d.file}::${d.title}`);
  return {
    deleted: gone.filter((d) => listing(d) === undefined),
    unreplaced: gone.flatMap((d) => {
      const p = listing(d);
      return p === undefined ? [] : unreplaced(d, p, readHead);
    }),
  };
}
