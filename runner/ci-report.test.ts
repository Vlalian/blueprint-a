import { describe, expect, it } from 'vitest';
import { DEFAULTS } from './runner-config.ts';
import { cloudGateReport, judgeCloudReport, parseCloudReport, reportBranch, reportPath, sessionBranch, trustLine, ungradedPaths, type CloudGateReport } from './ci-report.ts';

const TIP = 'b'.repeat(40);
const HEAD = 'a'.repeat(40);
const PATH = 'cloud-runs/ticket-7.gate.json';

const green: CloudGateReport = {
  branch: 'ticket/7',
  base: 'c'.repeat(40),
  head: HEAD,
  clean: true,
  verdict: 'pass',
  files: ['scripts/a.ts'],
  mutants: { killed: 12, total: 12 },
  survivors: [],
  suppressions: [],
  timeouts: { count: 0, waitMs: 0 },
  highestCrap: 3,
  mutationSkipped: false,
};

const CONFIG = { ...DEFAULTS, report: { ...DEFAULTS.report, dir: 'cloud-runs' } };
const UNGRADED = ungradedPaths(CONFIG);
const facts = { tip: TIP, changedSinceGate: ['cloud-runs/ticket-7.jsonl', 'docs/tickets/7.md'], baseOnBranch: true, ungraded: UNGRADED };

describe('the CI report: where it is, and what may change after it (ticket 83)', () => {
  it("is one file per branch in the configured folder, the branch's slashes as dashes", () => {
    expect(reportPath(CONFIG, 'ticket/7-seven')).toBe('cloud-runs/ticket-7-seven.gate.json');
    expect(reportPath(DEFAULTS, 'feature/x')).toBe('gate-reports/feature-x.gate.json');
  });

  it('names the file by the configured pattern, {branch} standing for the branch', () => {
    const named = (name: string) => ({ ...DEFAULTS, report: { ...DEFAULTS.report, name } });
    expect(reportPath(named('gate-{branch}.json'), 'feature/x')).toBe('gate-reports/gate-feature-x.json');
    expect(reportPath(named('{branch}/{branch}.json'), 'x')).toBe('gate-reports/x/x.json');
  });

  it('finds the same file for a pipeline ref, a remote branch and a local one', () => {
    const want = 'gate-reports/my-branch.gate.json';
    expect(reportPath(DEFAULTS, 'refs/heads/my-branch')).toBe(want);
    expect(reportPath(DEFAULTS, 'origin/my-branch')).toBe(want);
    expect(reportPath(DEFAULTS, 'refs/remotes/origin/my-branch')).toBe(want);
    expect(reportPath(DEFAULTS, 'my-branch')).toBe(want);
    expect(reportPath(DEFAULTS, 'refs/heads/feature/x')).toBe(reportPath(DEFAULTS, 'origin/feature/x'));
  });

  it('leaves the report folder and the configured ungraded paths ungraded', () => {
    expect(ungradedPaths(CONFIG)).toEqual(['cloud-runs/', 'docs/']);
    expect(ungradedPaths({ ...DEFAULTS, report: { ...DEFAULTS.report, ungraded: ['*.md'] } })).toEqual(['gate-reports/', '*.md']);
  });
});

describe('sessionBranch — the branch as the run that built it named it', () => {
  it("drops a remote's prefix, so origin/ticket/7 finds ticket/7's report", () => {
    expect(sessionBranch('origin/ticket/7')).toBe('ticket/7');
    expect(sessionBranch('refs/remotes/origin/ticket/7')).toBe('ticket/7');
    expect(sessionBranch('ticket/7')).toBe('ticket/7');
    expect(sessionBranch('ticket/origin/7')).toBe('ticket/origin/7');
  });

  it('drops refs/heads/ (an Azure DevOps or GitHub pull request ref) and any refs/remotes/<remote>/', () => {
    expect(sessionBranch('refs/heads/my-branch')).toBe('my-branch');
    expect(sessionBranch('refs/heads/origin/x')).toBe('origin/x');
    expect(sessionBranch('refs/remotes/upstream/ticket/7')).toBe('ticket/7');
    expect(sessionBranch('xrefs/heads/y')).toBe('xrefs/heads/y');
  });
});

describe('parseCloudReport', () => {
  it('reads a report', () => {
    expect(parseCloudReport(JSON.stringify(green), PATH)).toEqual(green);
  });

  it('says the report is missing', () => {
    expect(parseCloudReport(undefined, PATH)).toEqual({ reason: `no ${PATH} on the branch` });
  });

  it('says a report is unreadable: not JSON, or missing a field the trust check needs', () => {
    expect(parseCloudReport('{', PATH)).toEqual({ reason: `${PATH} is not a gate report` });
    expect(parseCloudReport('null', PATH)).toEqual({ reason: `${PATH} is not a gate report` });
    for (const field of ['base', 'head', 'clean', 'verdict', 'survivors', 'mutants'] as const) {
      const { [field]: _gone, ...rest } = green;
      expect(parseCloudReport(JSON.stringify(rest), PATH)).toEqual({ reason: `${PATH} is not a gate report` });
    }
    expect(parseCloudReport(JSON.stringify({ ...green, mutants: { killed: 1 } }), PATH)).toEqual({ reason: `${PATH} is not a gate report` });
    expect(parseCloudReport(JSON.stringify({ ...green, mutants: { total: 1 } }), PATH)).toEqual({ reason: `${PATH} is not a gate report` });
    expect(parseCloudReport(JSON.stringify({ ...green, survivors: 'none' }), PATH)).toEqual({ reason: `${PATH} is not a gate report` });
    expect(parseCloudReport(JSON.stringify({ ...green, clean: 'yes' }), PATH)).toEqual({ reason: `${PATH} is not a gate report` });
  });
});

describe('judgeCloudReport — trust, verified, not assumed', () => {
  it('trusts a green report of the tip, changed since only in its carry-back files and docs', () => {
    expect(judgeCloudReport(green, facts)).toBeNull();
    expect(judgeCloudReport({ ...green, head: TIP }, { ...facts, changedSinceGate: [] })).toBeNull();
  });

  it('refuses a stale report: the tip changed code since the gated commit', () => {
    expect(judgeCloudReport(green, { ...facts, changedSinceGate: ['docs/x.md', 'scripts/a.ts', 'scripts/a.test.ts'] })).toBe(
      'stale: it gated aaaaaaaa, and the tip bbbbbbbb changed scripts/a.ts, scripts/a.test.ts since',
    );
  });

  it('counts only the report folder and the ungraded paths at the root as ungraded', () => {
    for (const path of ['scripts/docs/a.ts', 'docsite/a.ts', 'cloud-runsx/a.ts', 'docs']) {
      expect(judgeCloudReport(green, { ...facts, changedSinceGate: [path] })).toBe(`stale: it gated aaaaaaaa, and the tip bbbbbbbb changed ${path} since`);
    }
  });

  it('refuses a report whose gated commit git cannot compare with the tip', () => {
    expect(judgeCloudReport(green, { ...facts, changedSinceGate: undefined })).toBe('stale: git cannot compare its gated commit aaaaaaaa with the tip bbbbbbbb');
  });

  it('refuses a gate run on uncommitted changes: its commit is not what it gated', () => {
    expect(judgeCloudReport({ ...green, clean: false }, facts)).toBe('the CI gate ran on uncommitted changes');
  });

  it('refuses a gate measured from a base that is not on the branch merged into: lines before it were never graded', () => {
    expect(judgeCloudReport(green, { ...facts, baseOnBranch: false })).toBe('it graded the change since cccccccc, which is not on the branch being merged into');
  });

  it('refuses a red report: a failed gate, a survivor, or fewer kills than mutants', () => {
    expect(judgeCloudReport({ ...green, verdict: 'fail' }, facts)).toBe('red: the CI gate failed');
    expect(judgeCloudReport({ ...green, survivors: [{ file: 'a', line: 1, mutator: 'm', status: 'Survived' }] }, facts)).toBe('red: 1 surviving mutant(s)');
    expect(judgeCloudReport({ ...green, mutants: { killed: 11, total: 12 } }, facts)).toBe('red: 11 of 12 mutants killed');
  });
});

describe('trustLine — the summary says which mutation ran and why', () => {
  it('names the trusted report', () => {
    expect(trustLine({ trusted: true, tip: TIP, report: green, path: PATH })).toBe(
      `mutation: only the lines that differ from bbbbbbbb; the rest is trusted from ${PATH} (gated aaaaaaaa, 12/12 mutants killed)`,
    );
  });

  it('says why it fell back to full changed-line mutation', () => {
    expect(trustLine({ trusted: false, reason: 'stale: x' })).toBe('mutation: every changed line (no trusted CI report: stale: x)');
  });
});

describe('reportBranch — which branch a run writes its gate report for', () => {
  it('is the --report branch when given', () => {
    expect(reportBranch('ticket/7', {}, 'other', 'CI')).toBe('ticket/7');
  });

  it('is the checked-out branch in a CI run, as the configured variable tells it', () => {
    expect(reportBranch(undefined, { CI: 'true' }, 'ticket/7\n', 'CI')).toBe('ticket/7');
    expect(reportBranch(undefined, { BUILD_RUN: 'true' }, 'ticket/7\n', 'BUILD_RUN')).toBe('ticket/7');
    expect(reportBranch(undefined, { CI: 'true' }, 'ticket/7\n', 'BUILD_RUN')).toBeUndefined();
  });

  it('is none outside CI, or on a detached head', () => {
    expect(reportBranch(undefined, {}, 'ticket/7', 'CI')).toBeUndefined();
    expect(reportBranch(undefined, { CI: 'false' }, 'ticket/7', 'CI')).toBeUndefined();
    expect(reportBranch(undefined, { CI: 'true' }, 'HEAD\n', 'CI')).toBeUndefined();
    expect(reportBranch(undefined, { CI: 'true' }, '', 'CI')).toBeUndefined();
  });
});

describe('cloudGateReport — what a CI gate run writes', () => {
  const onkel = { verdict: 'pass' as const, files: ['scripts/a.ts'], mutants: { killed: 2, total: 2 }, survivors: [], suppressions: [], timeouts: { count: 0, waitMs: 0 }, highestCrap: 2, mutationSkipped: false };
  const run = { branch: 'ticket/7', base: 'c'.repeat(40), head: HEAD, status: ' M docs/tickets/7.md\n?? cloud-runs/ticket-7.gate.json\n' };

  it("is onkel's result with the branch, base, head, whether the work tree was clean and the whole gate's verdict", () => {
    expect(cloudGateReport(run, onkel, 0, UNGRADED)).toEqual({ ...onkel, branch: 'ticket/7', base: 'c'.repeat(40), head: HEAD, clean: true, verdict: 'pass' });
  });

  it('is not clean with a change to anything but the ungraded paths', () => {
    expect(cloudGateReport({ ...run, status: ' M scripts/a.ts\n' }, onkel, 0, UNGRADED).clean).toBe(false);
    expect(cloudGateReport({ ...run, status: '?? scripts/new.ts\n' }, onkel, 0, UNGRADED).clean).toBe(false);
    expect(cloudGateReport(run, onkel, 0, ['docs/']).clean).toBe(false);
  });

  it('fails when any stage failed, whatever onkel said', () => {
    expect(cloudGateReport(run, onkel, 1, UNGRADED).verdict).toBe('fail');
    expect(cloudGateReport(run, onkel, 2, UNGRADED).verdict).toBe('fail');
  });

  it('is an empty green report when there was nothing for onkel to grade', () => {
    expect(cloudGateReport(run, undefined, 0, UNGRADED)).toEqual({
      branch: 'ticket/7',
      base: 'c'.repeat(40),
      head: HEAD,
      clean: true,
      verdict: 'pass',
      files: [],
      mutants: { killed: 0, total: 0 },
      survivors: [],
      suppressions: [],
      timeouts: { count: 0, waitMs: 0 },
      highestCrap: 0,
      mutationSkipped: false,
    });
  });
});
