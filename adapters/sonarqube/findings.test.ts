import { describe, expect, it } from 'vitest';
import { classify, compareFindings, findingOf, findingsOf, gateFor, type OurFinding } from './findings.ts';
import type { SonarIssue } from './sonarqube.ts';

const SHA = 'a'.repeat(40);

const issue = (over: Partial<SonarIssue> = {}): SonarIssue => ({
  key: 'AY1',
  rule: 'typescript:S1854',
  type: 'CODE_SMELL',
  severity: 'MAJOR',
  impacts: [],
  file: 'src/a.ts',
  line: 3,
  message: 'Remove this useless assignment.',
  status: 'OPEN',
  ...over,
});

describe('classify', () => {
  it.each([
    ['a bug', { type: 'BUG' }],
    ['a vulnerability', { type: 'VULNERABILITY' }],
    ['a reliability impact with no type', { type: undefined, impacts: [{ softwareQuality: 'RELIABILITY', severity: 'LOW' }] }],
    ['a security impact on a smell', { impacts: [{ softwareQuality: 'MAINTAINABILITY', severity: 'LOW' }, { softwareQuality: 'SECURITY', severity: 'HIGH' }] }],
  ])('is a real defect for %s', (_name, over) => {
    expect(classify(issue(over as Partial<SonarIssue>))).toBe('real-defect');
  });

  it.each([
    ['a smell', {}],
    ['a maintainability impact only', { type: undefined, impacts: [{ softwareQuality: 'MAINTAINABILITY', severity: 'HIGH' }] }],
    ['an unknown type', { type: 'SECURITY_HOTSPOT' }],
  ])('is style for %s', (_name, over) => {
    expect(classify(issue(over as Partial<SonarIssue>))).toBe('style');
  });

  it.each([
    ['resolved as a false positive', { type: 'BUG', resolution: 'FALSE-POSITIVE' }],
    ['resolved as won’t fix', { type: 'BUG', resolution: 'WONTFIX' }],
    ['with issue status FALSE_POSITIVE', { type: 'VULNERABILITY', issueStatus: 'FALSE_POSITIVE' }],
    ['with issue status ACCEPTED', { issueStatus: 'ACCEPTED' }],
  ])('is a false alarm when %s', (_name, over) => {
    expect(classify(issue(over as Partial<SonarIssue>))).toBe('false-alarm');
  });

  it('is not a false alarm for a resolution or status that only contains the words', () => {
    expect(classify(issue({ type: 'BUG', resolution: 'NOT-FALSE-POSITIVE' }))).toBe('real-defect');
    expect(classify(issue({ type: 'BUG', issueStatus: 'ACCEPTED-LATER' }))).toBe('real-defect');
    expect(classify(issue({ type: 'BUG', resolution: 'FIXED', issueStatus: 'OPEN' }))).toBe('real-defect');
  });

  it('is not a defect for a type or quality that only contains the words', () => {
    expect(classify(issue({ type: 'BUGGY' }))).toBe('style');
    expect(classify(issue({ type: 'XBUG' }))).toBe('style');
    expect(classify(issue({ impacts: [{ softwareQuality: 'SECURITY_X', severity: 'LOW' }] }))).toBe('style');
    expect(classify(issue({ impacts: [{ softwareQuality: 'XRELIABILITY', severity: 'LOW' }] }))).toBe('style');
  });
});

describe('gateFor', () => {
  it.each([
    ['secrets:S6334', 'secret-scan'],
    ['common-ts:DuplicatedBlocks', 'duplication'],
    ['common-c-sharp:DuplicatedBlocks', 'duplication'],
    ['typescript:S3776', 'onkel'],
    ['csharpsquid:S3776', 'onkel'],
    ['csharpsquid:S1541', 'onkel'],
    ['javascript:S1525', 'debug-leftovers'],
    ['typescript:S2228', 'debug-leftovers'],
    ['csharpsquid:S106', 'debug-leftovers'],
    ['typescript:S1607', 'four-checks'],
  ])('names our gate for rule %s', (rule, gate) => {
    expect(gateFor({ rule, message: 'x' })).toBe(gate);
  });

  it.each([
    ['typescript:S1854'],
    ['xsecrets:S6334'],
    ['common-ts:DuplicatedBlocksX'],
    ['xcommon-ts:DuplicatedBlocks'],
    ['typescript:S37760'],
    ['typescript:S106x'],
    ['typescript:S16070'],
    ['typescript:S15410'],
    ['typescript:S15250'],
    ['typescript:S22280'],
  ])('names none for rule %s', (rule) => {
    expect(gateFor({ rule, message: 'x' })).toBeUndefined();
  });

  it.each([
    ['Remove this Bidi control character.', 'hidden-unicode'],
    ['This file has a zero-width space.', 'hidden-unicode'],
    ['An invisible character is used here.', 'hidden-unicode'],
    ['Circular import between a and b.', 'boundaries'],
    ['circular dependency found', 'boundaries'],
    ['This creates an import cycle.', 'boundaries'],
  ])('names our gate by message when the rule does not: %s', (message, gate) => {
    expect(gateFor({ rule: 'typescript:S9999', message })).toBe(gate);
  });

  it('prefers the rule over the message', () => {
    expect(gateFor({ rule: 'secrets:S6334', message: 'circular import' })).toBe('secret-scan');
  });
});

describe('findingOf', () => {
  it('is a finding with source sonarqube, its rule, severity, file, line and triage', () => {
    expect(findingOf(issue(), SHA)).toEqual({
      kind: 'finding',
      source: 'sonarqube',
      id: 'sonarqube-AY1',
      rule: 'typescript:S1854',
      severity: 'MAJOR',
      axis: 'CODE_SMELL',
      file: 'src/a.ts',
      line: 3,
      summary: 'Remove this useless assignment.',
      classification: 'style',
      fate: 'decline',
      reason: 'style',
      sha: SHA,
    });
  });

  it('escalates a real defect and names the gate that should have caught it', () => {
    const f = findingOf(issue({ rule: 'secrets:S6334', type: 'VULNERABILITY', message: 'Make sure this token gets revoked.' }), SHA);
    expect(f).toMatchObject({ classification: 'real-defect', fate: 'escalate', reason: 'SonarQube found a real defect in new code', gate: 'secret-scan' });
  });

  it('names the gate on a smell of a kind we check too', () => {
    expect(findingOf(issue({ rule: 'typescript:S3776' }), SHA)).toMatchObject({ classification: 'style', gate: 'onkel' });
  });

  it('declines a false alarm and names no gate', () => {
    const f = findingOf(issue({ rule: 'secrets:S6334', resolution: 'FALSE-POSITIVE' }), SHA);
    expect(f).toMatchObject({ classification: 'false-alarm', fate: 'decline', reason: 'false alarm' });
    expect(f).not.toHaveProperty('gate');
  });

  it('takes the highest impact severity over the deprecated severity', () => {
    const impacts = [
      { softwareQuality: 'MAINTAINABILITY', severity: 'LOW' },
      { softwareQuality: 'RELIABILITY', severity: 'BLOCKER' },
      { softwareQuality: 'SECURITY', severity: 'MEDIUM' },
    ];
    expect(findingOf(issue({ impacts }), SHA).severity).toBe('BLOCKER');
    expect(findingOf(issue({ impacts: [{ softwareQuality: 'SECURITY', severity: 'INFO' }, { softwareQuality: 'RELIABILITY', severity: 'HIGH' }] }), SHA).severity).toBe('HIGH');
    const highest = (...severities: string[]) => findingOf(issue({ impacts: severities.map((severity) => ({ softwareQuality: 'MAINTAINABILITY', severity })) }), SHA).severity;
    expect([highest('MEDIUM', 'HIGH'), highest('LOW', 'MEDIUM'), highest('INFO', 'LOW'), highest('LOW', 'INFO')]).toEqual(['HIGH', 'MEDIUM', 'LOW', 'LOW']);
    expect([highest('HIGH', 'BLOCKER'), highest('BLOCKER', 'INFO')]).toEqual(['BLOCKER', 'BLOCKER']);
  });

  it('ranks a severity it does not know below INFO', () => {
    const highest = (...severities: string[]) => findingOf(issue({ impacts: severities.map((severity) => ({ softwareQuality: 'MAINTAINABILITY', severity })) }), SHA).severity;
    expect([highest('NEW', 'INFO'), highest('BLOCKER', 'NEW'), highest('NEW')]).toEqual(['INFO', 'BLOCKER', 'NEW']);
  });

  it('is unknown severity with neither, and names the qualities as the axis with no type', () => {
    const f = findingOf(issue({ severity: undefined, type: undefined, impacts: [] }), SHA);
    expect(f.severity).toBe('unknown');
    expect(findingOf(issue({ type: undefined, impacts: [{ softwareQuality: 'RELIABILITY', severity: 'LOW' }, { softwareQuality: 'SECURITY', severity: 'LOW' }] }), SHA).axis).toBe('RELIABILITY,SECURITY');
  });

  it('keeps a file-level issue without a line', () => {
    expect(findingOf(issue({ line: undefined }), SHA).line).toBeUndefined();
  });

  it('maps every issue', () => {
    expect(findingsOf([issue(), issue({ key: 'AY2' })], SHA).map((f) => f.id)).toEqual(['sonarqube-AY1', 'sonarqube-AY2']);
  });
});

describe('compareFindings', () => {
  const sonar = [
    findingOf(issue({ key: 'D1', rule: 'common-ts:DuplicatedBlocks', file: 'src/a.ts' }), SHA),
    findingOf(issue({ key: 'S1', rule: 'secrets:S6334', type: 'VULNERABILITY', file: 'src/b.ts' }), SHA),
    findingOf(issue({ key: 'X1', rule: 'typescript:S1854', file: 'src/c.ts' }), SHA),
    findingOf(issue({ key: 'F1', rule: 'typescript:S3776', file: 'src/d.ts', resolution: 'FALSE-POSITIVE' }), SHA),
  ];
  const ours: OurFinding[] = [
    { gate: 'duplication', file: 'src/a.ts', line: 10 },
    { gate: 'onkel', file: 'src/d.ts', line: 4 },
    { gate: 'secret-scan', file: 'src/z.ts' },
    { gate: 'hardener', file: 'src/a.ts' },
  ];

  it('counts an escape where SonarQube raised what one of our gates checks and ours found nothing there', () => {
    expect(compareFindings(sonar, ours).escapes.map((f) => f.id)).toEqual(['sonarqube-S1']);
  });

  it('records each of ours SonarQube did not raise; a false alarm of its own does not count as raised', () => {
    expect(compareFindings(sonar, ours).oursOnly).toEqual([ours[1], ours[2], ours[3]]);
  });

  it('counts per gate what each side raised and what both did', () => {
    expect(compareFindings(sonar, ours).overlap).toEqual([
      { gate: 'duplication', sonarqube: 1, ours: 1, both: 1 },
      { gate: 'hardener', sonarqube: 0, ours: 1, both: 0 },
      { gate: 'onkel', sonarqube: 0, ours: 1, both: 0 },
      { gate: 'secret-scan', sonarqube: 1, ours: 1, both: 0 },
    ]);
  });

  it('matches on the gate as well as the file', () => {
    const c = compareFindings([sonar[0]!], [{ gate: 'onkel', file: 'src/a.ts' }]);
    expect(c.escapes).toHaveLength(1);
    expect(c.oursOnly).toHaveLength(1);
    expect(c.overlap).toEqual([
      { gate: 'duplication', sonarqube: 1, ours: 0, both: 0 },
      { gate: 'onkel', sonarqube: 0, ours: 1, both: 0 },
    ]);
  });

  it('is empty with nothing on either side', () => {
    expect(compareFindings([], [])).toEqual({ escapes: [], oursOnly: [], overlap: [] });
  });
});
