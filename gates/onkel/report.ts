// What an onkel run tells a human, and the exit code that goes with it. Kept out of cli.ts,
// which is exempt from mutation, so these decisions are mutation-tested (review #22).
import type { FunctionCognitive } from './cognitive.ts';
import type { CrapScore } from './crap.ts';
import { judge, killCount, CRAP_CEILING, type MutantReport } from './policy.ts';
import type { Suppression, SuppressionList } from './suppressions.ts';

/**
 * The nesting diagnostic, printed under the gate and never part of it.
 *
 * Sorted on its own rather than folded into the CRAP rows, because the whole
 * case for the number is the function that passes CRAP comfortably while
 * nesting badly — and that function would never appear in a list ranked by
 * CRAP. If this block stays empty of anything interesting for a few weeks,
 * cyclomatic was sufficient and that is worth knowing cheaply.
 */
function reportCognitive(cognitive: FunctionCognitive[]): void {
  const worst = [...cognitive].sort((a, b) => b.cognitive - a.cognitive).slice(0, 5);
  if (worst.length === 0) return;

  console.log('\nHighest cognitive complexity (diagnostic — does not gate):');
  for (const fn of worst) {
    console.log(`  ${String(fn.cognitive).padStart(6)}  ${fn.file}:${fn.startLine}  ${fn.name}`);
  }
}

/** One CRAP row: the score, where it is, and the two numbers behind it. */
function crapLine(fn: CrapScore): string {
  return (
    `  ${fn.crap.toFixed(1).padStart(6)}  ${fn.file}:${fn.startLine}  ${fn.name}` +
    `  (complexity ${fn.complexity}, coverage ${(fn.coverage * 100).toFixed(0)}%)`
  );
}

/**
 * The functions measured but not graded, because the change did not touch
 * them. GATE-SCOPE asks for this number beside the verdict, so the post-test
 * sweep knows what it is walking into. Recorded, never failing the run.
 */
function reportStanding(standing: CrapScore[]): void {
  if (standing.length === 0) return;
  const over = standing.filter((fn) => fn.crap > CRAP_CEILING).sort((a, b) => b.crap - a.crap);
  console.log(
    `\nLeft standing (not this change): ${standing.length} function(s) not graded, ` +
      `${over.length} over the ceiling — recorded, not gating.`,
  );
  for (const fn of over) console.log(crapLine(fn));
}

/**
 * Every suppression the gate let through, with its reason (code-health/31).
 * The count above says how many; this says which and why, so a suppression
 * cannot become the quiet route past a mutant. Prints nothing when there are
 * none. The verdict does not depend on it.
 */
export function reportSuppressions(list: SuppressionList): void {
  const groups: [string, Suppression[]][] =
    'unsplit' in list
      ? [['Suppressed (no diff to tell new from old):', list.unsplit]]
      : [
          ['Suppressed, new in this change:', list.new],
          ['Suppressed, already there:', list.existing],
        ];
  for (const [heading, items] of groups.filter(([, items]) => items.length > 0)) {
    console.log(`\n${heading}`);
    for (const s of items) console.log(`  ${s.file}:${s.line} ${s.mutator} — ${s.reason || '(no reason given)'}`);
  }
}

/** The mutant count, split the way the verdict counts kills, and the suppressions behind it. */
function reportMutants(mutants: MutantReport[], suppressed: number, suppressions: SuppressionList): void {
  // The same definition of a kill as the verdict (policy.ts), so the summary cannot say
  // "12 killed" over a PASS that counted timeouts and compile errors too.
  const kills = killCount(mutants);
  const split =
    kills.total === kills.killed
      ? ''
      : ` (${kills.killed} killed, ${kills.timeout} timeout, ${kills.compileError} compile error)`;
  console.log(`\nMutants: ${mutants.length} — ${kills.total} killed${split}, ${suppressed} suppressed`);
  reportSuppressions(suppressions);
}

/**
 * Everything the run says to a human, and the exit code that goes with it.
 *
 * Split out of `main` so both are gradable: this is the whole product of the
 * tool as far as a reader is concerned, and an unasserted message is free to
 * drift into saying nothing.
 */
export function report(
  crap: CrapScore[],
  cognitive: FunctionCognitive[],
  mutants: MutantReport[],
  result: ReturnType<typeof judge>,
  standing: CrapScore[] = [],
  suppressions: SuppressionList = { new: [], existing: [] },
): number {
  const worst = [...crap].sort((a, b) => b.crap - a.crap).slice(0, 5);
  console.log('Highest CRAP:');
  for (const fn of worst) console.log(crapLine(fn));

  reportCognitive(cognitive);
  reportStanding(standing);

  if (result.mutationSkipped) console.log('\nmutation skipped: CRAP failed first');
  else reportMutants(mutants, result.suppressed, suppressions);

  if (result.verdict === 'pass') {
    console.log('\nPASS');
    return 0;
  }

  console.log(`\nESCALATE — ${result.failures.length} problem(s):`);
  for (const f of result.failures) {
    console.log(`  [${f.kind}] ${f.file}:${f.line} ${f.name} — ${f.detail}`);
  }
  // The flow stops and asks; it never lowers its own bar.
  console.log('\nFix these or ask. Do not relax the gate.');
  return 1;
}
