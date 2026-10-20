// EARS criteria (Kiro): every acceptance criterion names a trigger or state and a response the
// system "shall" give, so vague criteria ("make it fast") are refused before planning starts.
//   Ubiquitous:  The <system> shall <response>.
//   Event:       When <trigger>, the <system> shall <response>.
//   State:       While <state>, the <system> shall <response>.
//   Unwanted:    If <condition>, then the <system> shall <response>.
//   Optional:    Where <feature>, the <system> shall <response>.
// A criterion in one of the five forms is still refused when it leans on a vague word (group-2
// decision 38, after ECC's banned-words list): "fast" or "correctly" names no check a test can make.

import type { PlanFinding } from './lint.ts';

const SUBJECT_SHALL = String.raw`(?:the\s+)?\S+(?:\s+\S+){0,3}\s+shall\s+\S+`;
const EARS = new RegExp(
  String.raw`^(?:(?:When|While|Where)\s[^,]+,\s*${SUBJECT_SHALL}|If\s[^,]+,\s*then\s+${SUBJECT_SHALL}|The\s+\S+(?:\s+\S+){0,3}\s+shall\s+\S+)`,
  'i',
);

export const isEars = (criterion: string) => EARS.test(criterion.trim());

export const VAGUE_WORDS = [
  'correctly',
  'properly',
  // A phrase comes before the word inside it, so the finding names the whole phrase.
  'as appropriate',
  'appropriate',
  'appropriately',
  'fast',
  'quickly',
  'efficient',
  'efficiently',
  'user-friendly',
  'robust',
  'as needed',
  'reasonable',
  'reasonably',
  'adequate',
  'adequately',
  'intuitive',
  'seamless',
  'seamlessly',
  'gracefully',
  'easy',
  'easily',
  'flexible',
  'optimal',
  'optimally',
  'sufficient',
  'sufficiently',
  'if possible',
  'as soon as possible',
  'etc',
  'and/or',
];

// A whole word or phrase: no letter, digit or hyphen on either side, so "fast-forward" and
// "breakfast" pass. The words hold no regex metacharacters, so they go in unescaped.
const VAGUE = VAGUE_WORDS.map((word) => ({ word, re: new RegExp(String.raw`(?<![\w-])${word}(?![\w-])`, 'i') }));

/** The first vague word or phrase in a criterion, if any. */
export const vagueWord = (criterion: string) => VAGUE.find((v) => v.re.test(criterion))?.word;

function criterionFinding(c: string): PlanFinding[] {
  if (!isEars(c)) return [{ message: `criterion is not in EARS form ("When <trigger>, the <system> shall <response>"): "${c}"` }];
  const vague = vagueWord(c);
  return vague === undefined ? [] : [{ message: `criterion uses the vague word "${vague}"; name what is measured or checked instead: "${c}"` }];
}

export function earsFindings(criteria: string[]): PlanFinding[] {
  return criteria.flatMap(criterionFinding);
}
