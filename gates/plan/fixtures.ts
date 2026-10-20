// A plan that passes every plan gate, and the ticket it plans. Tests break one thing at a time.
export const GOOD_TICKET = `# 01 Add slugify

Status: ready-for-agent

## Acceptance criteria
- [ ] When a title is given, the system shall return it lowercased with runs of other characters replaced by one hyphen.
- [ ] If the title is empty, then the system shall return an empty string.
`;

export const GOOD_PLAN = `Plan for: tracker/01-add-slugify.md
Created: 2026-10-04
Status: draft

# 01 - Add slugify

## What this is
Titles need URL slugs.

## What I verified in the code
\`src/is-even.ts:1\` shows the module style; no slug code exists yet.

## Approach
New pure function in \`src/slugify.ts\`.

## Patterns to mirror
| Category | Copy from | Pattern |
|---|---|---|
| Naming | \`src/is-even.ts:1\` | exported named function |
| Tests | none: new pattern | |

## Behavior list

### 1. Lowercases and hyphenates
\`\`\`ts
it('turns a title into a slug', () => {
  expect(slugify('Hello, World')).toBe('hello-world');
});
\`\`\`
Fails before implementation with: Cannot find module '../../src/slugify.ts'

### 2. Empty stays empty
\`\`\`ts
it('returns an empty string for an empty title', () => {
  expect(slugify('')).toBe('');
});
\`\`\`
Fails before implementation with: Cannot find module '../../src/slugify.ts'

## Acceptance criteria -> behaviors
- When a title is given, the system shall return it lowercased with runs of other characters replaced by one hyphen. -> behaviors 1
- If the title is empty, then the system shall return an empty string. -> behaviors 2

## Out of scope
None.

## Risks for an unattended build
None.

## Needs the owner's own eyes
None.

Run \`npm test\` and \`npx tsc --noEmit\` before stopping.
`;

// One broken plan or ticket per rule from the group-2 decisions (#31, #38, #42, #46): each fails
// exactly one plan gate with exactly one finding (gate.test.ts).
export const BROKEN = {
  /** #31: template text left in the plan. */
  placeholder: { plan: GOOD_PLAN.replace('### 2. Empty stays empty', '### 2. <behavior>'), ticket: GOOD_TICKET },
  /** #31: a behaviour whose test block asserts nothing. */
  noAssertion: { plan: GOOD_PLAN.replace("  expect(slugify('')).toBe('');\n", "  slugify('');\n"), ticket: GOOD_TICKET },
  /** #38: a ticket criterion in EARS form that leans on a vague word. */
  vagueCriterion: {
    plan: GOOD_PLAN.replace('return an empty string.', 'return an empty string quickly.'),
    ticket: GOOD_TICKET.replace('return an empty string.', 'return an empty string quickly.'),
  },
  /** #42: npm run build is off the default allowlist. */
  buildCommand: { plan: GOOD_PLAN.replace('Run `npm test` and', 'Run `npm run build`, `npm test` and'), ticket: GOOD_TICKET },
  /** #42: an allowed command with an argument that is neither a test path nor -t <name>. */
  commandArguments: { plan: GOOD_PLAN.replace('Run `npm test` and', 'Run `npx vitest run --config evil.ts` and'), ticket: GOOD_TICKET },
  /** #46: a file named without a slash that does not exist. */
  slashlessPath: { plan: GOOD_PLAN.replace('`src/is-even.ts:1` shows', '`package.json:3` and `src/is-even.ts:1` show'), ticket: GOOD_TICKET },
  /** #46: a path that climbs out of the repo. */
  parentPath: { plan: GOOD_PLAN.replace('New pure function in `src/slugify.ts`.', 'New pure function in `src/slugify.ts` and `../outside/new.ts`.'), ticket: GOOD_TICKET },
  /** #46: a file under Approach that does not exist and is not said to be new. */
  madeUpApproachFile: { plan: GOOD_PLAN.replace('New pure function in `src/slugify.ts`.', 'New pure function in `src/slugify.ts`.\nChange `src/made-up.ts` to call it.'), ticket: GOOD_TICKET },
  /** #46: a section written twice. */
  duplicateSection: { plan: GOOD_PLAN.replace('## Risks', '## Out of scope\nAlso none.\n\n## Risks'), ticket: GOOD_TICKET },
};
