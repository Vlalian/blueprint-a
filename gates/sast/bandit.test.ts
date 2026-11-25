import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { banditSources, nosecFindings, parseBandit } from './bandit.ts';

// What bandit 1.9.4 (`bandit -f json -q <file>`) wrote for src/run.py with shell=True, eval, assert
// and an import of subprocess; trimmed to the fields the gate reads.
const DIR = join('/work', 'app');
const result = (test_id: string, issue_severity: string, line_number: number, issue_text: string, filename = join(DIR, 'src', 'run.py')) => ({ test_id, test_name: 'x', issue_severity, issue_confidence: 'HIGH', filename, line_number, issue_text });
const REPORT = JSON.stringify({
  errors: [],
  results: [
    result('B404', 'LOW', 1, 'Consider possible security implications associated with the subprocess module.'),
    result('B602', 'HIGH', 5, 'subprocess call with shell=True identified, security issue.'),
    result('B307', 'MEDIUM', 9, 'Use of possibly insecure function - consider using safer ast.literal_eval.'),
  ],
});

describe('banditSources', () => {
  it('keeps changed Python source: no tests, conftest, fixtures or dist', () => {
    expect(banditSources(['src/run.py', 'tests/test_run.py', 'tests/conftest.py', 'fixtures/a.py', 'dist/a.py', 'src/a.ts', 'README.md'])).toEqual(['src/run.py']);
  });
});

describe('parseBandit', () => {
  it('blocks HIGH and MEDIUM severity as ERROR, reports LOW as WARNING, by rule, file and line from the folder it ran in', () => {
    expect(parseBandit(REPORT, 1, DIR)).toEqual({
      findings: [
        { rule: 'bandit.B404', severity: 'WARNING', file: 'src/run.py', line: 1, message: 'Consider possible security implications associated with the subprocess module. (bandit LOW, confidence HIGH)' },
        { rule: 'bandit.B602', severity: 'ERROR', file: 'src/run.py', line: 5, message: 'subprocess call with shell=True identified, security issue. (bandit HIGH, confidence HIGH)' },
        { rule: 'bandit.B307', severity: 'ERROR', file: 'src/run.py', line: 9, message: 'Use of possibly insecure function - consider using safer ast.literal_eval. (bandit MEDIUM, confidence HIGH)' },
      ],
      notScanned: [],
    });
  });

  it('names a file bandit could not parse', () => {
    const report = JSON.stringify({ errors: [{ filename: join(DIR, 'src', 'bad.py'), reason: 'syntax error while parsing AST from file' }], results: [] });
    expect(parseBandit(report, 0, DIR).notScanned).toEqual(['src/bad.py: syntax error while parsing AST from file']);
  });

  it('cannot run on another exit or output that is not its JSON', () => {
    expect(() => parseBandit('', 2, DIR)).toThrow('bandit exited 2: no JSON on stdout');
    expect(() => parseBandit('Traceback', 1, DIR)).toThrow('bandit exited 1: no JSON on stdout');
  });

  it('accepts JSON without an errors array and rejects a report without results', () => {
    expect(parseBandit('{"results":[]}', 0, DIR)).toEqual({ findings: [], notScanned: [] });
    expect(() => parseBandit('{"errors":[]}', 0, DIR)).toThrow('bandit exited 0: no JSON on stdout');
    expect(() => parseBandit('{"results":[]}', null, DIR)).toThrow('bandit exited null: no JSON on stdout');
  });
});

describe('nosecFindings', () => {
  it('requires a full test id and a nonblank reason after the delimiter', () => {
    const text = ["x = '# nosec'", 'x() # nosec B60 -- short id', 'x() # nosec B602 --   ', 'x() # nosec B602 -- valid', 'x() # nosecurity B602'];
    expect(nosecFindings(new Map([['a.py', text.join('\r\n')]]))).toEqual([
      { rule: 'sast.suppression-without-reason', severity: 'ERROR', file: 'a.py', line: 2, message: 'a # nosec comment needs the bandit test id and a reason: # nosec B602 -- <reason>' },
      { rule: 'sast.suppression-without-reason', severity: 'ERROR', file: 'a.py', line: 3, message: 'a # nosec comment needs the bandit test id and a reason: # nosec B602 -- <reason>' },
    ]);
  });
  it('blocks a # nosec without a test id or a reason, and lets one with both through', () => {
    const text = ['run(a)  # nosec', 'run(b)  # nosec B602', 'run(c)  # nosec: B602, B607 -- the command is a constant', 'run(d)  #nosec -- trusted', 'x = "# nosec"'].join('\n');
    expect(nosecFindings(new Map([['src/run.py', text]])).map((f) => [f.rule, f.line])).toEqual([
      ['sast.suppression-without-reason', 1],
      ['sast.suppression-without-reason', 2],
      ['sast.suppression-without-reason', 4],
    ]);
  });
});

it('exempts only files whose basename is conftest.py', () => {
  expect(banditSources(['conftest.py', 'src/conftest.py', 'src/conftest.py.backup.py', 'myconftest.py']))
    .toEqual(['src/conftest.py.backup.py', 'myconftest.py']);
});

it('reports corrupted JSON as a scan with no usable output', () => {
  expect(() => parseBandit('{"results": [', 0, DIR)).toThrow(new Error('bandit exited 0: no JSON on stdout'));
});

it('does not read nosec text within a string as a suppression', () => {
  expect(nosecFindings(new Map([['a.py', "message = 'quoted # nosec' # no'quoted fragment'sec"]])))
    .toEqual([]);
});
