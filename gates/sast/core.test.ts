import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { judged, newFindings, parseScan, PINNED_SEMGREP, ruleOf, sastSources, suppressionsIn, unpinned, type Finding } from './core.ts';

const FIXTURES = join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'sast');
const recorded = (...path: string[]) => readFileSync(join(FIXTURES, ...path), 'utf8');

const finding = (over: Partial<Finding> = {}): Finding => ({ rule: 'javascript.lang.security.detect-child-process', severity: 'ERROR', file: 'src/a.ts', line: 2, message: 'm', ...over });

describe('ruleOf', () => {
  it('strips the rules folder Semgrep puts before a local rule, wherever it was', () => {
    expect(ruleOf('rules.javascript.lang.security.detect-child-process')).toBe('javascript.lang.security.detect-child-process');
    expect(ruleOf('home.user.workflow.gates.sast.rules.csharp.lang.security.injections.os-command-injection')).toBe('csharp.lang.security.injections.os-command-injection');
    expect(ruleOf('C:.Users.me.typescript.react.security.x')).toBe('typescript.react.security.x');
  });

  it('keeps an id from another language folder as Semgrep gave it', () => {
    expect(ruleOf('my.own.rule')).toBe('my.own.rule');
    expect(ruleOf('notjavascript.x')).toBe('notjavascript.x');
  });
});

describe('parseScan', () => {
  it('reads each recorded finding with its rule, severity, file, line and message', () => {
    const scan = parseScan(recorded('bites', 'head.json'), 0);
    expect(scan.version).toBe('1.179.0');
    expect(scan.findings.map((f) => [f.rule, f.severity, f.file, f.line])).toEqual([
      ['csharp.lang.security.injections.os-command-injection', 'ERROR', 'src/Inject.cs', 10],
      ['javascript.lang.security.detect-child-process', 'ERROR', 'src/inject.ts', 4],
    ]);
    expect(scan.findings[1]!.message).toMatch(/child_process/);
    expect(scan.notScanned).toEqual([]);
  });

  it('names a file Semgrep could not parse as not scanned, without failing', () => {
    const scan = parseScan(recorded('syntax-error.json'), 0);
    expect(scan.findings).toEqual([]);
    expect(scan.notScanned).toEqual(['src/bad.ts: Syntax error']);
  });

  it('writes a Windows path with forward slashes', () => {
    const json = JSON.stringify({ version: '1', results: [{ check_id: 'a.b', path: 'src\\x.ts', start: { line: 3 }, extra: { severity: 'INFO', message: 'x' } }], errors: [] });
    expect(parseScan(json, 0).findings).toEqual([{ rule: 'a.b', severity: 'INFO', file: 'src/x.ts', line: 3, message: 'x' }]);
  });

  it('throws Semgrep\'s errors when it exits non-zero', () => {
    expect(() => parseScan(recorded('no-config.json'), 7)).toThrow(/Semgrep exited 7: WARNING: unable to find a config.*\ninvalid configuration file found/s);
  });

  it('throws when it exits non-zero with nothing to say, or is killed', () => {
    expect(() => parseScan('', 2)).toThrow('Semgrep exited 2: no JSON on stdout');
    expect(() => parseScan('{"results":[],"errors":[]}', null)).toThrow('Semgrep exited null: no errors reported');
  });

  it('throws on output that is not Semgrep\'s JSON', () => {
    expect(() => parseScan('not json', 0)).toThrow('Semgrep gave no JSON on stdout');
    expect(() => parseScan('{"errors":[]}', 0)).toThrow('Semgrep gave no JSON on stdout');
    expect(() => parseScan('{"results":[]}', 0)).toThrow('Semgrep gave no JSON on stdout');
    expect(() => parseScan('null', 0)).toThrow('Semgrep gave no JSON on stdout');
  });

  it('names as not scanned only the errors that name a file', () => {
    const json = JSON.stringify({ version: '1', results: [], errors: [{ level: 'warn', type: 'Rule warning', message: 'm' }, { level: 'warn', type: 'Syntax error', path: 'a.ts' }] });
    expect(parseScan(json, 0).notScanned).toEqual(['a.ts: Syntax error']);
  });

  it('reads a scan without a version as version unknown', () => {
    expect(parseScan('{"results":[],"errors":[]}', 0).version).toBe('unknown');
  });
});

describe('unpinned', () => {
  it('says nothing for the pinned version and names any other', () => {
    expect(unpinned(PINNED_SEMGREP)).toBeUndefined();
    expect(unpinned('1.100.0')).toBe(`Semgrep 1.100.0 is running; the rules were pinned with ${PINNED_SEMGREP}, so results may differ`);
  });
});

describe('sastSources', () => {
  it('keeps the TypeScript, JavaScript and C# files a change touched', () => {
    const files = ['src/a.ts', 'src/b.tsx', 'src/c.js', 'src/d.mjs', 'src/e.cjs', 'src/f.jsx', 'src/g.mts', 'src/h.cts', 'Api/Run.cs', 'README.md', 'x.json', 'a.css'];
    expect(sastSources(files)).toEqual(['src/a.ts', 'src/b.tsx', 'src/c.js', 'src/d.mjs', 'src/e.cjs', 'src/f.jsx', 'src/g.mts', 'src/h.cts', 'Api/Run.cs']);
  });

  it('leaves out tests and anything in a fixtures folder', () => {
    expect(sastSources(['src/a.test.ts', 'src/b.spec.ts', 'test/fixtures/sast/x.ts', 'fixtures/y.cs', 'src/myfixtures/z.ts'])).toEqual(['src/myfixtures/z.ts']);
  });
});

describe('suppressionsIn', () => {
  it('reads the rule and the reason of each nosemgrep comment, by line', () => {
    const text = ['a', 'x(); // nosemgrep: detect-child-process -- our own input', '  # nosemgrep: r1, r2 --  two  ', '/* nosemgrep */'].join('\n');
    expect(suppressionsIn(text)).toEqual([
      { line: 2, rules: ['detect-child-process'], reason: 'our own input', alone: false },
      { line: 3, rules: ['r1', 'r2'], reason: 'two', alone: true },
      { line: 4, rules: [], reason: '', alone: true },
    ]);
  });

  it('reads a suppression without a reason, and one with an empty reason', () => {
    expect(suppressionsIn('x(); // nosemgrep: rule-a\r\ny(); // nosemgrep: rule-b --   ')).toEqual([
      { line: 1, rules: ['rule-a'], reason: '', alone: false },
      { line: 2, rules: ['rule-b'], reason: '', alone: false },
    ]);
  });

  it('reads the comment without spaces, with a reason after its first --, and closed as a block comment', () => {
    expect(suppressionsIn('x(); //nosemgrep:rule-a --why -- not --')).toEqual([{ line: 1, rules: ['rule-a'], reason: 'why -- not --', alone: false }]);
    expect(suppressionsIn('/* nosemgrep: rule-a -- why */  ')).toEqual([{ line: 1, rules: ['rule-a'], reason: 'why', alone: true }]);
    expect(suppressionsIn('# nosemgrep:rule-a   --  why')).toEqual([{ line: 1, rules: ['rule-a'], reason: 'why', alone: true }]);
  });

  it('ignores the word outside a comment', () => {
    expect(suppressionsIn("const s = 'nosemgrep: x -- y';\n//nosemgrepped")).toEqual([]);
  });
});

describe('judged', () => {
  const texts = (file: string, text: string) => new Map([[file, text]]);

  it('suppresses a finding on the comment\'s line by its short or full rule id, with a reason', () => {
    const f = finding({ line: 2 });
    for (const rule of ['detect-child-process', 'javascript.lang.security.detect-child-process']) {
      const j = judged([f], texts('src/a.ts', `a\nx(); // nosemgrep: ${rule} -- ours`));
      expect(j).toEqual({ kept: [], suppressed: [{ ...f, reason: 'ours' }] });
    }
  });

  it('suppresses a finding on the line under a comment that stands alone', () => {
    const f = finding({ line: 3 });
    expect(judged([f], texts('src/a.ts', 'a\n  // nosemgrep: detect-child-process -- ours\nx();')).kept).toEqual([]);
  });

  it('keeps a finding under a comment that ends a line of code, or two lines below', () => {
    expect(judged([finding({ line: 3 })], texts('src/a.ts', 'a\ny(); // nosemgrep: detect-child-process -- ours\nx();')).kept).toHaveLength(1);
    expect(judged([finding({ line: 4 })], texts('src/a.ts', 'a\n// nosemgrep: detect-child-process -- ours\n\nx();')).kept).toHaveLength(1);
  });

  it('suppresses a finding one of several named rules covers', () => {
    expect(judged([finding()], texts('src/a.ts', 'a\nx(); // nosemgrep: other-rule, detect-child-process -- ours')).kept).toEqual([]);
  });

  it('keeps a finding the comment names another rule for, or a part of its id', () => {
    expect(judged([finding()], texts('src/a.ts', 'a\nx(); // nosemgrep: other-rule -- ours')).kept).toHaveLength(1);
    expect(judged([finding()], texts('src/a.ts', 'a\nx(); // nosemgrep: child-process -- ours')).kept).toHaveLength(1);
    expect(judged([finding()], texts('src/b.ts', 'a\nx(); // nosemgrep: detect-child-process -- ours')).kept).toHaveLength(1);
  });

  it('makes a suppression without a reason or a rule a blocking finding, and lets it suppress nothing', () => {
    const f = finding();
    const j = judged([f], texts('src/a.ts', 'a\nx(); // nosemgrep: detect-child-process\n// nosemgrep -- why'));
    expect(j.suppressed).toEqual([]);
    expect(j.kept).toEqual([
      f,
      { rule: 'sast.suppression-without-reason', severity: 'ERROR', file: 'src/a.ts', line: 2, message: 'a nosemgrep comment needs the rule id and a reason: nosemgrep: <rule> -- <reason>' },
      { rule: 'sast.suppression-without-reason', severity: 'ERROR', file: 'src/a.ts', line: 3, message: 'a nosemgrep comment needs the rule id and a reason: nosemgrep: <rule> -- <reason>' },
    ]);
  });

  it('judges a file it has no text for as unsuppressed', () => {
    expect(judged([finding()], new Map()).kept).toEqual([finding()]);
  });
});

describe('newFindings', () => {
  const head = 'a\nx = cp.exec(h);\n';

  it('keeps a finding the base does not have', () => {
    expect(newFindings({ findings: [finding()], texts: new Map([['src/a.ts', head]]) }, { findings: [], texts: new Map() })).toEqual([finding()]);
  });

  it('drops a finding the base has on the same code, wherever the line moved', () => {
    const base = { findings: [finding({ line: 1 })], texts: new Map([['src/a.ts', '  x = cp.exec(h);']]) };
    expect(newFindings({ findings: [finding()], texts: new Map([['src/a.ts', head]]) }, base)).toEqual([]);
  });

  it('keeps a finding when the base has it for another rule, file or code', () => {
    const texts = new Map([['src/a.ts', head]]);
    const other = (over: Partial<Finding>, text = head) => ({ findings: [finding(over)], texts: new Map([[over.file ?? 'src/a.ts', text]]) });
    expect(newFindings({ findings: [finding()], texts }, other({ rule: 'x' }))).toHaveLength(1);
    expect(newFindings({ findings: [finding()], texts }, other({ file: 'src/b.ts' }))).toHaveLength(1);
    expect(newFindings({ findings: [finding()], texts }, other({}, 'a\ny = cp.exec(h);'))).toHaveLength(1);
  });

  it('counts copies: a second copy of base code is new', () => {
    const twice = 'x = cp.exec(h);\nx = cp.exec(h);';
    const head2 = { findings: [finding({ line: 1 }), finding({ line: 2 })], texts: new Map([['src/a.ts', twice]]) };
    const base = { findings: [finding({ line: 1 })], texts: new Map([['src/a.ts', 'x = cp.exec(h);']]) };
    expect(newFindings(head2, base)).toEqual([finding({ line: 2 })]);
  });

  it('keeps the rule and the file apart in a finding\'s identity', () => {
    const one = { findings: [finding({ rule: 'xy', file: 'z' })], texts: new Map([['z', 'a\nx']]) };
    const two = { findings: [finding({ rule: 'x', file: 'yz' })], texts: new Map([['yz', 'a\nx']]) };
    expect(newFindings(one, two)).toHaveLength(1);
  });

  it('reads a line past the end of the text as an empty line', () => {
    const head = { findings: [finding({ line: 9 })], texts: new Map([['src/a.ts', 'a']]) };
    const base = { findings: [finding({ line: 2 })], texts: new Map([['src/a.ts', 'a\n']]) };
    expect(newFindings(head, base)).toEqual([]);
  });

  it('compares by line number when it has no text for the file', () => {
    expect(newFindings({ findings: [finding()], texts: new Map() }, { findings: [finding()], texts: new Map() })).toEqual([]);
    expect(newFindings({ findings: [finding()], texts: new Map() }, { findings: [finding({ line: 5 })], texts: new Map() })).toHaveLength(1);
  });
});
