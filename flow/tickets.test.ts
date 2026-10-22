import { describe, expect, it } from 'vitest';
import { appendComment, extractAcceptanceTests, parseTicket, selectBuildable, setStatus } from './tickets.ts';

const ticket = `# 01 Add slugify

Status: planned (2026-10-03)
Label: wayfinder:task

## Plan
Write slugify.

## Comments
`;

describe('parseTicket', () => {
  it('reads the id from the file name and the title and leading status token', () => {
    expect(parseTicket('01-add-slugify.md', ticket)).toEqual({
      id: '01',
      file: '01-add-slugify.md',
      title: 'Add slugify',
      status: 'planned',
      text: ticket,
    });
  });

  it('reports a missing status line as an empty status', () => {
    expect(parseTicket('02-x.md', '# 02 X\n').status).toBe('');
  });

  it('falls back to the file name for the title when there is no heading', () => {
    expect(parseTicket('02-x.md', 'Status: planned\n').title).toBe('02-x.md');
  });

  it('uses the whole file name as the id when it has no dash', () => {
    expect(parseTicket('README.md', '# Readme\n').id).toBe('README.md');
  });

  it('takes a heading without a number as the title', () => {
    expect(parseTicket('02-x.md', '# Add slugify\n').title).toBe('Add slugify');
  });

  it('strips a one-digit number and extra spaces around it from the title', () => {
    expect(parseTicket('7-x.md', '# 7 Add slugify\n').title).toBe('Add slugify');
    expect(parseTicket('7-x.md', '#   07   Add slugify   \n').title).toBe('Add slugify');
  });

  it('only reads a heading or a status at the start of a line, not a mention in prose', () => {
    const text = 'See issue # 5 upstream.\n# 03 Fix the Status: parser\n\nStatus: planned\n';
    const parsed = parseTicket('03-fix.md', text);
    expect(parsed.title).toBe('Fix the Status: parser');
    expect(parsed.status).toBe('planned');
  });

  it('reads a status token written without a space after the colon', () => {
    expect(parseTicket('02-x.md', 'Status:claimed\n').status).toBe('claimed');
  });
});

describe('setStatus', () => {
  it('replaces the whole status line with the new token and a date', () => {
    const next = setStatus(ticket, 'claimed', '2026-10-04');
    expect(next).toContain('Status: claimed (2026-10-04)\n');
    expect(next).not.toContain('planned');
  });

  it('refuses a ticket without a status line instead of guessing where to write', () => {
    expect(() => setStatus('# 02 X\n', 'claimed', '2026-10-04')).toThrow(/no Status line/);
  });

  it('rewrites only the Status line, not a Status: mention in prose', () => {
    const text = '# 03 Fix the Status: parser\n\nStatus: planned (2026-10-03)\n';
    expect(setStatus(text, 'claimed', '2026-10-04')).toBe('# 03 Fix the Status: parser\n\nStatus: claimed (2026-10-04)\n');
  });
});

describe('appendComment', () => {
  it('appends a dated comment under ## Comments', () => {
    const next = appendComment(ticket, 'Escalated: Stop gate blocked twice.', '2026-10-04');
    expect(next).toBe(`${ticket}- 2026-10-04: Escalated: Stop gate blocked twice.\n`);
  });

  it('appends after earlier comments, and accepts trailing spaces on the heading, keeping one section', () => {
    const text = '# 02 X\n\n## Comments  \n- 2026-10-01: first\n';
    expect(appendComment(text, 'second', '2026-10-04')).toBe(`${text}- 2026-10-04: second\n`);
  });

  it('creates the Comments section when it is missing', () => {
    expect(appendComment('# 02 X\n', 'note', '2026-10-04')).toBe('# 02 X\n\n## Comments\n- 2026-10-04: note\n');
  });

  it('ends an unterminated last line before adding the section', () => {
    expect(appendComment('# 02 X', 'note', '2026-10-04')).toBe('# 02 X\n\n## Comments\n- 2026-10-04: note\n');
  });

  it('does not mistake a longer heading or a mid-line mention for the Comments section', () => {
    const text = '# 02 X\n\n## Comments archive\nSee ## Comments\n';
    expect(appendComment(text, 'note', '2026-10-04')).toBe(`${text}\n## Comments\n- 2026-10-04: note\n`);
  });
});

describe('extractAcceptanceTests', () => {
  const withTests = `# 01 X

## Acceptance tests
File: tests/protected/a.test.ts
\`\`\`ts
it('a', () => {});
\`\`\`

File: tests/protected/b.test.ts
\`\`\`ts
it('b', () => {});
\`\`\`

## Comments
`;

  it('returns each File: line with the code block under it', () => {
    expect(extractAcceptanceTests(withTests)).toEqual([
      { path: 'tests/protected/a.test.ts', content: "it('a', () => {});\n" },
      { path: 'tests/protected/b.test.ts', content: "it('b', () => {});\n" },
    ]);
  });

  it('returns nothing when the ticket has no acceptance tests', () => {
    expect(extractAcceptanceTests('# 01 X\n')).toEqual([]);
  });

  it('refuses a path outside tests/protected/, so a ticket cannot write anywhere it likes', () => {
    const bad = 'File: src/evil.ts\n```ts\nx\n```\n';
    expect(() => extractAcceptanceTests(bad)).toThrow(/tests\/protected/);
  });

  it('refuses path traversal', () => {
    const bad = 'File: tests/protected/../../src/x.ts\n```ts\nx\n```\n';
    expect(() => extractAcceptanceTests(bad)).toThrow(/tests\/protected/);
  });

  it('refuses backslash traversal, which the / check alone would miss', () => {
    const bad = 'File: tests/protected/a\\..\\..\\src\\x.ts\n```ts\nx\n```\n';
    expect(() => extractAcceptanceTests(bad)).toThrow(/tests\/protected/);
  });

  it('refuses a path that only contains tests/protected/ further down', () => {
    const bad = 'File: src/tests/protected/x.ts\n```ts\nx\n```\n';
    expect(() => extractAcceptanceTests(bad)).toThrow(/tests\/protected/);
  });

  it('accepts a nested folder under tests/protected/', () => {
    const nested = 'File: tests/protected/sub/a.test.ts\n```ts\nx\n```\n';
    expect(extractAcceptanceTests(nested)).toEqual([{ path: 'tests/protected/sub/a.test.ts', content: 'x\n' }]);
  });

  it('tolerates no space after File: and trailing spaces after the path', () => {
    const loose = 'File:tests/protected/a.test.ts  \n```ts\nx\n```\n';
    expect(extractAcceptanceTests(loose)).toEqual([{ path: 'tests/protected/a.test.ts', content: 'x\n' }]);
  });

  it('ends the block only at a fence that starts a line, so code may contain ``` mid-line', () => {
    const text = "File: tests/protected/a.test.ts\n```ts\nconst fence = '```';\n```\n";
    expect(extractAcceptanceTests(text)).toEqual([{ path: 'tests/protected/a.test.ts', content: "const fence = '```';\n" }]);
  });

  it('ignores a File: mention in the middle of a line', () => {
    expect(extractAcceptanceTests('Note: File: tests/protected/a.test.ts\n```ts\nx\n```\n')).toEqual([]);
  });
});

describe('selectBuildable', () => {
  const t = (id: string, status: string) => ({ id, file: `${id}.md`, title: id, status, text: '' });

  it('takes planned tickets in id order, up to the limit', () => {
    const picked = selectBuildable([t('03', 'planned'), t('01', 'planned'), t('02', 'claimed'), t('04', 'planned')], 2);
    expect(picked.map((x) => x.id)).toEqual(['01', '03']);
  });
});
