# 03 Count words

Status: ready-for-agent (2026-10-04)

Add `wordCount(text: string): number` in `src/word-count.ts`. It counts runs of non-space
characters. This fixture ticket has no plan in the tracker: its plan waits for approval on the
briefing page (fixtures/approvals), so the briefing read-back has a real ticket to move. Without
that waiting plan, the controller's planning step drafts one (ticket 16).

## Acceptance criteria
- [ ] When a text is given, the system shall return the number of runs of non-space characters in it.
- [ ] If the text is empty or only whitespace, then the system shall return 0.

## Acceptance tests
File: tests/protected/word-count.test.ts
```ts
import { expect, it } from 'vitest';
import { wordCount } from '../../src/word-count.ts';

it('counts the words, whatever the spacing', () => {
  expect(wordCount('  one two\tthree\n')).toBe(3);
  expect(wordCount('')).toBe(0);
});
```

## Comments
