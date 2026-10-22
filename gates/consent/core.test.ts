import { describe, expect, it } from 'vitest';
import { agreedBranch, BUILDABLE, isTicket, ownerChoice, parseConsent, readyRefusal } from './core.ts';

const OWNER = 'Ada';
const CONFIG = { owner: OWNER, tickets: 'docs/tickets' };
const ticket = (status: string, agreed?: string, rest = '') => `# 70 x\n\nStatus: ${status}\n${agreed === undefined ? '' : `Agreed: ${agreed}\n`}\n## Why\n${rest}`;

describe('ownerChoice', () => {
  it('is the Agreed line when it quotes the configured owner, in straight or curly quotes', () => {
    expect(ownerChoice(ticket('ready-for-agent', '2026-10-07 (Ada: "build it"; then picked "72")'), OWNER)).toBe('Ada: "build it"; then picked "72"');
    expect(ownerChoice(ticket('proposed', '2026-10-07 (Ada picked “63: fixes” when asked)  '), OWNER)).toBe('Ada picked “63: fixes” when asked');
  });

  it('is the Agreed line when it names an improvement the owner accepted', () => {
    expect(ownerChoice(ticket('ready-for-agent', '2026-10-05 (briefing, improvement r3-1)'), OWNER)).toBe('briefing, improvement r3-1');
  });

  it('is undefined for another owner, no quote, an empty quote, a bad date or no Agreed line', () => {
    expect(ownerChoice(ticket('ready-for-agent'), OWNER)).toBeUndefined();
    for (const agreed of ['2026-10-07 (Bob: "yes")', '2026-10-07 (Adam: "yes")', '2026-10-07 (Ada)', '2026-10-07 ("yes")', '2026-10-07 (Ada: "")', '2026-10-07 (improvement)', '2026-10-07 (an improvement r1 we liked)', 'soon (Ada: "yes")', '2026-10-07 Ada: "yes"']) {
      expect(ownerChoice(ticket('ready-for-agent', agreed), OWNER), agreed).toBeUndefined();
    }
  });

  it('takes the owner name literally, never as a pattern', () => {
    expect(ownerChoice(ticket('proposed', '2026-10-07 (AxB: "yes")'), 'A.B')).toBeUndefined();
    expect(ownerChoice(ticket('proposed', '2026-10-07 (A.B: "yes")'), 'A.B')).toBe('A.B: "yes"');
  });

  it('reads the header only, and Agreed only at the start of a line', () => {
    expect(ownerChoice(ticket('proposed', undefined, 'Agreed: 2026-10-07 (Ada: "yes")\n'), OWNER)).toBeUndefined();
    expect(ownerChoice('# x\nNote: see ## below\nAgreed: 2026-10-07 (Ada: "yes")\n', OWNER)).toBe('Ada: "yes"');
    expect(ownerChoice('# x\nNot Agreed: 2026-10-07 (Ada: "yes")\n', OWNER)).toBeUndefined();
    expect(ownerChoice('# x\nAgreed: 2026-10-07 (Ada: "yes") later\n', OWNER)).toBeUndefined();
  });
});

describe('readyRefusal', () => {
  const REFUSED = 'a ticket is buildable (needs-triage, ready-for-agent, planned, claimed, ready-for-review) only when its Agreed line quotes Ada choosing it or names an improvement Ada accepted; leave it proposed and put it to Ada as a choice';
  const chosen = '2026-10-07 (Ada: "build it")';

  it('refuses every buildable status without the owner choice, new or existing', () => {
    expect(BUILDABLE).toEqual(['needs-triage', 'ready-for-agent', 'planned', 'claimed', 'ready-for-review']);
    for (const status of BUILDABLE) {
      expect(readyRefusal(undefined, ticket(status), OWNER), status).toBe(REFUSED);
      expect(readyRefusal(ticket('proposed'), ticket(status), OWNER), status).toBe(REFUSED);
    }
    expect(readyRefusal(ticket('ready-for-agent'), ticket('planned'), OWNER)).toBe(REFUSED);
    expect(readyRefusal(ticket('ready-for-agent', chosen), ticket('ready-for-agent'), OWNER)).toBe(REFUSED);
    expect(readyRefusal(ticket('proposed'), '# 70 x\n\nStatus:planned\n', OWNER)).toBe(REFUSED);
  });

  it('allows a chosen ticket, any other status, and edits of a ticket that already stood so', () => {
    expect(readyRefusal(undefined, ticket('ready-for-agent', chosen), OWNER)).toBeUndefined();
    expect(readyRefusal(undefined, ticket('proposed'), OWNER)).toBeUndefined();
    expect(readyRefusal(ticket('ready-for-agent'), ticket('done'), OWNER)).toBeUndefined();
    expect(readyRefusal(ticket('ready-for-agent'), ticket('ready-for-agent', undefined, 'more why'), OWNER)).toBeUndefined();
    expect(readyRefusal(undefined, '# x\nOld Status: ready-for-agent\nStatus: proposed\n', OWNER)).toBeUndefined();
    expect(readyRefusal(undefined, '# x\nno status here\n', OWNER)).toBeUndefined();
  });
});

describe('agreedBranch', () => {
  const AGREED = 'Agreed: 2026-10-07 (Ada: "add the locks")';
  it.each([
    ['ticket/21-locks', 'docs/tickets/21-locks.md', AGREED, true],
    ['origin/ticket/21b-locks', 'docs\\tickets\\21b-locks.md', AGREED, true],
    ['ticket/21', 'docs/tickets/21-locks.md', AGREED, false],
    ['feature/21-locks', 'docs/tickets/21-locks.md', AGREED, false],
    ['prefix/ticket/21-locks', 'docs/tickets/21-locks.md', AGREED, false],
    ['', 'docs/tickets/undefined-locks.md', AGREED, false],
    ['ticket/21-locks', 'other/docs/tickets/21-locks.md', AGREED, false],
    ['ticket/21-locks', 'docs/tickets/sub/21-locks.md', AGREED, false],
    ['ticket/21-locks', 'docs/tickets/22-locks.md', AGREED, false],
    ['ticket/21-locks', 'docs/tickets/21-locks.md', 'Agreed: 2026-10-07 (Bob: "yes")', false],
    ['ticket/21-locks', 'docs/tickets/21-locks.md.backup', AGREED, false],
  ])('authorizes %s with %s only when its ticket records the owner choice', (branch, file, text, expected) => {
    expect(agreedBranch(branch, { list: () => [file], read: () => text }, CONFIG)).toBe(expected);
  });

  it('reads the configured ticket folder, literally', () => {
    const io = (file: string) => ({ list: () => [file], read: () => AGREED });
    expect(agreedBranch('ticket/5-x', io('work.items/5-x.md'), { owner: OWNER, tickets: 'work.items' })).toBe(true);
    expect(agreedBranch('ticket/5-x', io('workXitems/5-x.md'), { owner: OWNER, tickets: 'work.items' })).toBe(false);
    expect(agreedBranch('ticket/5-x', io('docs/tickets/5-x.md'), { owner: OWNER, tickets: 'work.items' })).toBe(false);
  });

  it('refuses a ticket branch with no ticket file, reading nothing', () => {
    expect(agreedBranch('ticket/21-locks', { list: () => [], read: () => { throw new Error('No ticket may be read'); } }, CONFIG)).toBe(false);
  });
});

describe('isTicket and parseConsent', () => {
  it('knows a ticket file of the folder', () => {
    expect(isTicket('docs/tickets/7-x.md', CONFIG)).toBe(true);
    expect(isTicket('docs/tickets/README.md', CONFIG)).toBe(false);
  });

  it('reads an owner and a ticket folder, and refuses a config missing either', () => {
    expect(parseConsent('{"owner":"Ada","tickets":"docs/tickets","extra":1}')).toEqual(CONFIG);
    expect(() => parseConsent('{"tickets":"docs/tickets"}')).toThrow('consent config needs a non-empty "owner"');
    expect(() => parseConsent('{"owner":"Ada","tickets":""}')).toThrow('consent config needs a non-empty "tickets"');
    expect(() => parseConsent('{"owner":7,"tickets":"t"}')).toThrow('"owner"');
  });
});
