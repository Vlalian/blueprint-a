// Prove the walk gate bites: a cited walk bound to the head with its criterion passed passes, the
// same walk fails once the criterion is seen to fail, and passes again once it passes.
import { describe, expect, it } from 'vitest';
import { BITES, proveItBites } from '../../test/helpers/prove-it-bites.ts';
import { exitCodeFor, failClosed } from '../lib/contract.ts';
import { walkGate } from './gate.ts';

const SHA = 'c'.repeat(40);
const STILLS = ['w/1.png', 'w/2.png', 'w/3.png'];
const WALK = {
  kind: 'ticket',
  ticket: 't-1',
  url: 'https://preview.example.test',
  head: SHA,
  patchId: SHA,
  startedAt: '2026-10-20T10:00:00.000Z',
  viewport: '1280x800',
  video: 'w/walk.webm',
  stills: STILLS,
  items: [{ id: 'AC1', source: 'criterion', claim: 'The form saves.', status: 'pass', observed: 'It saves.', evidence: [{ screenshot: 'w/1.png' }] }],
  extras: { console: [], pageErrors: [], network5xx: [], axe: [] },
};

describe('the walk gate bites', () => {
  it('passes a cited, bound walk, fails it once its criterion fails, passes again once it passes', () => {
    let status = 'pass';
    const io = { read: () => JSON.stringify({ ...WALK, items: [{ ...WALK.items[0], status }] }), exists: (p: string) => ['w/walk.webm', ...STILLS].includes(p) };
    const opts = { report: 'w/report.json', head: SHA, patchId: SHA, expect: { criteria: ['AC1'], qa: [], notRun: [] }, quarantined: [] };
    const run = () => exitCodeFor(failClosed('walk', () => walkGate(opts, io)));
    expect(proveItBites({ run, inject: () => (status = 'fail'), revert: () => (status = 'pass') })).toEqual(BITES);
  });
});
