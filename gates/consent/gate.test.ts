import { expect, it } from 'vitest';
import { consentCheck, type ConsentIo } from './gate.ts';

const CONFIG = { owner: 'Ada', tickets: 'docs/tickets' };
const LOCKS = ['gates/**', 'package.json'];
const AGREED = '# 9 x\nStatus: ready-for-agent\nAgreed: 2026-10-07 (Ada: "build it")\n';

function io(after: Record<string, string | undefined>, branch: string, before: Record<string, string> = {}): ConsentIo {
  return {
    changed: () => Object.keys(after),
    before: (p) => before[p],
    after: (p) => after[p],
    list: () => Object.keys(after).filter((p) => after[p] !== undefined),
    branch: () => branch,
  };
}

it('passes a change to locked paths on the branch of a ticket the owner agreed', () => {
  const change = io({ 'gates\\x.ts': 'new', 'docs/tickets/9-x.md': AGREED, 'src/a.ts': 'a' }, 'ticket/9-x');
  expect(consentCheck(change, CONFIG, LOCKS)).toEqual({ gate: 'consent', pass: true, branch: 'ticket/9-x', locked: ['gates/x.ts'], agreed: true, tickets: [] });
});

it('refuses a locked change off an agreed ticket branch, naming the paths', () => {
  const change = io({ 'package.json': '{}', 'gates/y.ts': undefined, 'src/a.ts': 'a' }, 'main');
  expect(consentCheck(change, CONFIG, LOCKS)).toEqual({ gate: 'consent', pass: false, branch: 'main', locked: ['gates/y.ts', 'package.json'], agreed: false, tickets: [] });
  const unagreed = io({ 'gates/x.ts': 'x', 'docs/tickets/9-x.md': '# 9 x\nStatus: proposed\n' }, 'ticket/9-x');
  expect(consentCheck(unagreed, CONFIG, LOCKS).pass).toBe(false);
});

it('passes a change outside the locks on any branch, and never reads a file outside the ticket folder as a ticket', () => {
  const change = io({ 'src/a.ts': 'a', 'docs/notes.md': '# notes\nStatus: ready-for-agent\n' }, 'main');
  expect(consentCheck(change, CONFIG, LOCKS)).toEqual({ gate: 'consent', pass: true, branch: 'main', locked: [], agreed: false, tickets: [] });
});

it('refuses a ticket made buildable without the owner choice, and lets a deleted or proposed ticket be', () => {
  const change = io({ 'docs/tickets/9-x.md': '# 9 x\nStatus: ready-for-agent\n', 'docs/tickets/8-y.md': undefined, 'docs/tickets/7-z.md': '# 7\nStatus: proposed\n' }, 'main', { 'docs/tickets/8-y.md': AGREED });
  const result = consentCheck(change, CONFIG, LOCKS);
  expect(result.pass).toBe(false);
  expect(result.tickets).toEqual([{ path: 'docs/tickets/9-x.md', reason: expect.stringContaining('quotes Ada choosing it') }]);
  const stood = io({ 'docs/tickets/9-x.md': '# 9 x\nStatus: ready-for-agent\nmore\n' }, 'main', { 'docs/tickets/9-x.md': '# 9 x\nStatus: ready-for-agent\n' });
  expect(consentCheck(stood, CONFIG, LOCKS).pass).toBe(true);
});
