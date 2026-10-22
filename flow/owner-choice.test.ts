import { describe, expect, it } from 'vitest';
import { ticketNumberOf, ticketsNamed, workflowCodeIn } from './owner-choice.ts';

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
