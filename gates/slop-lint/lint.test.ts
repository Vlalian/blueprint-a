import { describe, expect, it } from 'vitest';
import { escapeRe, lintProse } from './lint.ts';

const kinds = (text: string) => lintProse(text).map((f) => f.kind);

describe('lintProse', () => {
  it('passes plain, specific prose', () => {
    expect(lintProse('Built slugify in src/slugify.ts. All four checks passed in 41 seconds.')).toEqual([]);
  });

  it('flags banned words, whole words only, any case', () => {
    expect(kinds('We leverage a Robust pipeline.')).toEqual(['banned-word', 'banned-word']);
    expect(kinds('The lever moved.')).toEqual([]);
  });

  it('flags empty stock phrases', () => {
    expect(kinds("It's worth noting that the test failed.")).toEqual(['stock-phrase']);
  });

  it('flags any em dash in short text, and more than two in long text', () => {
    expect(kinds('Done — all green.')).toEqual(['em-dash']);
    const long = `${'word '.repeat(80)}a — b — c — d`;
    expect(kinds(long)).toEqual(['em-dash']);
  });

  it('allows up to two em dashes in long text', () => {
    expect(kinds(`${'word '.repeat(80)}a — b — c`)).toEqual([]);
  });

  it('counts a text of exactly 300 characters, line breaks included, as long', () => {
    const exactly300 = `${'a'.repeat(149)}\n—${'b'.repeat(149)}`;
    expect(exactly300).toHaveLength(300);
    expect(lintProse(exactly300)).toEqual([]);
    expect(kinds(exactly300.slice(1))).toEqual(['em-dash']);
  });

  it('reports the em-dash count, the limit, and the line of the first dash', () => {
    expect(lintProse('ok\nfine\nA — b — c')).toEqual([{ kind: 'em-dash', line: 3, match: '2 em dashes (limit 0)' }]);
    const long = `${'word '.repeat(80)}\nx\na — b — c — d`;
    expect(lintProse(long)).toEqual([{ kind: 'em-dash', line: 3, match: '3 em dashes (limit 2)' }]);
  });

  it('flags emoji in headings, reporting the heading trimmed', () => {
    expect(kinds('## 🚀 Results\n')).toEqual(['emoji-heading']);
    expect(lintProse('## 🚀 Results  ')).toEqual([{ kind: 'emoji-heading', line: 1, match: '## 🚀 Results' }]);
  });

  it('flags emoji only in a real heading: hashes at the start, one to six of them, then a space', () => {
    expect(kinds('Shipped it 🚀')).toEqual([]);
    expect(kinds('Shipped it ## 🚀')).toEqual([]);
    expect(kinds('#release🚀')).toEqual([]);
    expect(kinds('####### 🚀 too deep')).toEqual([]);
    expect(kinds('###### 🚀 deep enough')).toEqual(['emoji-heading']);
    expect(kinds('# Results ✅')).toEqual(['emoji-heading']);
  });

  it('flags binary-contrast setups', () => {
    expect(lintProse("The question isn't the model, it's the eval.")).toEqual([
      { kind: 'binary-contrast', line: 1, match: "isn't the model, it's" },
    ]);
    expect(kinds('This is not a bug, but a feature.')).toEqual(['binary-contrast']);
    expect(kinds('It is NOT JUST speed,but cost.')).toEqual(['binary-contrast']);
  });

  it('does not read a contrast across a sentence end, a long gap, or inside other words', () => {
    expect(kinds("It isn't here. Later, it's there.")).toEqual([]);
    expect(kinds(`It isn't ${'x'.repeat(61)}, it's there.`)).toEqual([]);
    expect(kinds(`It isn't ${'x'.repeat(59)}, it's there.`)).toEqual(['binary-contrast']);
    expect(kinds("This isn't, it's empty.")).toEqual([]);
    expect(kinds('Thisis not wrong, butter is fine.')).toEqual([]);
    expect(kinds("It isn't wrong, its fine.")).toEqual([]);
  });

  it('ignores code blocks and inline code, which are quoted output', () => {
    expect(lintProse('Output:\n```\nleverage — robust\n```\nand `delve` ok.')).toEqual([]);
  });

  it('recognises a fence that is indented or names a language', () => {
    expect(lintProse('List:\n  ```\n  leverage\n  ```\nok')).toEqual([]);
    expect(lintProse('Code:\n```ts\nconst leverage = 1;\n```\nok')).toEqual([]);
  });

  it('drops inline code from the line it reports', () => {
    expect(lintProse('## 🚀 `npm test` passed')[0]?.match).toBe('## 🚀  passed');
  });

  it('reports the line number of each finding', () => {
    expect(lintProse('ok\nwe delve in')[0]).toMatchObject({ kind: 'banned-word', line: 2, match: 'delve' });
  });

  it('lists findings in line order, the text-wide em-dash finding included', () => {
    expect(lintProse('A — b\nwe delve in').map((f) => [f.kind, f.line])).toEqual([
      ['em-dash', 1],
      ['banned-word', 2],
    ]);
  });
});

describe('escapeRe', () => {
  it('makes every regex metacharacter literal', () => {
    const special = 'a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o';
    expect(new RegExp(`^${escapeRe(special)}$`).test(special)).toBe(true);
    expect(escapeRe('x.y')).toBe('x\\.y');
    expect(escapeRe('plain words')).toBe('plain words');
  });
});
