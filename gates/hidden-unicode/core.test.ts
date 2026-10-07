import { describe, expect, it } from 'vitest';
import { scanHiddenUnicode } from './core.ts';

// Written as escapes so this file holds none of the characters it tests for.
const RLO = '\u202E';
const LRI = '\u2066';
const ZWSP = '\u200B';
const SHY = '\u00AD';
const BOM = '\uFEFF';

const at = (text: string, line = 2) => [{ file: 'src/a.ts', line, text }];
const where = (lines: Array<{ file: string; line: number; text: string }>) =>
  scanHiddenUnicode(lines).map((f) => `${f.line}:${f.column} ${f.codePoint} ${f.name}`);

describe('scanHiddenUnicode', () => {
  it('passes plain text, including ordinary non-ASCII like accents and arrows', () => {
    expect(scanHiddenUnicode(at('const café = "→ ok";'))).toEqual([]);
  });

  it('finds bidi controls (the Trojan Source trick) with their code point and column', () => {
    expect(scanHiddenUnicode(at(`if (isAdmin ${RLO}) {`))).toEqual([{ file: 'src/a.ts', line: 2, column: 13, codePoint: 'U+202E', name: 'bidi control' }]);
    expect(scanHiddenUnicode(at(`x${LRI}y`))[0]?.codePoint).toBe('U+2066');
  });

  it('finds zero-width characters that can hide text from a reviewer', () => {
    expect(scanHiddenUnicode(at(`ad${ZWSP}min`)).map((f) => f.name)).toEqual(['zero-width']);
  });

  it('finds a soft hyphen, padding its code point to four digits', () => {
    expect(where(at(`co${SHY}de`))).toEqual(['2:3 U+00AD soft hyphen']);
  });

  it('allows a byte-order mark at the very start of a file, nowhere else', () => {
    expect(scanHiddenUnicode(at(`${BOM}import x;`, 1))).toEqual([]);
    expect(scanHiddenUnicode(at(`a${BOM}b`, 3)).map((f) => f.codePoint)).toEqual(['U+FEFF']);
    expect(where(at(`ab${BOM}`, 1))).toEqual(['1:3 U+FEFF byte-order mark']);
    expect(where(at(`${BOM}x`, 2))).toEqual(['2:1 U+FEFF byte-order mark']);
  });

  it('allows only a byte-order mark there, not other hidden characters', () => {
    expect(where(at(`${ZWSP}x`, 1))).toEqual(['1:1 U+200B zero-width']);
    expect(where(at(`${ZWSP}x`, 4))).toEqual(['4:1 U+200B zero-width']);
  });

  it('finds Unicode tag characters, which can smuggle invisible instructions to an agent', () => {
    expect(where(at('ok\u{E0041}\u{E007F}'))).toEqual(['2:3 U+E0041 tag character', '2:5 U+E007F tag character']);
    expect(where(at('\u{E0000}'))).toEqual(['2:1 U+E0000 tag character']);
    expect(where(at('\u{E0080} \u{1F600}'))).toEqual([]);
  });

  it('finds invisible math operators', () => {
    expect(where(at('a\u2061b\u2064'))).toEqual(['2:2 U+2061 invisible operator', '2:4 U+2064 invisible operator']);
    expect(where(at('\u2060\u2065'))).toEqual(['2:1 U+2060 zero-width']);
  });

  it('orders findings by line, then column', () => {
    const lines = [
      { file: 'b.ts', line: 3, text: `${ZWSP}a${RLO}b${SHY}` },
      { file: 'a.ts', line: 1, text: `x${ZWSP}${LRI}` },
      { file: 'c.ts', line: 2, text: `${SHY}${RLO}` },
    ];
    expect(where(lines)).toEqual([
      '1:2 U+200B zero-width',
      '1:3 U+2066 bidi control',
      '2:1 U+00AD soft hyphen',
      '2:2 U+202E bidi control',
      '3:1 U+200B zero-width',
      '3:3 U+202E bidi control',
      '3:5 U+00AD soft hyphen',
    ]);
  });
});
