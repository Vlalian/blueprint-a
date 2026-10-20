// Invisible and bidi characters in added lines (from ECC's check-unicode-safety). They can make
// code read differently from how it runs ("Trojan Source") or hide instructions from a reviewer
// in text an agent will read.

import type { AddedLine } from '../lib/diff.ts';

export interface UnicodeFinding {
  file: string;
  line: number;
  column: number;
  codePoint: string;
  name: string;
}

// Written as escapes so this file holds none of the characters it looks for.
const KINDS: Array<[name: string, re: RegExp]> = [
  ['bidi control', /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/g],
  ['zero-width', /[\u200B-\u200D\u2060\u180E]/g],
  ['soft hyphen', /\u00AD/g],
  ['byte-order mark', /\uFEFF/g],
  ['invisible operator', /[\u2061-\u2064]/g],
  // Tag characters mirror ASCII invisibly; they are a known way to hide a prompt in plain text.
  ['tag character', /[\u{E0000}-\u{E007F}]/gu],
];

// A byte-order mark is allowed as the very first character of a file.
const isLeadingBom = (name: string, line: number, index: number) => name === 'byte-order mark' && line === 1 && index === 0;

const codePointOf = (ch: string) => `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;

function findingsIn({ file, line, text }: AddedLine): UnicodeFinding[] {
  return KINDS.flatMap(([name, re]) =>
    [...text.matchAll(re)]
      .filter((m) => !isLeadingBom(name, line, m.index))
      .map((m) => ({ file, line, column: m.index + 1, codePoint: codePointOf(m[0]), name })),
  );
}

const byPosition = (a: UnicodeFinding, b: UnicodeFinding) => a.line - b.line || a.column - b.column;

export function scanHiddenUnicode(lines: AddedLine[]): UnicodeFinding[] {
  return lines.flatMap(findingsIn).sort(byPosition);
}
