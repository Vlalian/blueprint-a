import { describe, expect, it } from 'vitest';
import { cliGate, evidenceGate, walkEvidenceGate, type EvidenceIo } from './gate.ts';

const REPORT = {
  claim: 'The briefing page reads well on a phone.',
  evidence: 'docs/evidence/14-phone.png',
  kind: 'screenshot',
  capturedAt: '2026-10-04T10:00:00.000Z',
  observed: 'Every card fits the 390 px width.',
  verdict: 'pass',
};

const io = (report: unknown, files: string[] = ['docs/evidence/14-phone.png']): EvidenceIo => ({
  read: () => (typeof report === 'string' ? report : JSON.stringify(report)),
  exists: (p) => files.includes(p),
});

describe('evidenceGate', () => {
  it('passes a valid report whose evidence file exists and whose verdict is pass', () => {
    expect(evidenceGate({ report: 'r.json' }, io(REPORT))).toEqual({ gate: 'evidence', pass: true, report: 'r.json', problems: [] });
  });

  it('fails a report that is not JSON', () => {
    const r = evidenceGate({ report: 'r.json' }, io('{nope'));
    expect(r.pass).toBe(false);
    expect(r.problems).toEqual([expect.stringMatching(/^the report is not valid JSON: /)]);
  });

  it('fails a report that breaks the schema, without looking for its file', () => {
    const looked: string[] = [];
    const r = evidenceGate({ report: 'r.json' }, { ...io({ ...REPORT, verdict: 'ok' }), exists: (p) => (looked.push(p), true) });
    expect(r).toMatchObject({ pass: false, problems: ['verdict must be pass or fail'] });
    expect(looked).toEqual([]);
  });

  it('fails when the screenshot or recording it names was never saved', () => {
    expect(evidenceGate({ report: 'r.json' }, io(REPORT, [])).problems).toEqual(['the evidence file docs/evidence/14-phone.png does not exist']);
  });

  it('fails a report whose verdict is fail, quoting what was observed', () => {
    expect(evidenceGate({ report: 'r.json' }, io({ ...REPORT, verdict: 'fail', observed: 'Cards overflow.' })).problems).toEqual([
      'the evidence shows the claim does not hold: Cards overflow.',
    ]);
  });

  it('checks the claim word for word when one is given', () => {
    expect(evidenceGate({ report: 'r.json', claim: REPORT.claim }, io(REPORT)).pass).toBe(true);
    expect(evidenceGate({ report: 'r.json', claim: 'Another claim.' }, io(REPORT)).problems).toEqual([
      'the report is for another claim: "The briefing page reads well on a phone."',
    ]);
  });

  it('throws a usage error without --report, which the shell turns into exit 2', () => {
    expect(() => evidenceGate({}, io(REPORT))).toThrow('usage: evidence --report <report.json> [--claim <text>] [--repo <dir>]');
  });
});

describe('walkEvidenceGate (ticket 23)', () => {
  const WALK = {
    kind: 'staging',
    ticket: 'staging',
    url: 'https://app-git-dev-team.vercel.app',
    head: 'a'.repeat(40),
    patchId: 'b'.repeat(40),
    startedAt: '2026-10-04T10:00:00.000Z',
    viewport: '1280x800',
    video: 'w/v.webm',
    stills: ['w/1.png', 'w/2.png', 'w/3.png'],
    items: [{ id: 'QA1', source: 'qa', claim: 'Home loads.', status: 'pass', observed: 'It loads.', evidence: [{ screenshot: 'w/1.png' }] }],
    extras: { console: [], pageErrors: [], network5xx: [], axe: [] },
  };
  const files = ['w/v.webm', 'w/1.png', 'w/2.png', 'w/3.png'];

  it('passes a walk report whose every item cites saved media', () => {
    expect(walkEvidenceGate({ walk: 'w/report.json' }, io(WALK, files))).toEqual({ gate: 'evidence', pass: true, report: 'w/report.json', problems: [] });
  });

  it('fails an item without evidence, and a report that is not JSON', () => {
    const bare = { ...WALK, items: [{ ...WALK.items[0], evidence: [] }] };
    expect(walkEvidenceGate({ walk: 'r.json' }, io(bare, files))).toMatchObject({ pass: false, problems: ['item QA1 (pass) cites no video timestamp or screenshot'] });
    expect(walkEvidenceGate({ walk: 'r.json' }, io('{nope', files)).problems).toEqual([expect.stringMatching(/^the report is not valid JSON: /)]);
  });

  it('fails when a cited file was never saved', () => {
    expect(walkEvidenceGate({ walk: 'r.json' }, io(WALK, files.slice(1))).problems).toEqual(['the media file w/v.webm does not exist']);
  });

  it('is what the CLI runs with --walk; without it the claim gate', () => {
    expect(cliGate({ walk: 'w/report.json' }, io(WALK, files)).pass).toBe(true);
    expect(cliGate({ report: 'w/report.json' }, io(WALK, files)).problems).toContain('claim must be the Pass when claim, as text');
  });

  it('throws a usage error without --walk', () => {
    expect(() => walkEvidenceGate({}, io(WALK))).toThrow('usage: evidence --walk <report.json> [--repo <dir>]');
  });
});
