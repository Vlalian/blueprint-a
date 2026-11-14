import { describe, expect, it } from 'vitest';
import { repoOwnerChoice, ticketNumberOf, ticketsNamed, workflowCodeIn } from './owner-choice.ts';

describe('workflowCodeIn, ticketsNamed and ticketNumberOf', () => {
  it('keeps the paths under the workflow’s code folders, either slash', () => {
    const paths = ['gates/a.ts', 'adapters/x.ts', 'dispatcher/y.ts', 'scripts/z.ts', 'skills/coder/SKILL.md', 'agents/a.json', 'config/c.json', 'templates/t.md', String.raw`gates\b.ts`];
    expect(workflowCodeIn([...paths, 'docs/tickets/64-x.md', 'README.md', 'AGENTS.md', 'docs/gates/x.md', 'state/x'])).toEqual(paths);
  });

  it('names the tickets a commit message names, once, without leading zeros', () => {
    expect(ticketsNamed('Ticket 64: guard; ticket 064 again, tickets 15B')).toEqual(['64', '15b']);
    expect(ticketsNamed('Fix the hook (#64), 64 tickets later')).toEqual([]);
  });

  it('reads the number of a ticket file or branch', () => {
    expect(ticketNumberOf('ticket/64-only-owner-changes-the-workflow')).toBe('64');
    expect(ticketNumberOf('docs/tickets/015b-gate-metrics.md')).toBe('15b');
    expect(ticketNumberOf('flow/60')).toBe('60');
    expect(ticketNumberOf('7.md')).toBe('7');
    expect(ticketNumberOf('followup/review-windows')).toBeUndefined();
    expect(ticketNumberOf('ticket/64xy')).toBeUndefined();
    expect(ticketNumberOf('MAP.md')).toBeUndefined();
    expect(ticketNumberOf('feature/v2-fix')).toBeUndefined();
    expect(ticketNumberOf('docs/tickets/7.mdx')).toBeUndefined();
  });
});

const ticket = (status: string, agreed?: string, rest = '') => `# 70 x\n\nStatus: ${status}\n${agreed === undefined ? '' : `Agreed: ${agreed}\n`}\n## Why\n${rest}`;

describe('repoOwnerChoice', () => {
  it('is the Agreed line when it quotes the owner, as tickets 62 to 66 write it', () => {
    const quoted = '2026-10-07 (the owner: "it should be a hard rule"; then picked "64: the guardrail")';
    expect(repoOwnerChoice(ticket('ready-for-agent', quoted))).toBe('the owner: "it should be a hard rule"; then picked "64: the guardrail"');
    expect(repoOwnerChoice(ticket('proposed', '2026-10-07 (the owner picked “63: Blueprint A fixes” when asked)'))).toBe('the owner picked “63: Blueprint A fixes” when asked');
    expect(repoOwnerChoice(ticket('proposed', '2026-10-07 (the owner, in chat: "run it once")  '))).toBe('the owner, in chat: "run it once"');
  });

  it('is the Agreed line when it names an improvement the owner accepted on the briefing', () => {
    expect(repoOwnerChoice(ticket('ready-for-agent', '2026-10-05 (briefing, improvement r3-1)'))).toBe('briefing, improvement r3-1');
  });

  it('is undefined without an Agreed line, or one that neither quotes the owner nor names an improvement', () => {
    expect(repoOwnerChoice(ticket('ready-for-agent'))).toBeUndefined();
    for (const agreed of ['2026-10-07 (the session judged it worth doing)', '2026-10-07 (the owner)', '2026-10-07 ("a quote, but not of the owner")', '2026-10-07 (the owner: "")', '2026-10-07 (improvement)', '2026-10-07 (an improvement r1 we liked)', 'soon (the owner: "yes")', '2026-10-07 the owner: "yes"']) {
      expect(repoOwnerChoice(ticket('ready-for-agent', agreed)), agreed).toBeUndefined();
    }
  });

  it('reads the header only: an Agreed line under a section does not count', () => {
    expect(repoOwnerChoice(ticket('proposed', undefined, 'Agreed: 2026-10-07 (the owner: "yes")\n'))).toBeUndefined();
    expect(repoOwnerChoice(`# 70 x\nAgreed: 2026-10-07 (the owner: "yes")\nStatus: proposed\n`)).toBe('the owner: "yes"');
  });

  it('is undefined when the Agreed line quotes someone other than the owner', () => {
    expect(repoOwnerChoice(ticket('ready-for-agent', '2026-10-07 (Bob: "build it")'))).toBeUndefined();
  });
});
