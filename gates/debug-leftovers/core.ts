// No debug leftovers (ticket 47): a session that stops with an added `console.log`,
// `console.debug` or `debugger` line in a JS or TS source file, or (ticket 99) an added `print(`,
// `breakpoint(` or pdb line in a Python source file, is not done. Only added lines count, and only
// in source files: a test may print (and so may a pytest conftest.py), and so may a CLI shell that
// prints by design, which its project lists in "printAllowed" (globs). The Stop gate judges the
// session's own diff with it; cli.ts judges a diff against a base, as a role check. Pure.

import { globToRegExp } from '../lib/glob.ts';
import type { CheckResult } from '../four-checks/check.ts';
import { addedLines, type AddedLine } from '../lib/diff.ts';
import { isTestFile } from '../lib/test-files.ts';

/** Per language: its source files, its debug lines, and its comment lines (which only talk about code). */
const LANGUAGES = [
  // A comment line (`//`, `/*`, ` * `).
  { source: /\.[cm]?[jt]sx?$/, leftover: /\bconsole\.(?:log|debug)\s*\(|^\s*debugger\b/, comment: /^\s*(?:\/\/|\/?\*)/ },
  // print( or breakpoint( as a call of its own (not a method or a longer name), and pdb.
  { source: /\.py$/, leftover: /(?<![.\w])(?:print|breakpoint)\s*\(|\bimport\s+pdb\b|\bfrom\s+pdb\s+import\b|\bpdb\.set_trace\s*\(/, comment: /^\s*#/ },
];

export const NAME = 'debug-leftovers';

const isConftest = (file: string) => file.split('/').at(-1) === 'conftest.py';

/** The added debug lines (a call, not a comment) of a unified diff (`git diff -U0`) in source files that are neither tests nor allowed to print. */
export function debugLeftovers(diff: string, allowed: string[] | undefined): AddedLine[] {
  const allow = allowed?.map(globToRegExp);
  const judged = (file: string) => !isTestFile(file) && !isConftest(file) && !allow?.some((glob) => glob.test(file));
  return addedLines(diff).filter((l) => {
    const language = LANGUAGES.find((lang) => lang.source.test(l.file));
    return language !== undefined && judged(l.file) && language.leftover.test(l.text) && !language.comment.test(l.text);
  });
}

/** The leftovers as one of the four checks' results: failed when there is any, each named at its line. */
export function leftoversCheck(found: AddedLine[]): CheckResult {
  const lines = found.map((l) => `${l.file}:${l.line}: ${l.text.trim()}`);
  const tail = found.length === 0 ? '' : ['Added debug lines; take them out, or list a file that prints by design in "printAllowed":', ...lines].join('\n');
  return { name: NAME, command: 'added console.log, console.debug or debugger lines in JS/TS source, or print(, breakpoint( or pdb lines in Python source', exitCode: found.length === 0 ? 0 : 1, tail };
}

/** A project config's "printAllowed" globs; none when it lists none. */
export const printAllowedOf = (config: string): string[] => (JSON.parse(config) as { printAllowed?: string[] }).printAllowed ?? [];

/** The check on a session's diff for the Stop gate; undefined when there is no diff to judge or the project runs the check itself. */
export function leftoversFor(diff: string | undefined, config: { checks?: Record<string, string>; printAllowed?: string[] }): CheckResult | undefined {
  if (diff === undefined || Object.hasOwn(config.checks ?? {}, NAME)) return undefined;
  return leftoversCheck(debugLeftovers(diff, config.printAllowed));
}
