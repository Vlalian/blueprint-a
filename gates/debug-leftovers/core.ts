// No debug leftovers (ticket 47): a session that stops with an added `console.log`,
// `console.debug` or `debugger` line in a source file is not done. Only added lines count, and
// only in source files: a test may print, and so may a CLI shell that prints by design, which its
// project lists in "printAllowed" (globs). The Stop gate judges the session's own diff with it;
// cli.ts judges a diff against a base, as a role check. Pure.

import { globToRegExp } from '../lib/glob.ts';
import type { CheckResult } from '../four-checks/check.ts';
import { addedLines, type AddedLine } from '../lib/diff.ts';
import { isTestFile } from '../lib/test-files.ts';

const SOURCE = /\.[cm]?[jt]sx?$/;
const LEFTOVER = /\bconsole\.(?:log|debug)\s*\(|^\s*debugger\b/;
// A comment line (`//`, `/*`, ` * `) only talks about code.
const COMMENT = /^\s*(?:\/\/|\/?\*)/;

export const NAME = 'debug-leftovers';

/** The added debug lines (a call, not a comment) of a unified diff (`git diff -U0`) in source files that are neither tests nor allowed to print. */
export function debugLeftovers(diff: string, allowed: string[] | undefined): AddedLine[] {
  const allow = allowed?.map(globToRegExp);
  const judged = (file: string) => SOURCE.test(file) && !isTestFile(file) && !allow?.some((glob) => glob.test(file));
  return addedLines(diff).filter((l) => judged(l.file) && LEFTOVER.test(l.text) && !COMMENT.test(l.text));
}

/** The leftovers as one of the four checks' results: failed when there is any, each named at its line. */
export function leftoversCheck(found: AddedLine[]): CheckResult {
  const lines = found.map((l) => `${l.file}:${l.line}: ${l.text.trim()}`);
  const tail = found.length === 0 ? '' : ['Added debug lines; take them out, or list a file that prints by design in "printAllowed":', ...lines].join('\n');
  return { name: NAME, command: 'added console.log, console.debug or debugger lines in source files', exitCode: found.length === 0 ? 0 : 1, tail };
}

/** A project config's "printAllowed" globs; none when it lists none. */
export const printAllowedOf = (config: string): string[] => (JSON.parse(config) as { printAllowed?: string[] }).printAllowed ?? [];

/** The check on a session's diff for the Stop gate; undefined when there is no diff to judge or the project runs the check itself. */
export function leftoversFor(diff: string | undefined, config: { checks?: Record<string, string>; printAllowed?: string[] }): CheckResult | undefined {
  if (diff === undefined || Object.hasOwn(config.checks ?? {}, NAME)) return undefined;
  return leftoversCheck(debugLeftovers(diff, config.printAllowed));
}
