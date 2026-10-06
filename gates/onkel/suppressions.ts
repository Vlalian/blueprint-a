/**
 * The suppressions a gated run let through, each with the reason its author
 * wrote (code-health/31).
 *
 * Stryker reports a comment suppression as `Ignored`, but it reads a reason
 * only after a **colon** (`// Stryker disable next-line X: reason`). `/onkel`
 * prescribes an **em-dash**, so for most of this repo Stryker's `statusReason`
 * is its own default, "Ignored using a comment", and says nothing. The reason
 * is therefore read from the source, here — a pure function of text, so the
 * parsing can be mutation-tested like the rest of the gate.
 */

import type { MutantReport } from './policy.ts';
import type { ChangedFile } from './scope.ts';

const DIRECTIVE = /Stryker disable next-line\b/;

/** One suppressed mutant, located, with the reason its comment gives. */
export type Suppression = { file: string; line: number; mutator: string; commentLine: number; reason: string | null };

/**
 * The suppressions split by whether this change wrote them. `unsplit` when
 * there is no diff to tell by (`--whole-file`, or git could not say): claiming
 * "already there" without a diff would hide a new one.
 */
export type SuppressionList = { new: Suppression[]; existing: Suppression[] } | { unsplit: Suppression[] };

/** Where a mutant's suppression comment starts, the reason written on it, and the mutators it names (lower case). */
export type SuppressionReason = { commentLine: number; reason: string | null; mutators: string[] };

/**
 * Stryker's own directive grammar (`@stryker-mutator/instrumenter`, `DirectiveBookkeeper`), so
 * a comment reads here exactly as Stryker reads it: at most one space after the comment marker,
 * then the kind, the optional `next-line`, and a list of mutator names.
 */
const STRYKER_DIRECTIVE = /^\s?Stryker (disable|restore)(?: (next-line))? ([a-zA-Z, ]+)/;

/** The mutator names of a directive's list, lower case, as Stryker compares them. */
const namesOf = (list: string): string[] =>
  list
    .split(',')
    .map((name) => name.trim().toLowerCase());

/**
 * Whether a comment's text (after `//` or `/*`) is a disable broader than one line (decision
 * #28): a file- or block-level disable, or a line-level one that names `all`. Only
 * `disable next-line <mutator>: <reason>` is accepted. Returns the directive, or null.
 */
function broadDirective(value: string): string | null {
  const directive = STRYKER_DIRECTIVE.exec(value);
  if (directive === null || directive[1] !== 'disable') return null;
  const lineLevel = directive[2] !== undefined && !namesOf(directive[3]).includes('all');
  return lineLevel ? null : directive[0].trim();
}

/** A broad directive found in a graded file. */
export type BroadDirective = { file: string; line: number; text: string };

/** Every broad directive on one line: Stryker reads a directive after any `//` or `/*`. */
function broadOnLine(text: string): string[] {
  return [...text.matchAll(/\/[/*]/g)]
    .map((marker) => broadDirective(text.slice(marker.index + 2)))
    .filter((d): d is string => d !== null);
}

/**
 * The broad Stryker directives in the files this change touched (every named file when there
 * is no diff to tell by): each one fails the run, whether or not a graded mutant sits under it.
 */
export function broadDirectives(graded: { file: string; source: string }[], changed: ChangedFile[] | null): BroadDirective[] {
  const touched = graded.filter(({ file }) => changed === null || changed.some((c) => c.file === file));
  return touched.flatMap(({ file, source }) =>
    source.split('\n').flatMap((text, i) => broadOnLine(text).map((d) => ({ file, line: i + 1, text: d }))),
  );
}

/** A `//` line comment, indented or not; the capture is its text. */
const COMMENT = /^\s*\/\/(.*)/;
/** The reason: whatever follows the first em-dash or colon. */
const AFTER_SEPARATOR = /[—:](.*)/;

/** A line's comment text, trimmed, or null for code, a blank line, or a line before the file starts. */
const commentOf = (line: string | undefined): string | null => line?.match(COMMENT)?.[1].trim() ?? null;

/** The 0-based index of the directive heading the comment block that ends just above `line`, if any. */
function directiveAbove(lines: string[], line: number): number | null {
  for (let at = line - 2; ; at -= 1) {
    const text = commentOf(lines[at]);
    if (text === null) return null;
    if (DIRECTIVE.test(text)) return at;
  }
}

/**
 * The `Stryker disable next-line` comment block directly above `line` (1-based),
 * and its reason, or null when no such block sits there. The reason follows the
 * first em-dash or colon after the directive, and runs on through the comment
 * lines below it.
 */
export function suppressionReason(source: string, line: number): SuppressionReason | null {
  const lines = source.split('\n');
  const at = directiveAbove(lines, line);
  if (at === null) return null;

  const [, afterDirective] = (commentOf(lines[at]) as string).split(DIRECTIVE);
  const opening = afterDirective.match(AFTER_SEPARATOR);
  const continuation = lines.slice(at + 1, line - 1).map((l) => commentOf(l) as string);
  const reason = opening ? [opening[1], ...continuation].join(' ').trim() : '';
  const directive = STRYKER_DIRECTIVE.exec(commentOf(lines[at]) as string);
  return { commentLine: at + 1, reason: reason === '' ? null : reason, mutators: directive ? namesOf(directive[3]) : [] };
}

/**
 * Every `Ignored` mutant in a run, located with its reason. A comment above the
 * mutant supplies the reason; without one (a config-level ignore) Stryker's own
 * `ignoreReason` stands, and the mutant's line stands in for the comment's.
 */
export function suppressionsOf(
  mutants: MutantReport[],
  sourceOf: (file: string) => string | undefined,
): Suppression[] {
  return mutants
    .filter((m) => m.status === 'Ignored' && m.broad !== true)
    .map((m) => {
      const source = sourceOf(m.file);
      const found = source === undefined ? null : suppressionReason(source, m.line);
      return {
        file: m.file,
        line: m.line,
        mutator: m.mutator,
        commentLine: found?.commentLine ?? m.line,
        reason: found ? found.reason : (m.ignoreReason ?? null),
      };
    });
}

/** A suppression is new when its comment line is one this change added or modified. */
export function classifySuppressions(items: Suppression[], changed: ChangedFile[] | null): SuppressionList {
  if (changed === null) return { unsplit: items };
  const isNew = (s: Suppression): boolean =>
    changed.some(({ file, ranges }) => file === s.file && ranges.some(([start, end]) => s.commentLine >= start && s.commentLine <= end));
  return { new: items.filter(isNew), existing: items.filter((s) => !isNew(s)) };
}

/**
 * The mutants with each suppression's reason taken from the source (code-health/33), so the
 * verdict judges what the author wrote. Only a `disable next-line` comment directly above the
 * mutant that names its mutator is a suppression onkel accepts (decision #28); its reason is
 * the comment's, empty when it gives none. Any other ignored mutant was hidden by something
 * broader (a file- or block-level directive, `all`, or the Stryker config) and is marked
 * `broad`, which fails the run whatever reason Stryker reports for it.
 */
export function withSourceReasons(
  mutants: MutantReport[],
  sourceOf: (file: string) => string | undefined,
): MutantReport[] {
  return mutants.map((m) => {
    if (m.status !== 'Ignored') return m;
    const source = sourceOf(m.file);
    const found = source === undefined ? null : suppressionReason(source, m.line);
    if (found?.mutators.includes(m.mutator.toLowerCase())) return { ...m, ignoreReason: found.reason ?? '' };
    return { ...m, broad: true };
  });
}
