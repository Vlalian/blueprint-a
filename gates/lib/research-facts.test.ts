import { describe, expect, it } from 'vitest';
import { claimFindings, claimRef, factFindings, isCited, statesFact } from './research-facts.ts';
import { GOOD_CLAIMS } from './research-fixtures.ts';

const lines = (text: string) => factFindings(text).map((f) => f.message);

describe('statesFact', () => {
  it('sees a line about an outside API, library, package, version or service behaviour', () => {
    for (const line of [
      'The fetch API rejects only on network errors.',
      'The SDK retries twice.',
      'The /v7/deployments endpoint pages by 20.',
      'The library ships its own types.',
      'The libraries agree.',
      'The package exports an ESM build only.',
      'Upstream dropped Node 20.',
      'The vendor says so.',
      'The docs say the flag is on by default.',
      'Its documentation lists three modes.',
      'That option is deprecated.',
      'The rate limit is 60 calls an hour.',
      'Requests are rate-limited.',
      'It answers HTTP 429 when busy.',
      'A status code 404 means gone.',
      'Since v4.1 the runner is faster.',
      'Since version 5 it is ESM.',
      'Since v10.20.3 the runner is faster.',
      'Since version 12 it is ESM.',
    ]) {
      expect(statesFact(line), line).toBe(true);
    }
  });

  it('leaves a line about this repo alone', () => {
    for (const line of ['Create src/word-count.ts.', 'Add no dependency.', 'It returns 3 for three words.', 'Speed is 1.5 times better.', 'apidoc', 'The packager runs.', 'mydocs', 'v4', 'versions', 'Edit api.ts now.', 'Read docs/adr/01.md.', 'The doc string.']) {
      expect(statesFact(line), line).toBe(false);
    }
  });
});

describe('isCited', () => {
  it('accepts a claim ID or a path:line', () => {
    expect(isCited('The SDK retries twice (2026-10-04-sdk-retries#C2).')).toBe(true);
    expect(isCited('The SDK retries twice, `node_modules/sdk/retry.js:12`.')).toBe(true);
    expect(isCited('The SDK retries twice (see lib/retry.ts:3-9).')).toBe(true);
    expect(isCited('The SDK reads config.json:4.')).toBe(true);
    expect(isCited('The SDK retries twice (2026-10-04-sdk#C12).')).toBe(true);
  });

  it('refuses a bare file, a URL, a claim ID without its file, or nothing', () => {
    expect(isCited('The SDK retries twice, see lib/retry.ts.')).toBe(false);
    expect(isCited('The SDK retries twice: https://sdk.dev/retry')).toBe(false);
    expect(isCited('The SDK retries twice (C2).')).toBe(false);
    expect(isCited('The SDK retries twice (#C2).')).toBe(false);
    expect(isCited('The SDK retries twice (2026-10-04-sdk#2).')).toBe(false);
    expect(isCited('The SDK retries twice.')).toBe(false);
  });

  it('spells a claim ID as the research file and the claim', () => {
    expect(claimRef('research/2026-10-04-sdk-retries.md', 'C2')).toBe('2026-10-04-sdk-retries#C2');
    expect(claimRef('research\\2026-10-04-sdk-retries.md', 'C2')).toBe('2026-10-04-sdk-retries#C2');
    expect(claimRef('a/research/2026-10-04-a.md-notes.md', 'C1')).toBe('2026-10-04-a.md-notes#C1');
  });
});

describe('factFindings', () => {
  const plan = ['# 03 - Count words', '', '## Approach', 'The SDK retries twice.', '- The SDK retries twice (2026-10-04-sdk#C1).', ''].join('\n');

  it('fails a line that states an outside fact without a claim ID, and names the line', () => {
    expect(lines(plan)).toEqual([
      'line 4 states an outside or API fact without a claim ID or file:line: "The SDK retries twice." Cite a research claim (<date>-<slug>#C<n>) or the code you read (path:line).',
    ]);
  });

  it('passes once the line cites a claim', () => {
    expect(lines(plan.replace('The SDK retries twice.\n', 'The SDK retries twice (2026-10-04-sdk#C1).\n'))).toEqual([]);
  });

  it('skips headings and code fences, indented or not, but not a table row or a line with a # inside', () => {
    expect(lines(['## The API', '  ### The SDK', '```ts', '// the SDK retries', 'api.get();', '```', '|---|---|', 'Done.', '  ```', 'The SDK, indented fence', '  ```'].join('\n'))).toEqual([]);
    expect(lines(['| C1 | The SDK retries |', 'The SDK retries (see #12).'].join('\n'))).toEqual([expect.stringContaining('line 1 '), expect.stringContaining('line 2 ')]);
    expect(lines(['```', 'x', '```', 'The SDK retries.'].join('\n'))).toEqual([expect.stringContaining('line 4 ')]);
  });

  it('shortens a long line in the message', () => {
    const long = `The SDK ${'a'.repeat(100)}`;
    expect(lines(long)[0]).toContain(`"${long.slice(0, 80)}…"`);
    expect(lines(long.slice(0, 80))[0]).toContain(`"${long.slice(0, 80)}"`);
  });
});

describe('claimFindings (ticket 35)', () => {
  const store = (name: string) => (name === '2026-10-04-03-count-words' ? GOOD_CLAIMS : undefined);

  it("passes claim IDs the ticket's claims files hold, each looked up once", () => {
    const seen: string[] = [];
    const counted = (name: string) => (seen.push(name), store(name));
    expect(claimFindings('Cites 2026-10-04-03-count-words#C1 and 2026-10-04-03-count-words#C5, then #C1 again: 2026-10-04-03-count-words#C1.', counted)).toEqual([]);
    expect(seen).toEqual(['2026-10-04-03-count-words', '2026-10-04-03-count-words']);
    expect(claimFindings('No claim cited here.', store)).toEqual([]);
  });

  it("refuses a claim ID whose claims file is not in the ticket's research, or that names a claim the file lacks", () => {
    expect(claimFindings('It does (2026-10-01-other#C2).\nAnd 2026-10-04-03-count-words#C9.\n', store)).toEqual([
      { message: "2026-10-01-other#C2 cites 2026-10-01-other.md, which is not among this ticket's claims files" },
      { message: '2026-10-04-03-count-words#C9 cites a claim 2026-10-04-03-count-words.md does not hold' },
    ]);
  });

  it('matches the whole ID: C1 is not C10, and an ID glued to a longer word is no citation', () => {
    expect(claimFindings('2026-10-04-03-count-words#C10', store)).toEqual([{ message: '2026-10-04-03-count-words#C10 cites a claim 2026-10-04-03-count-words.md does not hold' }]);
    expect(claimFindings('x2026-10-04-03-count-words#C9', store)).toEqual([]);
  });
});
