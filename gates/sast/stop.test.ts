import { describe, expect, it } from 'vitest';
import type { SastResult } from './gate.ts';
import { changedInDiff, sastCheck, sastFor } from './stop.ts';

const diff = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,0 +2,2 @@',
  '+x();',
  '+y();',
  'diff --git a/Api/B.cs b/Api/B.cs',
  '--- a/Api/B.cs',
  '+++ b/Api/B.cs',
  '@@ -3,0 +4 @@',
  '+z();',
  'diff --git a/gone.ts b/gone.ts',
  '--- a/gone.ts',
  '+++ /dev/null',
  '@@ -1 +0,0 @@',
  '-w();',
].join('\n');

const finding = { rule: 'r', severity: 'ERROR', file: 'src/a.ts', line: 2, message: 'bad' };

describe('changedInDiff', () => {
  it('names each file the diff adds lines to, once', () => {
    expect(changedInDiff(diff)).toEqual(['src/a.ts', 'Api/B.cs']);
  });
});

describe('sastCheck', () => {
  it('passes with nothing to say when nothing new blocks', () => {
    expect(sastCheck({ gate: 'sast', pass: true, findings: [], warnings: [] })).toEqual({ name: 'sast', command: 'Semgrep security rules (gates/sast) on the changed source files', exitCode: 0, tail: '' });
  });

  it('fails naming each blocking finding, with the warnings and how to suppress one', () => {
    const c = sastCheck({ gate: 'sast', pass: false, findings: [finding], warnings: [{ ...finding, severity: 'WARNING' }] });
    expect(c.exitCode).toBe(1);
    expect(c.tail).toBe(
      [
        'New security findings; fix them, or suppress one on its line with a reason: // nosemgrep: <rule> -- <reason>',
        'BLOCKING src/a.ts:2 r (ERROR): bad',
        'reported src/a.ts:2 r (WARNING): bad',
      ].join('\n'),
    );
  });

  it('reports warnings on a pass', () => {
    expect(sastCheck({ gate: 'sast', pass: true, warnings: [{ ...finding, severity: 'WARNING' }] }).tail).toBe('reported src/a.ts:2 r (WARNING): bad');
  });

  it('could not run: exit 2 with what to install', () => {
    expect(sastCheck({ gate: 'sast', pass: false, error: 'install semgrep' })).toMatchObject({ exitCode: 2, tail: 'could not run: install semgrep' });
  });
});

describe('sastFor', () => {
  const ran: string[][] = [];
  const run = (files: string[]): SastResult => (ran.push(files), { gate: 'sast', pass: true });

  it('runs the gate on the diff\'s files when the project turns it on', () => {
    expect(sastFor(diff, { sast: true }, run)).toEqual({ gate: 'sast', pass: true });
    expect(ran.at(-1)).toEqual(['src/a.ts', 'Api/B.cs']);
  });

  it('runs nothing when the project leaves it off, runs it as a check itself, or there is no diff', () => {
    const count = ran.length;
    expect(sastFor(diff, {}, run)).toBeUndefined();
    expect(sastFor(diff, { sast: false }, run)).toBeUndefined();
    expect(sastFor(diff, { sast: true, checks: { sast: 'node gates/sast/cli.ts' } }, run)).toBeUndefined();
    expect(sastFor(undefined, { sast: true }, run)).toBeUndefined();
    expect(ran.length).toBe(count);
  });

  it('runs it when only an inherited check is named sast', () => {
    expect(sastFor(diff, { sast: true, checks: Object.create({ sast: 'x' }) }, run)).toBeDefined();
  });
});
