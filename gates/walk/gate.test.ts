import { beforeEach, describe, expect, it } from 'vitest';
import { flagsOf, gateOptions, playwrightArgs, specRun, walkGate, type WalkGateIo, type WalkGateOptions } from './gate.ts';

const DIR = '.walk/sv-50';
const HEAD = 'a'.repeat(40);
const PATCH = 'b'.repeat(40);
const FILES = [`${DIR}/walk.webm`, `${DIR}/01.png`, `${DIR}/02.png`, `${DIR}/03.png`];

const REPORT = {
  kind: 'ticket',
  ticket: 'sv-50',
  url: 'https://app-git-walk-sv-50-team.vercel.app',
  head: HEAD,
  patchId: PATCH,
  startedAt: '2026-10-04T10:00:00.000Z',
  viewport: '1280x800',
  video: `${DIR}/walk.webm`,
  stills: [`${DIR}/01.png`, `${DIR}/02.png`, `${DIR}/03.png`],
  items: [
    { id: 'AC1', source: 'criterion', claim: 'The hint says 30.', status: 'pass', observed: 'It says 30.', evidence: [{ video: `${DIR}/walk.webm`, at: 3 }] },
    { id: 'QA2', source: 'qa', claim: 'Settings save.', status: 'flag', observed: 'Saved; the toast covers the button.', evidence: [{ screenshot: `${DIR}/02.png` }] },
    { id: 'QA1', source: 'qa', claim: 'Home loads.', status: 'not-run', reason: 'not touched' },
  ],
  extras: { console: [{ text: 'Warning: key' }], pageErrors: [], network5xx: [{ url: '/api/x', status: 502 }], axe: [{ rule: 'color-contrast', impact: 'serious', target: 'button' }] },
};

const OPTS: WalkGateOptions = { report: `${DIR}/report.json`, head: HEAD, patchId: PATCH, specs: ['tests/walk/sv-50.spec.ts'], expect: { criteria: ['AC1'], qa: ['QA2'], notRun: ['QA1'] }, quarantined: [] };

function io(report: unknown = REPORT, specs = { passed: true, output: '1 passed' }) {
  const ran: string[][] = [];
  const gateIo: WalkGateIo = {
    read: () => JSON.stringify(report),
    exists: (p) => FILES.includes(p),
    runSpecs: (s) => (ran.push(s), specs),
  };
  return { gateIo, ran };
}

const items = (over: Record<string, object>) => REPORT.items.map((it) => ({ ...it, ...(over[it.id] ?? {}) }));

describe('walkGate', () => {
  it('passes a cited report bound to the current head whose pinned spec re-runs green, with its flags', () => {
    const { gateIo, ran } = io();
    expect(walkGate(OPTS, gateIo)).toEqual({
      gate: 'walk',
      pass: true,
      report: OPTS.report,
      problems: [],
      flags: [
        'QA2: Saved; the toast covers the button.',
        'console error: Warning: key',
        'network 502: /api/x',
        'axe color-contrast (serious): button',
      ],
    });
    expect(ran).toEqual([['tests/walk/sv-50.spec.ts']]);
  });

  it('fails, without running the specs, a report the evidence gate refuses', () => {
    const { gateIo, ran } = io({ ...REPORT, items: items({ AC1: { evidence: [] } }) });
    expect(walkGate(OPTS, gateIo)).toEqual({ gate: 'walk', pass: false, report: OPTS.report, problems: ['item AC1 (pass) cites no video timestamp or screenshot'], flags: [] });
    expect(ran).toEqual([]);
  });

  it('fails a broken pinned spec, quoting the end of its output', () => {
    const { gateIo } = io(REPORT, { passed: false, output: `${'x'.repeat(2000)}\n1 failed: heading "Settings" not visible` });
    const r = walkGate(OPTS, gateIo);
    expect(r.pass).toBe(false);
    expect(r.problems).toEqual([`the pinned specs failed after 2 retries: ${`${'x'.repeat(2000)}\n1 failed: heading "Settings" not visible`.slice(-1500)}`]);
  });

  it('fails when there is no pinned spec to run', () => {
    const { gateIo, ran } = io();
    expect(walkGate({ ...OPTS, specs: [] }, gateIo).problems).toEqual(['no pinned spec to run: the walk is not pinned']);
    expect(ran).toEqual([]);
  });

  it('fails an exploratory fail', () => {
    const { gateIo } = io({ ...REPORT, items: items({ QA2: { status: 'fail', observed: 'Save does nothing.' } }) });
    expect(walkGate(OPTS, gateIo)).toMatchObject({ pass: false, problems: ['QA2 failed: Save does nothing.'] });
  });

  it('voids a report for another head or another patch-id: a rebase means a new walk', () => {
    const { gateIo } = io();
    expect(walkGate({ ...OPTS, head: 'c'.repeat(40) }, gateIo).problems).toEqual([`the walk is bound to ${HEAD.slice(0, 10)} (patch-id ${PATCH.slice(0, 10)}), not ${'c'.repeat(10)} (patch-id ${PATCH.slice(0, 10)}): a new walk is needed`]);
    expect(walkGate({ ...OPTS, patchId: 'd'.repeat(40) }, gateIo).problems).toHaveLength(1);
  });

  it('fails a report that leaves out an expected item, or does not run a criterion', () => {
    const { gateIo } = io();
    expect(walkGate({ ...OPTS, expect: { criteria: ['AC1', 'AC2'], qa: ['QA2', 'QA5'], notRun: ['QA1', 'QA6'] } }, gateIo).problems).toEqual([
      'the report has no item AC2',
      'the report has no item QA5',
      'the report has no item QA6',
    ]);
    const skipped = io({ ...REPORT, items: items({ AC1: { status: 'not-run', reason: 'flaky', evidence: undefined } }) });
    expect(walkGate(OPTS, skipped.gateIo).problems).toEqual(['acceptance criterion AC1 must be walked, not not-run']);
  });

  it('holds an expected criterion to a criterion item that was walked, whatever the report labels it (ticket 74, finding 6)', () => {
    const asQa = io({ ...REPORT, items: items({ AC1: { source: 'qa', status: 'not-run', reason: 'skipped', evidence: undefined } }) });
    expect(walkGate(OPTS, asQa.gateIo)).toMatchObject({
      pass: false,
      problems: ['the report has no criterion item AC1: it labels AC1 qa', 'acceptance criterion AC1 must be walked, not not-run'],
    });
    const passedAsQa = io({ ...REPORT, items: items({ AC1: { source: 'qa' } }) });
    expect(walkGate(OPTS, passedAsQa.gateIo).problems).toEqual(['the report has no criterion item AC1: it labels AC1 qa']);
  });

  it('names each relabelled criterion by its own item, beside a criterion walked right, and still holds a criterion it did not expect', () => {
    const ac2 = { id: 'AC2', source: 'qa', claim: 'The total adds up.', status: 'pass', observed: 'It does.', evidence: [{ screenshot: `${DIR}/03.png` }] };
    const ac9 = { id: 'AC9', source: 'criterion', claim: 'Extra.', status: 'not-run', reason: 'later' };
    const both = io({ ...REPORT, items: [...REPORT.items, ac2, ac9] });
    expect(walkGate({ ...OPTS, expect: { ...OPTS.expect, criteria: ['AC1', 'AC2'] } }, both.gateIo).problems).toEqual([
      'the report has no criterion item AC2: it labels AC2 qa',
      'acceptance criterion AC9 must be walked, not not-run',
    ]);
  });

  it('lists quarantined specs as flags, never as runs', () => {
    const { gateIo } = io();
    const r = walkGate({ ...OPTS, quarantined: [{ id: 'QA7', issue: 'https://github.com/acme/app/issues/9' }] }, gateIo);
    expect(r.flags.at(-1)).toBe('QA7 is quarantined: https://github.com/acme/app/issues/9');
  });

  it('throws a usage error without a report', () => {
    expect(() => walkGate({ ...OPTS, report: '' }, io().gateIo)).toThrow('usage: walk --report <report.json> --head <sha> --patch-id <id> --spec <file>... [--criterion <id>]... [--qa <id>]... [--not-run <id>]... [--repo <dir>]');
  });
});

describe('flagsOf', () => {
  it('reads flag items, console and page errors, 5xx responses and axe findings', () => {
    const r = { ...REPORT, extras: { console: [{ text: 'c' }], pageErrors: [{ text: 'TypeError: x' }], network5xx: [], axe: [] }, items: items({ QA2: { status: 'pass' } }) };
    expect(flagsOf(r as never)).toEqual(['console error: c', 'page error: TypeError: x']);
  });
});

describe('playwrightArgs', () => {
  let args: string[] = [];
  beforeEach(() => {
    args = playwrightArgs('C:/app/node_modules/@playwright/test/cli.js', ['tests/walk/a.spec.ts', 'tests/walk/b.spec.ts']);
  });

  it("runs the app's own runner on the specs with 2 retries and a trace on the first retry", () => {
    expect(args).toEqual(['C:/app/node_modules/@playwright/test/cli.js', 'test', 'tests/walk/a.spec.ts', 'tests/walk/b.spec.ts', '--retries=2', '--trace=on-first-retry', '--reporter=line']);
  });
});

describe('gateOptions and specRun: the CLI wiring', () => {
  it('maps the arguments, quarantines as id=issue', () => {
    expect(
      gateOptions({ report: 'r.json', head: 'h', 'patch-id': 'p', spec: ['a.spec.ts'], criterion: ['AC1'], qa: ['QA2'], 'not-run': ['QA1'], quarantined: ['QA7=https://x/issues/1?a=b'] }),
    ).toEqual({ report: 'r.json', head: 'h', patchId: 'p', specs: ['a.spec.ts'], expect: { criteria: ['AC1'], qa: ['QA2'], notRun: ['QA1'] }, quarantined: [{ id: 'QA7', issue: 'https://x/issues/1?a=b' }] });
  });

  it('leaves what is not given empty', () => {
    expect(gateOptions({})).toEqual({ report: '', head: '', patchId: '', specs: [], expect: { criteria: [], qa: [], notRun: [] }, quarantined: [] });
  });

  it('reads a run as passed on exit 0 only, with all its output', () => {
    expect(specRun({ status: 0, stdout: 'a', stderr: 'b' })).toEqual({ passed: true, output: 'ab' });
    expect(specRun({ status: 1, stdout: '', stderr: 'x' })).toEqual({ passed: false, output: 'x' });
    expect(specRun({ status: null, stdout: '', stderr: '' }).passed).toBe(false);
  });
});
