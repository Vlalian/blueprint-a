// A bug ticket and a bug plan that pass every plan gate (ticket 51): the good fixtures with a
// `Category: bug` line in the ticket and the bug sections before the plan's Behavior list.
import { GOOD_PLAN, GOOD_TICKET } from './fixtures.ts';

export const BUG_TICKET = GOOD_TICKET.replace('Status: ready-for-agent\n', 'Status: ready-for-agent\nCategory: bug\n');

export const BUG_SECTIONS_TEXT = `## Reproduction
\`\`\`ts
it('slugifies a title with a comma', () => {
  expect(slugify('Hello, World')).toBe('hello-world');
});
\`\`\`
Fails before the fix with: expected 'hello,-world' to be 'hello-world'
Minimised: one title with one comma; the page and the router are cut.

## Hypotheses
1. The comma is not in the replaced set. Check: the repro passes once the comma is added.
2. Runs are replaced one character at a time. Check: a title with two spaces gives two hyphens.
3. The input is trimmed after the replace. Check: a leading comma leaves a leading hyphen.

## Test seam
The exported slugify function; no good test seam above it, which is a finding of this plan.

`;

export const BUG_PLAN = GOOD_PLAN.replace('## Behavior list', `${BUG_SECTIONS_TEXT}## Behavior list`);
