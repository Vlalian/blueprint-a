import { describe, expect, it } from 'vitest';
import { citeOf, claimsProblems, parseClaims, TIERS } from './research-claims.ts';
import { GOOD_CLAIMS } from './research-fixtures.ts';

const problems = (text: string, maxSources = 10) => claimsProblems(text, { maxSources });
const row = (cells: string) => GOOD_CLAIMS.replace(/^\| C4 .*$/m, `| ${cells} |`);

describe('parseClaims', () => {
  it('reads the question, date, status, answer, claims and gaps', () => {
    const f = parseClaims(GOOD_CLAIMS);
    expect(f).toMatchObject({ question: 'How does the sample project count words?', date: '2026-10-04', status: 'complete', gaps: ['The tracker\'s closed tickets were not searched.'] });
    expect(f.answer).toBe('It does not yet: no word-counting module exists, and the only module is is-even.');
    expect(f.claims[0]).toEqual({ id: 'C1', tier: 'Direct', claim: 'The only source module is is-even', source: 'src/is-even.ts:1', quote: 'export function isEven(n: number): boolean', date: '2026-10-04' });
    expect(f.claims.map((c) => c.quote)).toEqual(['export function isEven(n: number): boolean', '"include": ["src"]', 'null if no matches are found', '', '']);
    expect(f.claims.map((c) => c.source)).toEqual(['src/is-even.ts:1', 'tsconfig.json:9-10', expect.stringMatching(/^https:/), 'src/is-even.ts:1', '']);
  });

  it('keeps an escaped pipe inside a cell', () => {
    expect(parseClaims(row('C4 | Direct | a or b | src/x.ts:2 | a \\| b | 2026-10-04')).claims[3]).toMatchObject({ claim: 'a or b', quote: 'a | b', date: '2026-10-04' });
  });

  it('strips one pair of wrapping quotes or backticks, not a quote that only starts or ends the cell', () => {
    const quotes = (q: string) => parseClaims(row(`C4 | Direct | c | src/x.ts:2 | ${q} | 2026-10-04`)).claims[3].quote;
    expect(quotes('"a"')).toBe('a');
    expect(quotes('`a`')).toBe('a');
    expect(quotes('"a')).toBe('"a');
    expect(quotes('a"')).toBe('a"');
    expect(quotes('`a"')).toBe('`a"');
    expect(quotes('"')).toBe('"');
    expect(quotes('"a" b')).toBe('"a" b');
    expect(quotes('b "a"')).toBe('b "a"');
    expect(quotes('-')).toBe('');
  });

  it('reads headings and headers whatever the spaces around them, and only at the start of a line', () => {
    const f = parseClaims(GOOD_CLAIMS.replace('## Answer\n', '## Answer  \n').replace('Status: complete', 'Status: complete  ').replace('It does not yet', 'It is ## not a heading; it does not yet'));
    expect(f.status).toBe('complete');
    expect(f.answer).toMatch(/^It is ## not a heading/);
    expect(parseClaims('Answer\nx\n').answer).toBe('');
  });

  it('takes as gaps only bullet lines under the exact heading, trimmed', () => {
    const gaps = (body: string, title = 'Gaps') => parseClaims(GOOD_CLAIMS.replace(/## Gaps\n[\s\S]*$/, `## ${title}\n${body}`)).gaps;
    expect(gaps('not - a bullet\n  - indented\n-  two spaces\n')).toEqual(['indented', 'two spaces']);
    expect(gaps('- x\n', 'Gaps found')).toBeUndefined();
    expect(gaps('- x\n', 'No Gaps')).toBeUndefined();
  });

  it('skips the header row and an aligned separator, but keeps a row whose ID merely holds a dash', () => {
    const f = parseClaims(GOOD_CLAIMS.replace('|---|---|---|---|---|---|', '|:---|---|---|---|---|---|').replace('| C4 |', '| C-4 |'));
    expect(f.claims.map((c) => c.id)).toEqual(['C1', 'C2', 'C3', 'C-4', 'C5']);
    expect(parseClaims(GOOD_CLAIMS.replace('\n## Gaps', '\nnote |\n## Gaps')).claims).toHaveLength(5);
  });

  it('has no gaps when the section is missing, and accepts the Don\'t know heading', () => {
    expect(parseClaims(GOOD_CLAIMS.replace('## Gaps', '## Notes')).gaps).toBeUndefined();
    expect(parseClaims(GOOD_CLAIMS.replace('## Gaps', "## Don't know")).gaps).toHaveLength(1);
    expect(parseClaims(GOOD_CLAIMS.replace('## Gaps', "## Gaps / Don't know")).gaps).toHaveLength(1);
    expect(parseClaims(GOOD_CLAIMS.replace('## Gaps', '## Don’t know')).gaps).toHaveLength(1);
    expect(parseClaims(GOOD_CLAIMS.replace('## Gaps\n- The', '## Gaps\n* The')).gaps).toEqual(["The tracker's closed tickets were not searched."]);
  });

  it('reads only table rows of the claims section, never the header or separator', () => {
    const f = parseClaims(`${GOOD_CLAIMS}\n## Later\n| C9 | Direct | x | a.ts:1 | y | 2026-10-04 |\n`);
    expect(f.claims.map((c) => c.id)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5']);
  });

  it('reads nothing from a file with none of its parts', () => {
    expect(parseClaims('')).toEqual({ question: undefined, date: undefined, status: undefined, answer: '', claims: [], gaps: undefined });
  });
});

describe('citeOf', () => {
  it('splits a path:line or path:from-to citation', () => {
    expect(citeOf('src/is-even.ts:1')).toEqual({ target: 'src/is-even.ts', from: 1, to: 1 });
    expect(citeOf('tsconfig.json:9-10')).toEqual({ target: 'tsconfig.json', from: 9, to: 10 });
    expect(citeOf('a.ts:12')).toEqual({ target: 'a.ts', from: 12, to: 12 });
  });

  it('takes a URL whole, and nothing else', () => {
    expect(citeOf('https://example.com/a:1')).toEqual({ target: 'https://example.com/a:1' });
    expect(citeOf('http://example.com')).toEqual({ target: 'http://example.com' });
    expect(citeOf('src/is-even.ts')).toBeUndefined();
    expect(citeOf('see src/is-even.ts:1')).toBeUndefined();
    expect(citeOf('src/is-even.ts:1 or so')).toBeUndefined();
    expect(citeOf('ftp://example.com')).toBeUndefined();
    expect(citeOf('https://x.dev see')).toBeUndefined();
    expect(citeOf('xhttps://example.com')).toBeUndefined();
    expect(citeOf('')).toBeUndefined();
  });
});

describe('claimsProblems', () => {
  it('passes a complete claims file', () => {
    expect(problems(GOOD_CLAIMS)).toEqual([]);
    expect(TIERS).toEqual(['Direct', 'Supported', 'Inferred', 'Speculative', 'Unknown']);
  });

  it('fails a file without a Gaps section', () => {
    expect(problems(GOOD_CLAIMS.replace('## Gaps', '## Notes'))).toEqual(['the file has no "## Gaps" (or "## Don\'t know") section: name what the research could not find']);
  });

  it('fails an empty Gaps section: an empty one is suspicious', () => {
    expect(problems(GOOD_CLAIMS.replace("- The tracker's closed tickets were not searched.\n", ''))).toEqual([
      'the Gaps section is empty: no research finds everything; list at least one thing not checked or not known',
    ]);
  });

  it('needs the question, the date, the status and an answer', () => {
    expect(problems(GOOD_CLAIMS.replace('Research: How', 'Topic: How'))).toEqual(['the file names no question: write "Research: <question>" first']);
    expect(problems(GOOD_CLAIMS.replace('Date: 2026-10-04', 'Date: 4 Oct'))).toEqual(['the file has no "Date: YYYY-MM-DD" line']);
    expect(problems(GOOD_CLAIMS.replace('Status: complete', 'Status: done'))).toEqual(['the file has no "Status: complete" or "Status: partial" line']);
    expect(problems(GOOD_CLAIMS.replace('Status: complete', 'Status: partial'))).toEqual([]);
    expect(problems(GOOD_CLAIMS.replace(/## Answer\n.*\n/, '## Answer\n\n'))).toEqual(['the "## Answer" section is empty']);
  });

  it('needs the claims section, though it may hold no claims', () => {
    expect(problems(GOOD_CLAIMS.replace('## Claims', '## Facts'))).toEqual(['the file has no "## Claims" table']);
    expect(problems(GOOD_CLAIMS.replace(/## Answer\n.*\n/, ''))).toEqual(['the "## Answer" section is empty']);
    expect(problems(GOOD_CLAIMS.replace(/^\| C\d .*\n/gm, ''))).toEqual([]);
  });

  it('checks each claim row', () => {
    expect(problems(row('C1 | Direct | dup | src/x.ts:2 | q | 2026-10-04'))).toEqual(['C1 is used twice']);
    expect(problems(row('X4 | Direct | c | src/x.ts:2 | q | 2026-10-04'))).toEqual(['claim "X4": the ID must be C and a number']);
    expect(problems(row('C4 | Sure | c | src/x.ts:2 | q | 2026-10-04'))).toEqual(['C4: tier "Sure" is not one of Direct, Supported, Inferred, Speculative, Unknown']);
    expect(problems(row('C4 | Inferred |  | src/x.ts:2 | - | 2026-10-04'))).toEqual(['C4: the claim is empty']);
    expect(problems(row('C4 | Inferred | c | src/x.ts:2 | - | soon'))).toEqual(['C4: the date must be YYYY-MM-DD']);
    expect(problems(row('C4 | Inferred | c | src/x.ts:2 | - | x2026-10-04'))).toEqual(['C4: the date must be YYYY-MM-DD']);
    expect(problems(row('C4 | Inferred | c | src/x.ts:2 | - | 2026-10-045'))).toEqual(['C4: the date must be YYYY-MM-DD']);
    expect(problems(GOOD_CLAIMS.replace('Date: 2026-10-04', 'Date: 2026-10-04x'))).toEqual(['the file has no "Date: YYYY-MM-DD" line']);
    expect(problems(row('C12 | Inferred | c | src/x.ts:2 | - | 2026-10-04'))).toEqual([]);
    expect(problems(row('XC4 | Inferred | c | src/x.ts:2 | - | 2026-10-04'))).toEqual(['claim "XC4": the ID must be C and a number']);
    expect(problems(row('C4x | Inferred | c | src/x.ts:2 | - | 2026-10-04'))).toEqual(['claim "C4x": the ID must be C and a number']);
    expect(problems(row('C4 | Inferred | c | src/x.ts:2 | -'))).toEqual(['C4: a claim row has 6 cells (ID, tier, claim, source, quote, date); this one has 5']);
  });

  it('needs a source for every tier but Speculative and Unknown, and a quote for Direct and Supported', () => {
    expect(problems(row('C4 | Inferred | c | - | - | 2026-10-04'))).toEqual(['C4: an Inferred claim needs a source: path:line, path:from-to or a URL']);
    expect(problems(row('C4 | Inferred | c | somewhere | - | 2026-10-04'))).toEqual(['C4: an Inferred claim needs a source: path:line, path:from-to or a URL']);
    expect(problems(row('C4 | Speculative | c | - | - | 2026-10-04'))).toEqual([]);
    expect(problems(row('C4 | Speculative | c | somewhere | - | 2026-10-04'))).toEqual(['C4: the source "somewhere" is not path:line, path:from-to or a URL']);
    expect(problems(row('C4 | Direct | c | src/x.ts:2 | - | 2026-10-04'))).toEqual(['C4: a Direct claim needs the quoted text from its source']);
    expect(problems(row('C4 | Supported | c | src/x.ts:2 |  | 2026-10-04'))).toEqual(['C4: a Supported claim needs the quoted text from its source']);
  });

  it('refuses more distinct sources than the cap, counting a file once whatever its lines', () => {
    expect(problems(GOOD_CLAIMS, 3)).toEqual([]);
    expect(problems(GOOD_CLAIMS, 2)).toEqual(['the file cites 3 sources, over the cap of 2']);
  });
});
