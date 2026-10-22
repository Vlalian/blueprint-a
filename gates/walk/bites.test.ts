// Prove the walk gate bites: a cited walk bound to the head whose pinned spec re-runs green passes,
// the same walk fails once the spec goes red, and passes again once it is green.
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
  it('passes a cited, bound walk with a green pinned spec, fails it once the spec is red, passes again once it is green', () => {
    let passed = true;
    const io = { read: () => JSON.stringify(WALK), exists: (p: string) => ['w/walk.webm', ...STILLS].includes(p), runSpecs: () => ({ passed, output: '' }) };
    const opts = { report: 'w/report.json', head: SHA, patchId: SHA, specs: ['t.spec.ts'], expect: { criteria: ['AC1'], qa: [], notRun: [] }, quarantined: [] };
    const run = () => exitCodeFor(failClosed('walk', () => walkGate(opts, io)));
    expect(proveItBites({ run, inject: () => (passed = false), revert: () => (passed = true) })).toEqual(BITES);
  });
});
