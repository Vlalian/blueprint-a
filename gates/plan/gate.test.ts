import { describe, expect, it } from 'vitest';
import { BUG_PLAN, BUG_TICKET } from './bug-fixtures.ts';
import { BROKEN, GOOD_PLAN, GOOD_TICKET } from './fixtures.ts';
import { join } from 'node:path';
import { claimsIn, planGate } from './gate.ts';

const io = { readPlan: () => GOOD_PLAN, readTicket: () => GOOD_TICKET, exists: (p: string) => p === 'src/is-even.ts' };

const NONE = { lint: [], 'cross-artifact': [], ears: [], commands: [], facts: [] };

describe('planGate', () => {
  it('passes a good plan, reporting each of the five checks', () => {
    expect(planGate({ plan: 'p.md', ticket: 't.md' }, io)).toEqual({
      gate: 'plan',
      pass: true,
      checks: { lint: [], 'cross-artifact': [], ears: [], commands: [], facts: [] },
    });
  });

  it('fails a plan that states an API fact without a claim ID, and passes it once it cites one (ticket 24)', () => {
    const uncited = GOOD_PLAN.replace('## Out of scope\n', '## Out of scope\nThe slug API strips accents.\n');
    const failed = planGate({ plan: 'p.md', ticket: 't.md' }, { ...io, readPlan: () => uncited });
    expect(failed.pass).toBe(false);
    expect(failed.checks).toEqual({ ...NONE, facts: [{ message: expect.stringContaining('states an outside or API fact without a claim ID') }] });
    const cited = uncited.replace('strips accents.', 'strips accents (2026-10-04-slug-api#C1).');
    expect(planGate({ plan: 'p.md', ticket: 't.md' }, { ...io, readPlan: () => cited }).pass).toBe(true);
  });

  it("looks every cited claim ID up in the ticket's claims files when it is given them (ticket 35)", () => {
    const cited = GOOD_PLAN.replace('## Out of scope\n', '## Out of scope\nThe slug API strips accents (2026-10-04-slug-api#C1).\n');
    const claims = (name: string) => (name === '2026-10-04-slug-api' ? '## Claims\n| ID | Tier | Claim | Source | Quote | Date |\n|---|---|---|---|---|---|\n| C1 | Unknown | x | - | - | 2026-10-04 |\n' : undefined);
    expect(planGate({ plan: 'p.md', ticket: 't.md' }, { ...io, readPlan: () => cited, claims }).pass).toBe(true);
    const missing = planGate({ plan: 'p.md', ticket: 't.md' }, { ...io, readPlan: () => cited, claims: () => undefined });
    expect(missing.checks).toEqual({ ...NONE, facts: [{ message: "2026-10-04-slug-api#C1 cites 2026-10-04-slug-api.md, which is not among this ticket's claims files" }] });
  });

  it('reads a claims file by name from the folder it is given, and has no lookup without one', () => {
    const read = (p: string) => `text of ${p}`;
    expect(claimsIn(join('state', 'research', 'sample', '01'), read)!('2026-10-04-x')).toBe(`text of ${join('state', 'research', 'sample', '01', '2026-10-04-x.md')}`);
    expect(claimsIn(undefined, read)).toBeUndefined();
  });

  it("lints a bug ticket's plan for the bug sections (ticket 51)", () => {
    expect(planGate({ plan: 'p.md', ticket: 't.md' }, { ...io, readPlan: () => BUG_PLAN, readTicket: () => BUG_TICKET })).toEqual({ gate: 'plan', pass: true, checks: NONE });
    const thin = planGate({ plan: 'p.md', ticket: 't.md' }, { ...io, readTicket: () => BUG_TICKET });
    expect(thin.checks).toEqual({ ...NONE, lint: [{ message: 'missing section "## Reproduction" (the ticket is a bug)' }, { message: 'missing section "## Hypotheses" (the ticket is a bug)' }, { message: 'missing section "## Test seam" (the ticket is a bug)' }] });
  });

  it('fails when any one check has findings, and says which', () => {
    const result = planGate({ plan: 'p.md', ticket: 't.md' }, { ...io, readPlan: () => `${GOOD_PLAN}\n\`git push --force\`\n` });
    expect(result.pass).toBe(false);
    expect(result.checks.commands).toEqual([{ message: 'command not on the allowlist: git push --force' }]);
    expect(result.checks.lint).toEqual([]);
  });

  it('runs EARS on the ticket criteria', () => {
    const ticket = '# 01 X\n\n## Acceptance criteria\n- Make it fast.\n';
    expect(planGate({ plan: 'p.md', ticket: 't.md' }, { ...io, readTicket: () => ticket }).checks.ears).toHaveLength(1);
  });

  it('uses an extra allowlist entry the project adds', () => {
    const plan = `${GOOD_PLAN}\n\`npm run e2e\`\n`;
    expect(planGate({ plan: 'p.md', ticket: 't.md', allow: ['npm run e2e'] }, { ...io, readPlan: () => plan }).pass).toBe(true);
    expect(planGate({ plan: 'p.md', ticket: 't.md', allow: ['npm run build'] }, { ...io, readPlan: () => BROKEN.buildCommand.plan }).pass).toBe(true);
  });

  it.each([
    ['placeholder', 'lint', 'line 32: leftover template text "<behavior>"'],
    ['noAssertion', 'lint', "behaviour 2's test block has no assertion (expect( or assert)"],
    [
      'vagueCriterion',
      'ears',
      'criterion uses the vague word "quickly"; name what is measured or checked instead: "If the title is empty, then the system shall return an empty string quickly."',
    ],
    ['buildCommand', 'commands', 'command not on the allowlist: npm run build'],
    ['commandArguments', 'commands', 'command not on the allowlist: npx vitest run --config evil.ts'],
    ['slashlessPath', 'cross-artifact', 'cited file does not exist: package.json'],
    ['parentPath', 'cross-artifact', 'cited path leaves the repo: ../outside/new.ts'],
    ['madeUpApproachFile', 'cross-artifact', 'Approach names a file that does not exist and does not say it is new: src/made-up.ts'],
    ['duplicateSection', 'cross-artifact', 'section "## Out of scope" appears more than once'],
  ] as const)('fails the broken fixture %s on %s alone, with one finding', (name, check, message) => {
    const { plan, ticket } = BROKEN[name];
    const result = planGate({ plan: 'p.md', ticket: 't.md' }, { ...io, readPlan: () => plan, readTicket: () => ticket });
    expect(result.pass).toBe(false);
    expect(result.checks).toEqual({ ...NONE, [check]: [{ message }] });
  });

  it('throws a usage error without --plan and --ticket', () => {
    expect(() => planGate({ plan: 'p.md' }, io)).toThrow(/usage: plan --plan/);
  });
});
