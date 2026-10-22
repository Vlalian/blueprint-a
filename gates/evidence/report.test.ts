import { describe, expect, it } from 'vitest';
import { evidenceKind, reportProblems } from './report.ts';

const GOOD = {
  claim: 'The briefing page reads well on a phone.',
  evidence: 'docs/evidence/14-phone.png',
  kind: 'screenshot',
  capturedAt: '2026-10-04T10:00:00.000Z',
  observed: 'Every card fits the 390 px width; no horizontal scroll.',
  verdict: 'pass',
};

describe('evidenceKind', () => {
  it('reads a screenshot or a recording from the file extension, in any case', () => {
    expect(['a.png', 'a.jpg', 'a.jpeg', 'a.webp', 'A.PNG'].map(evidenceKind)).toEqual(Array(5).fill('screenshot'));
    expect(['a.mp4', 'a.webm', 'a.mov', 'a.gif', 'b/A.MOV'].map(evidenceKind)).toEqual(Array(5).fill('recording'));
  });

  it('reads nothing else as evidence', () => {
    expect(['a.json', 'a.png.txt', 'apng', 'a.', 'png', 'a.svg', ''].map(evidenceKind)).toEqual(Array(7).fill(undefined));
  });
});

describe('reportProblems: the evidence report schema', () => {
  it('accepts a full report, and a recording', () => {
    expect(reportProblems(GOOD)).toEqual([]);
    expect(reportProblems({ ...GOOD, evidence: 'docs/evidence/14-flow.webm', kind: 'recording', verdict: 'fail' })).toEqual([]);
  });

  it.each([null, 'report', 3, ['claim']])('refuses %j, which is not a JSON object', (value) => {
    expect(reportProblems(value)).toEqual(['the report is not a JSON object']);
  });

  it('names every missing or empty field', () => {
    expect(reportProblems({})).toEqual([
      'claim must be the Pass when claim, as text',
      'evidence must be the repo-relative path of a screenshot (.png, .jpg, .jpeg, .webp) or a recording (.mp4, .webm, .mov, .gif)',
      'kind must be screenshot or recording',
      'capturedAt must be an ISO date and time',
      'observed must say what the evidence shows, as text',
      'verdict must be pass or fail',
    ]);
    expect(reportProblems({ ...GOOD, claim: '  ', observed: '' })).toEqual(['claim must be the Pass when claim, as text', 'observed must say what the evidence shows, as text']);
    expect(reportProblems({ ...GOOD, claim: 3, observed: ['x'] })).toEqual(['claim must be the Pass when claim, as text', 'observed must say what the evidence shows, as text']);
  });

  it.each(['/abs/a.png', 'C:/a.png', 'docs/a.png:stream.png', 'docs/../a.png', '../a.png', 'docs\\a.png', 'a.txt', 7])('refuses the evidence path %j', (evidence) => {
    expect(reportProblems({ ...GOOD, evidence })).toEqual([
      'evidence must be the repo-relative path of a screenshot (.png, .jpg, .jpeg, .webp) or a recording (.mp4, .webm, .mov, .gif)',
    ]);
  });

  it('accepts a path whose name only contains dots', () => {
    expect(reportProblems({ ...GOOD, evidence: 'docs/a..b/x.y.png' })).toEqual([]);
  });

  it('refuses a kind that does not match the file', () => {
    expect(reportProblems({ ...GOOD, kind: 'recording' })).toEqual(['kind is recording, but docs/evidence/14-phone.png is a screenshot']);
    expect(reportProblems({ ...GOOD, kind: 'photo' })).toEqual(['kind must be screenshot or recording']);
  });

  it.each(['yesterday', '2026-10-04', '2026-13-40T10:00:00Z', '+012026-10-04T10:00:00.000Z', 1759572000000, ['2026-10-04T10:00:00Z']])('refuses capturedAt %j', (capturedAt) => {
    expect(reportProblems({ ...GOOD, capturedAt })).toEqual(['capturedAt must be an ISO date and time']);
  });

  it('refuses a verdict other than pass or fail, and any field the schema does not have', () => {
    expect(reportProblems({ ...GOOD, verdict: 'ok' })).toEqual(['verdict must be pass or fail']);
    expect(reportProblems({ ...GOOD, note: 'x', by: 'me' })).toEqual(['unknown field "note"', 'unknown field "by"']);
  });
});
