import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BROKEN, GOOD_PLAN } from './fixtures.ts';
import { behaviours, lintPlan, REQUIRED_SECTIONS, sections, TEMPLATE_PLACEHOLDERS } from './lint.ts';

const messages = (plan: string) => lintPlan(plan).map((f) => f.message);

describe('lintPlan', () => {
  it('passes a complete plan', () => {
    expect(lintPlan(GOOD_PLAN)).toEqual([]);
  });

  it('requires the three header lines', () => {
    expect(messages(GOOD_PLAN.replace('Created: 2026-10-04\n', ''))).toEqual(['missing header line "Created:"']);
  });

  it('requires every section, named exactly', () => {
    expect(messages(GOOD_PLAN.replace('## Out of scope\n', '## Scope\n'))).toContain('missing section "## Out of scope"');
  });

  it('requires the sections in the template order', () => {
    const swapped = GOOD_PLAN.replace('## Approach', '## TEMP').replace('## What this is', '## Approach').replace('## TEMP', '## What this is');
    expect(messages(swapped)).toContain('section "## Approach" is out of order');
  });

  it('refuses an empty section', () => {
    expect(messages(GOOD_PLAN.replace('## Risks for an unattended build\nNone.\n', '## Risks for an unattended build\n\n'))).toEqual([
      'section "## Risks for an unattended build" is empty (write "None." if there is nothing)',
    ]);
  });

  it('requires at least one behaviour, numbered 1, 2, 3 without gaps', () => {
    expect(messages(GOOD_PLAN.replace('### 2. Empty', '### 3. Empty'))).toEqual(['behaviours must be numbered 1..n in order; found 1, 3']);
    const none = GOOD_PLAN.slice(0, GOOD_PLAN.indexOf('### 1.')) + GOOD_PLAN.slice(GOOD_PLAN.indexOf('## Acceptance'));
    expect(messages(none)).toContain('the behavior list has no behaviours');
  });

  it('requires real test code and the expected failure for each behaviour', () => {
    const noCode = GOOD_PLAN.replace("```ts\nit('returns an empty string", "it('returns an empty string").replace("toBe('');\n});\n```", "toBe('');\n});");
    expect(messages(noCode)).toContain('behaviour 2 has no ```ts test block');
    expect(messages(GOOD_PLAN.replace("Fails before implementation with: Cannot find module '../../src/slugify.ts'\n\n### 2", '\n### 2'))).toContain(
      'behaviour 1 does not say how it fails before implementation',
    );
  });

  it('lists the sections it enforces', () => {
    expect(REQUIRED_SECTIONS).toHaveLength(9);
  });

  it('names the first and last header lines when they are missing', () => {
    expect(messages(GOOD_PLAN.replace('Plan for: tracker/01-add-slugify.md\n', '').replace('Status: draft\n', ''))).toEqual([
      'missing header line "Plan for:"',
      'missing header line "Status:"',
    ]);
  });

  it('names every section that sits before one it should follow', () => {
    const swapped = GOOD_PLAN.replace('## Approach', '## TEMP').replace('## What this is', '## Approach').replace('## TEMP', '## What this is');
    expect(messages(swapped)).toEqual(['section "## What I verified in the code" is out of order', 'section "## Approach" is out of order']);
  });

  it('reports only the missing section when the behavior list is absent', () => {
    expect(messages(GOOD_PLAN.replace('## Behavior list', '## Behaviours'))).toEqual(['missing section "## Behavior list"']);
  });

  it('needs words after "Fails before implementation with:", on a line of its own', () => {
    const blank = GOOD_PLAN.replace(/Fails before implementation with: Cannot find module '..\/..\/src\/slugify.ts'\n\n## Acceptance/, 'Fails before implementation with:\n\n## Acceptance');
    expect(messages(blank)).toEqual(['behaviour 2 does not say how it fails before implementation']);
    const tight = GOOD_PLAN.replace('with: Cannot', 'with:Cannot');
    expect(messages(tight)).toEqual([]);
    const midLine = GOOD_PLAN.replace("Fails before implementation with: Cannot find module '../../src/slugify.ts'\n\n### 2", "Note: Fails before implementation with: x\n\n### 2");
    expect(messages(midLine)).toEqual(['behaviour 1 does not say how it fails before implementation']);
  });
});

describe('lintPlan, leftover template text (#31)', () => {
  const template = readFileSync(join(import.meta.dirname, '..', '..', 'templates', 'plan.md'), 'utf8');

  it('refuses the unfilled template, naming each line with template text', () => {
    const found = messages(template);
    expect(found).toContain('line 1: leftover template text "<path to the ticket>"');
    expect(found).toContain('line 2: leftover template text "YYYY-MM-DD"');
    expect(found).toContain('line 5: leftover template text "<title>"');
    expect(found).toContain('line 19: leftover template text "path:line"');
    expect(found).toContain('line 28: leftover template text "<behavior>"');
    expect(found).toContain('behaviour 1\'s test block has no assertion (expect( or assert)');
  });

  it('knows every <...> placeholder the template ships with', () => {
    const shipped = [...template.matchAll(/<[^>\n]+>/g)].map((m) => m[0]);
    expect(shipped.length).toBeGreaterThan(0);
    expect(shipped.filter((p) => !TEMPLATE_PLACEHOLDERS.includes(p))).toEqual([]);
  });

  it.each(TEMPLATE_PLACEHOLDERS)('refuses the template placeholder %s', (placeholder) => {
    expect(messages(GOOD_PLAN.replace('Titles need URL slugs.', `Titles need ${placeholder}.`))).toEqual([`line 8: leftover template text "${placeholder}"`]);
  });

  it.each([
    ['<TODO: fill in>', '<TODO: fill in>'],
    ['<add tbd here>', '<add tbd here>'],
    ['<Placeholder>', '<Placeholder>'],
    ['a TODO left', 'TODO'],
    ['still TBD.', 'TBD'],
    ['PLACEHOLDER', 'PLACEHOLDER'],
  ])('refuses ECC\'s placeholder shapes: %s', (text, hit) => {
    expect(messages(GOOD_PLAN.replace('Titles need URL slugs.', text))).toEqual([`line 8: leftover template text "${hit}"`]);
  });

  it.each(['todos and tbd in prose', 'TODOS', 'a <b>bold</b> tag', 'Array<string>', 'XTODO', 'it.todo'])('accepts look-alikes: %s', (text) => {
    expect(messages(GOOD_PLAN.replace('Titles need URL slugs.', text))).toEqual([]);
  });

  it('reports one finding per line, the first placeholder on it', () => {
    expect(messages(GOOD_PLAN.replace('Titles need URL slugs.', '<title> and TODO\nTBD'))).toEqual([
      'line 8: leftover template text "<title>"',
      'line 9: leftover template text "TBD"',
    ]);
  });
});

describe('lintPlan, an assertion per behaviour (#31)', () => {
  it('refuses a behaviour whose test block asserts nothing', () => {
    expect(messages(BROKEN.noAssertion.plan)).toEqual(["behaviour 2's test block has no assertion (expect( or assert)"]);
  });

  it.each(['expect(x).toBe(1);', 'assert(x);', 'assert.equal(x, 1);', 'assert.strictEqual(x, 1);', 'await expect(p).rejects.toThrow();'])('accepts %s as an assertion', (line) => {
    expect(messages(BROKEN.noAssertion.plan.replace("  slugify('');\n", `  ${line}\n`))).toEqual([]);
  });

  it.each(['myexpect(x);', '// expect it to be empty', 'reassert(x);', 'assertion(x);', 'expect (x)'])('does not take %s for an assertion', (line) => {
    expect(messages(BROKEN.noAssertion.plan.replace("  slugify('');\n", `  ${line}\n`))).toEqual(["behaviour 2's test block has no assertion (expect( or assert)"]);
  });

  it('counts an assertion in any of the behaviour\'s ts blocks, but not in other fences or prose', () => {
    const second = BROKEN.noAssertion.plan.replace("Fails before implementation with: Cannot find module '../../src/slugify.ts'\n\n## Acceptance", "```ts\nexpect(slugify('')).toBe('');\n```\nFails before implementation with: x\n\n## Acceptance");
    expect(messages(second)).toEqual([]);
    const prose = BROKEN.noAssertion.plan.replace("Fails before implementation with: Cannot find module '../../src/slugify.ts'\n\n## Acceptance", "expect(slugify('')).toBe('');\n```text\nexpect(1)\n```\nFails before implementation with: x\n\n## Acceptance");
    expect(messages(prose)).toEqual(["behaviour 2's test block has no assertion (expect( or assert)"]);
  });

  it('does not ask for an assertion when the behaviour has no test block at all', () => {
    const noCode = GOOD_PLAN.replace("```ts\nit('returns an empty string", "it('returns an empty string").replace("toBe('');\n});\n```", "toBe('');\n});");
    expect(messages(noCode)).toEqual(['behaviour 2 has no ```ts test block']);
  });
});

describe('sections', () => {
  it('splits on ## headings, dropping the preamble, trims titles, and reads a last heading with no newline', () => {
    expect(sections('Preamble\n## A  \nbody\n### Sub\n## B')).toEqual([
      { title: 'A', body: 'body\n### Sub\n' },
      { title: 'B', body: '' },
    ]);
  });
});

describe('behaviours', () => {
  it('reads ### N. headings that start a line, with multi-digit numbers and deeper headings kept in the body', () => {
    expect(behaviours('#### 5. Note\nx\n### 1. A\ny\n#### Detail\nz\n### 10. B\nw\n')).toEqual([
      { n: 1, title: 'A', body: 'y\n#### Detail\nz\n' },
      { n: 10, title: 'B', body: 'w\n' },
    ]);
  });

  it('reads the title after the number, trimmed, and an empty one as empty (ticket 36)', () => {
    expect(behaviours('### 1.   Lowercases it  \nx\n### 2.\ny\n').map((b) => b.title)).toEqual(['Lowercases it', '']);
  });
});
