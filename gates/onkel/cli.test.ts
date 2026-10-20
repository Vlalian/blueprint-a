import { sep } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The gate's own shell.
 *
 * It was untested, and grading it escalated: `main` scored CRAP 56 at 0%
 * coverage. The plan made this the only module touching `fs` or spawning
 * processes, with the deciding logic in pure modules beside it — but "it is an
 * adapter" is exactly the argument every untested file makes, and the tool
 * that refuses that argument elsewhere should not accept it about itself.
 *
 * So `fs` and `child_process` are mocked and the orchestration is exercised:
 * what gets graded, what gets skipped, and which exit code a verdict produces.
 * `/build-afk` keys off that exit code, so it is the single most
 * consequential thing this module does.
 */

// Typed so a test can vary behaviour by which command was spawned.
const execFileSync = vi.fn((cmd: string, args: string[]): string => `${cmd}${args.length}` && '');
const readFileSync = vi.fn();
const existsSync = vi.fn((p: string) => p.length > 0);
const writeFileSync = vi.fn();

vi.mock('node:child_process', () => ({ execFileSync }));
vi.mock('node:fs', () => ({
  execFileSync,
  readFileSync,
  existsSync,
  mkdtempSync: vi.fn(() => '/tmp/onkel-test'),
  rmSync: vi.fn(),
  writeFileSync,
}));
vi.mock('node:os', () => ({ tmpdir: () => '/tmp' }));

const { main, MUTATION_EXEMPT } = await import('./cli.ts');

/** A source file with one trivial function. */
const SOURCE = 'export function f() { return 1; }';

/**
 * Three decisions, so that at 0% coverage it scores 3² + 3 = 12 and breaches
 * the ceiling. A complexity-1 function scores 2 uncovered and would not.
 */
const BRANCHY = 'export function f(a: number, b: number) { if (a) return 1; return b ? 2 : 3; }';

function coverageReport(covered = true) {
  return JSON.stringify({
    [`${process.cwd()}/src/a.ts`]: {
      statementMap: { '0': { start: { line: 1 }, end: { line: 1 } } },
      s: { '0': covered ? 1 : 0 },
    },
  });
}

function mutationReport(statuses: string[]) {
  return JSON.stringify({
    files: {
      'src/a.ts': {
        mutants: statuses.map((status, i) => ({
          location: { start: { line: i + 1 } },
          mutatorName: 'ConditionalExpression',
          status,
          // What Stryker writes for a comment suppression in the repo's em-dash
          // form: its own default, never the author's reason (code-health/31).
          ...(status === 'Ignored' ? { statusReason: 'Ignored using a comment' } : {}),
        })),
      },
    },
  });
}

/** A `-U0` diff that adds `lines` to each of `files` — the change under grade. */
function diffAdding(files: string[], lines = '+1'): string {
  return files
    .map((f) =>
      [`diff --git a/${f} b/${f}`, `--- a/${f}`, `+++ b/${f}`, `@@ -0,0 ${lines} @@`, '+x'].join(
        '\n',
      ),
    )
    .join('\n');
}

/** Every path a test below grades, each changed on line 1. */
const TOUCHED_LINE_1 = diffAdding([
  'src/a.ts',
  'src/b.ts',
  'scripts/quality/cli.ts',
  'src/app/[locale]/settings-actions.ts',
  'src/app/[locale]/[id]/actions.ts',
]);

type Git = { diff?: string; untracked?: string; noMergeBase?: boolean; strykerLog?: string; deleted?: string };

/** What Stryker prints when its `mutate` list resolved to one real file. */
const FOUND_ONE = 'INFO ProjectReader Found 1 of 765 file(s) to be mutated.';

/** Whether a spawned command is the Stryker run: its entry file or its config names it. */
const isStryker = (args: string[]) => args.some((a) => a.includes('stryker'));

/** Answers the three git questions `main` asks about the change. */
function git(args: string[], opts: Git): string {
  if (args.includes('merge-base')) {
    if (opts.noMergeBase) throw new Error('fatal: no merge base');
    return 'base123\n';
  }
  if (args.includes('--diff-filter=D')) return opts.deleted ?? '';
  if (args.includes('diff')) return opts.diff ?? TOUCHED_LINE_1;
  if (args.includes('ls-files')) return opts.untracked ?? '';
  return '';
}

/** Wires the two JSON reads and the source read that `main` performs, and git. */
function givenRun(opts: { mutants: string[]; covered?: boolean; source?: string } & Git) {
  readFileSync.mockImplementation((path: string) => {
    if (String(path).endsWith('coverage-final.json')) return coverageReport(opts.covered ?? true);
    if (String(path).endsWith('mutation.json')) return mutationReport(opts.mutants);
    return opts.source ?? SOURCE;
  });
  execFileSync.mockImplementation((cmd: string, args: string[]) => {
    if (cmd === 'git') return git(args, opts);
    return isStryker(args) ? (opts.strykerLog ?? FOUND_ONE) : '';
  });
}

/** The `mutate` list of the Stryker config `main` wrote, or null if it wrote none. */
function mutateList(): string[] | null {
  const call = writeFileSync.mock.calls[0];
  return call ? (JSON.parse(String(call[1])) as { mutate: string[] }).mutate : null;
}

beforeEach(() => {
  execFileSync.mockClear().mockReturnValue('');
  readFileSync.mockReset();
  existsSync.mockReset().mockReturnValue(true);
  writeFileSync.mockClear();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('main — the exit code /build-afk keys off', () => {
  it('exits 0 when every mutant died and nothing exceeds the ceiling', () => {
    givenRun({ mutants: ['Killed', 'Killed'] });

    expect(main(['src/a.ts'])).toBe(0);
  });

  it('exits 1 on a survivor', () => {
    givenRun({ mutants: ['Killed', 'Survived'] });

    expect(main(['src/a.ts'])).toBe(1);
  });

  it('lists a suppressed mutant from a gated run with its reason, and keeps the same verdict (code-health/31)', () => {
    // The Ignored mutant sits on line 2; the em-dash reason is on line 1, which
    // the diff adds, so it is new in this change.
    givenRun({
      mutants: ['Killed', 'Ignored'],
      source: '// Stryker disable next-line ConditionalExpression — equivalent\nexport function f() { return 1; }',
      diff: diffAdding(['src/a.ts'], '+1,2'),
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    log.mockClear();

    expect(main(['src/a.ts'])).toBe(0);
    const text = log.mock.calls.flat().join('\n');
    expect(text).toContain('Suppressed, new in this change:');
    expect(text).toContain('  src/a.ts:2 ConditionalExpression — equivalent');
  });

  it('exits 1 on a suppression whose comment gives no reason (code-health/33)', () => {
    // Before the fix this passed: Stryker's placeholder "Ignored using a comment" read as a reason.
    givenRun({
      mutants: ['Killed', 'Ignored'],
      source: '// Stryker disable next-line ConditionalExpression\nexport function f() { return 1; }',
      diff: diffAdding(['src/a.ts'], '+1,2'),
    });

    expect(main(['src/a.ts'])).toBe(1);
  });

  it('exits 1 on a mutant ignored by a file-level directive, and names the directive (decision #28)', () => {
    const error = vi.spyOn(console, 'log');
    error.mockClear();
    givenRun({
      mutants: ['Killed', 'Ignored'],
      source: '// Stryker disable all\nexport function f() { return 1; }',
      diff: diffAdding(['src/a.ts'], '+1,2'),
    });

    expect(main(['src/a.ts'])).toBe(1);
    const text = error.mock.calls.flat().join('\n');
    expect(text).toContain('[broad-suppression] src/a.ts:1 (directive) — Stryker disable all');
    expect(text).toContain('[broad-suppression] src/a.ts:2 ConditionalExpression — suppressed by an ignore broader than one line');
  });

  it('exits 1 on a mutant Stryker ignored with no comment above it: a config-level ignore (decision #28)', () => {
    givenRun({ mutants: ['Killed', 'Ignored'], diff: diffAdding(['src/a.ts'], '+1,2') });

    expect(main(['src/a.ts'])).toBe(1);
  });

  it('exits 1 on a status the run never settled', () => {
    // The CodeRabbit finding, end to end: an interrupted run reports Pending,
    // and this must not read as a pass.
    givenRun({ mutants: ['Pending'] });

    expect(main(['src/a.ts'])).toBe(1);
  });

  it('exits 1 when a branchy function was never covered', () => {
    // CRAP punishes coverage cubically: three decisions untested is 12, well
    // over the ceiling, where the same function fully covered would score 3.
    givenRun({ mutants: ['Killed'], covered: false, source: BRANCHY });

    expect(main(['src/a.ts'])).toBe(1);
  });

  it('skips the Stryker run when CRAP already fails, and says so (decision #40)', () => {
    const log = vi.spyOn(console, 'log');
    log.mockClear();
    givenRun({ mutants: ['Killed'], covered: false, source: BRANCHY });

    expect(main(['src/a.ts'])).toBe(1);
    expect(mutateList()).toBeNull();
    expect(execFileSync.mock.calls.some(([, args]) => isStryker(args))).toBe(false);
    const text = log.mock.calls.flat().join('\n');
    expect(text).toContain('mutation skipped: CRAP failed first');
    expect(text).toContain('[crap] src/a.ts:1 f');
    expect(text).toContain('ESCALATE — 1 problem(s)');
  });
});

describe('main — what it agrees to grade', () => {
  it('refuses to run with no paths at all', () => {
    // Grading nothing and reporting a pass is the failure this whole tool is
    // about, so an empty invocation is an error rather than a green tick.
    // Exit 2: a usage error means the gate could not run (gates/lib/contract.ts).
    expect(main([])).toBe(2);
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('ignores flags when deciding whether it was given paths', () => {
    expect(main(['--verbose'])).toBe(2);
  });

  it('skips .tsx, test files and a path that is not there because the diff deletes it', () => {
    // Every `{cond && <X/>}` is a decision point, so a ceiling of 6 would flag
    // most components while saying nothing about them.
    existsSync.mockReturnValue(false);
    givenRun({ mutants: [], deleted: 'src/gone.ts\n' });

    expect(main(['src/a.tsx', 'src/a.test.ts', 'src/gone.ts'])).toBe(0);
    expect(execFileSync.mock.calls.every(([cmd]) => cmd === 'git')).toBe(true);
  });

  it('cannot run (exit 2) when a named .ts path does not exist and the diff does not delete it (decision #37)', () => {
    // A typo in a path used to be skipped, and the run passed on the files that were left.
    const error = vi.spyOn(console, 'error');
    error.mockClear();
    existsSync.mockImplementation((p: string) => p !== 'src/typo.ts');
    givenRun({ mutants: ['Killed'], deleted: 'src/other.ts\n' });

    expect(main(['src/a.ts', 'src/typo.ts'])).toBe(2);
    expect(execFileSync.mock.calls.every(([cmd]) => cmd === 'git')).toBe(true);
    expect(error.mock.calls.flat().join(' ')).toContain('src/typo.ts does not exist and the diff does not delete it');
  });

  it('asks git which named paths the change deleted, against --base, renames counted as deletions', () => {
    existsSync.mockImplementation((p: string) => p !== 'src/gone.ts');
    givenRun({ mutants: ['Killed'], deleted: 'src/gone.ts\n' });

    expect(main(['--base', 'origin/dev', 'src/a.ts', 'src/gone.ts'])).toBe(0);
    const deletedCall = execFileSync.mock.calls.find(([cmd, args]) => cmd === 'git' && args.includes('--diff-filter=D'));
    expect(deletedCall?.[1]).toEqual(expect.arrayContaining(['--name-only', '--no-renames', 'origin/dev', '--', 'src/gone.ts']));
  });

  it('cannot run when git cannot say whether a missing path was deleted', () => {
    existsSync.mockImplementation((p: string) => p !== 'src/gone.ts');
    givenRun({ mutants: ['Killed'], noMergeBase: true });

    expect(main(['src/a.ts', 'src/gone.ts'])).toBe(2);
  });

  it('does not ask git about deletions when every named path exists', () => {
    givenRun({ mutants: ['Killed'] });

    main(['src/a.ts']);

    expect(execFileSync.mock.calls.some(([, args]) => args.includes('--diff-filter=D'))).toBe(false);
  });

  it('grades nothing, and says so, rather than passing silently', () => {
    const log = vi.spyOn(console, 'log');
    existsSync.mockReturnValue(false);

    main(['src/a.tsx']);

    expect(log.mock.calls.flat().join(' ')).toContain('Nothing to grade');
  });
});

describe('main — the Stryker run', () => {
  it('mutates only the lines the change touched', () => {
    // GATE-SCOPE: grade what the change touched. Stryker keeps a mutant only
    // when it sits wholly inside a range, so a survivor can only come from a
    // line this change wrote.
    givenRun({ mutants: ['Killed'], diff: diffAdding(['src/a.ts'], '+3,4') });

    main(['src/a.ts']);

    expect(mutateList()).toEqual(['src/a.ts:3-6']);
  });

  it('does not mutate a named file the change left alone', () => {
    givenRun({ mutants: ['Killed'], diff: diffAdding(['src/a.ts']) });

    main(['src/a.ts', 'src/b.ts']);

    expect(mutateList()).toEqual(['src/a.ts:1-1']);
  });

  it('runs no mutation, and escalates, when none of the files changed', () => {
    // Graded nothing is not graded clean. The branch already in origin/main,
    // or a --base that holds the change, would otherwise print PASS.
    const log = vi.spyOn(console, 'log');
    givenRun({ mutants: [], diff: '' });

    expect(main(['src/a.ts'])).toBe(1);
    expect(mutateList()).toBeNull();
    expect(log.mock.calls.flat().join(' ')).toContain('No line of these files changed');
  });

  it('names a file it left ungraded because the change did not touch it', () => {
    const log = vi.spyOn(console, 'log');
    givenRun({ mutants: ['Killed'], diff: diffAdding(['src/a.ts']) });

    expect(main(['src/a.ts', 'src/b.ts'])).toBe(0);
    expect(log.mock.calls.flat().join(' ')).toContain('Unchanged, not graded: src/b.ts');
  });

  it('pins the diff prefixes, so a diff.noprefix config cannot hide every path', () => {
    givenRun({ mutants: ['Killed'] });

    main(['src/a.ts']);

    const diffCall = execFileSync.mock.calls.find(
      ([cmd, args]) => cmd === 'git' && args.includes('diff'),
    );
    expect(diffCall?.[1]).toEqual(expect.arrayContaining(['--src-prefix=a/', '--dst-prefix=b/']));
  });

  it('grades a file git does not track yet from its first line to its last', () => {
    // `git diff <base>` leaves an untracked file out; read as "unchanged", a
    // brand-new module would never be graded.
    givenRun({
      mutants: ['Killed'],
      diff: '',
      untracked: 'src/a.ts\n',
      source: 'const a = 1;\nconst b = 2;\n',
    });

    main(['src/a.ts']);

    expect(mutateList()).toEqual(['src/a.ts:1-2']);
  });

  it('measures the change against --base when given one', () => {
    givenRun({ mutants: ['Killed'] });

    main(['--base', 'origin/dev', 'src/a.ts']);

    const gitCalls = execFileSync.mock.calls
      .filter(([cmd]) => cmd === 'git')
      .map(([, args]) => args);
    expect(gitCalls.some((args) => args.includes('merge-base'))).toBe(false);
    expect(gitCalls.find((args) => args.includes('diff'))).toContain('origin/dev');
  });

  it('measures against the merge-base with origin/main by default', () => {
    givenRun({ mutants: ['Killed'] });

    main(['src/a.ts']);

    const diffCall = execFileSync.mock.calls.find(
      ([cmd, args]) => cmd === 'git' && args.includes('diff'),
    );
    expect(diffCall?.[1]).toContain('base123');
  });

  it('falls back to whole files, and says so, when there is no merge-base', () => {
    // A fresh repository, or one with no origin/main: grading more than the
    // change is the safe direction to be wrong in.
    const log = vi.spyOn(console, 'log');
    givenRun({ mutants: ['Killed'], noMergeBase: true });

    main(['src/a.ts']);

    expect(mutateList()).toEqual(['src/a.ts']);
    expect(log.mock.calls.flat().join(' ')).toContain(
      'git could not diff against the merge-base with origin/main — grading whole files',
    );
  });

  it('hands Stryker a [locale] path escaped, range and all', () => {
    // Stryker treats `mutate` entries as globs, and `[locale]` is a character
    // class: it matches `src/app/l/…`, never the real directory. Every server
    // action under the locale segment passed the gate with zero mutants this
    // way. `[[]` is the one escape that survives Stryker's own path.resolve
    // and backslash-to-slash normalisation; a backslash escape does not.
    givenRun({ mutants: ['Killed'] });

    main(['src/app/[locale]/settings-actions.ts']);

    expect(mutateList()).toEqual(['src/app/[[]locale]/settings-actions.ts:1-1']);
  });
});

describe('main — the tools it starts, on Windows too', () => {
  it('starts vitest and Stryker as process.execPath with their JS entries, never npx, and never through a shell', () => {
    // npx is npx.cmd on Windows. Through a shell it starts, but the shell joins the arguments
    // unquoted, so a temp path with a space breaks; process.execPath needs no shell at all.
    givenRun({ mutants: ['Killed'] });

    main(['src/a.ts']);

    const tools = (execFileSync.mock.calls as unknown as [string, string[], { shell?: boolean }][]).filter(([cmd]) => cmd !== 'git');
    expect(tools.map(([cmd, args]) => [cmd, args[0]!.split('\\').join('/').replace(/^.*node_modules\//, '')])).toEqual([
      [process.execPath, 'vitest/vitest.mjs'],
      [process.execPath, '@stryker-mutator/core/bin/stryker.js'],
    ]);
    expect(tools[0]![1].slice(1, 3)).toEqual(['run', '--exclude']);
    expect(tools[1]![1].slice(1)).toEqual(['run', '/tmp/onkel-test/stryker.json'.split('/').join(sep)]);
    for (const [, , options] of execFileSync.mock.calls as unknown as [string, string[], { shell?: boolean }][]) {
      expect(options.shell).toBeFalsy();
    }
  });
});

describe('main — a change with nothing to mutate', () => {
  it('passes when the changed lines hold no mutant, and Stryker found the file', () => {
    // A comment or a type alias: nothing a mutant could change. Escalating on
    // it would stop every build that touched a type.
    givenRun({ mutants: [], diff: diffAdding(['src/a.ts']), strykerLog: FOUND_ONE });

    expect(main(['src/a.ts'])).toBe(0);
  });

  it('passes a file whose diff only deleted lines, graded with nothing to grade, and runs no Stryker (decision #45)', () => {
    const deletionOnly = ['diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -3 +2,0 @@', '-x'].join('\n');
    const log = vi.spyOn(console, 'log');
    log.mockClear();
    givenRun({ mutants: [], diff: deletionOnly });

    expect(main(['src/a.ts'])).toBe(0);
    expect(mutateList()).toBeNull();
    expect(log.mock.calls.flat().join(' ')).not.toContain('No line of these files changed');
  });

  it('escalates when Stryker found no file to mutate, whatever the scope', () => {
    // The [locale] failure: an entry naming no real file reads exactly like a
    // perfect run unless something checks what Stryker actually found.
    givenRun({ mutants: [], diff: diffAdding(['src/a.ts']), strykerLog: 'Found 0 of 765 file(s)' });

    expect(main(['src/a.ts'])).toBe(1);
  });

  it('escalates on no mutants in whole-file mode, as it always has', () => {
    givenRun({ mutants: [], strykerLog: FOUND_ONE });

    expect(main(['--whole-file', 'src/a.ts'])).toBe(1);
  });
});

describe('main — every named file must reach Stryker (review #21)', () => {
  it('escalates in whole-file mode when Stryker found only one of two files, though its mutants died', () => {
    givenRun({ mutants: ['Killed'], strykerLog: FOUND_ONE });

    expect(main(['--whole-file', 'src/a.ts', 'src/b.ts'])).toBe(1);
  });

  it('escalates in a scoped run when Stryker found only one of two changed files', () => {
    givenRun({ mutants: ['Killed'], diff: diffAdding(['src/a.ts', 'src/b.ts']), strykerLog: FOUND_ONE });

    expect(main(['src/a.ts', 'src/b.ts'])).toBe(1);
  });

  it('passes in whole-file mode when Stryker found both files', () => {
    givenRun({ mutants: ['Killed'], strykerLog: 'INFO ProjectReader Found 2 of 765 file(s) to be mutated.' });

    expect(main(['--whole-file', 'src/a.ts', 'src/b.ts'])).toBe(0);
  });
});

describe('main --whole-file — the gate as it was, for the post-test sweep', () => {
  it('hands Stryker whole files, and never asks git', () => {
    givenRun({ mutants: ['Killed'], diff: '' });

    main(['--whole-file', 'src/a.ts', 'src/b.ts']);

    expect(mutateList()).toEqual(['src/a.ts', 'src/b.ts']);
    expect(execFileSync.mock.calls.some(([cmd]) => cmd === 'git')).toBe(false);
  });

  it('escapes every bracket segment on a path, not just the first', () => {
    givenRun({ mutants: ['Killed'] });

    main(['--whole-file', 'src/app/[locale]/[id]/actions.ts']);

    expect(mutateList()).toEqual(['src/app/[[]locale]/[[]id]/actions.ts']);
  });

  it('fails a function over the ceiling that the change did not touch', () => {
    givenRun({
      mutants: ['Killed'],
      covered: false,
      source: BRANCHY,
      diff: '',
    });

    expect(main(['--whole-file', 'src/a.ts'])).toBe(1);
  });
});

describe('main — whose numbers decide the verdict', () => {
  // BRANCHY scores 12 uncovered on line 1; the change below touches line 3.
  const TWO_FUNCTIONS = `${BRANCHY}\n\nexport function g() { return 1; }\n`;

  it('passes, and names it as left standing, when the function over the ceiling is not this change', () => {
    const log = vi.spyOn(console, 'log');
    givenRun({
      mutants: ['Killed'],
      covered: false,
      source: TWO_FUNCTIONS,
      diff: diffAdding(['src/a.ts'], '+3'),
    });

    expect(main(['src/a.ts'])).toBe(0);
    const text = log.mock.calls.flat().join('\n');
    expect(text).toContain('Left standing (not this change)');
    expect(text).toMatch(/12\.0 {2}src\/a\.ts:1 {2}f/);
  });

  it('escalates when the change touches that same function', () => {
    givenRun({
      mutants: ['Killed'],
      covered: false,
      source: TWO_FUNCTIONS,
      diff: diffAdding(['src/a.ts'], '+1'),
    });

    expect(main(['src/a.ts'])).toBe(1);
  });
});

describe('main — the sandbox', () => {
  it('keeps the shared junctions out of the sandbox', () => {
    // Stryker copies the project into a sandbox, and copyfile on a Windows
    // junction fails EPERM — so without this the gate does not run at all in
    // any worktree New-Session.ps1 creates. The project passes its junctions; the generic
    // defaults stay in as well.
    givenRun({ mutants: ['Killed'] });

    main(['--sandbox-ignore', '.scratch', '--sandbox-ignore', 'docs/agents', 'src/a.ts']);

    const config = JSON.parse(String(writeFileSync.mock.calls[0][1]));
    expect(config.ignorePatterns).toEqual(expect.arrayContaining(['.scratch', 'docs/agents', '.claude', '.next']));
  });

  it('runs Stryker incrementally when the project passes --incremental-file', () => {
    givenRun({ mutants: ['Killed'] });

    main(['--incremental-file', 'state/onkel/inc.json', 'src/a.ts']);

    const config = JSON.parse(String(writeFileSync.mock.calls[0][1]));
    expect(config.incremental).toBe(true);
    expect(config.incrementalFile).toBe('state/onkel/inc.json');
  });

  it('runs a full mutation pass when no incremental file is given', () => {
    givenRun({ mutants: ['Killed'] });

    main(['src/a.ts']);

    expect(JSON.parse(String(writeFileSync.mock.calls[0][1])).incremental).toBeUndefined();
  });

  it('escalates as untested when Stryker stops because no test runs the file', () => {
    givenRun({ mutants: [], strykerLog: 'ERROR Stryker No tests were executed. Stryker will exit prematurely.' });
    existsSync.mockImplementation((p: string) => !String(p).endsWith('mutation.json'));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    log.mockClear();

    expect(main(['src/a.ts'])).toBe(1);
    expect(log.mock.calls.flat().join('\n')).toContain('[untested] src/a.ts');
  });

  it('names as untested only the files handed to Stryker, not a named file the change left alone (review #27)', () => {
    givenRun({
      mutants: [],
      diff: diffAdding(['src/a.ts']),
      strykerLog: 'ERROR Stryker No tests were executed. Stryker will exit prematurely.',
    });
    existsSync.mockImplementation((p: string) => !String(p).endsWith('mutation.json'));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    log.mockClear();

    expect(main(['src/a.ts', 'src/b.ts'])).toBe(1);
    const text = log.mock.calls.flat().join('\n');
    expect(text).toContain('[untested] src/a.ts');
    expect(text).not.toContain('[untested] src/b.ts');
  });

  it('treats a missing report as a broken run, not an empty one', () => {
    // Stryker exits non-zero when mutants survive, so a thrown command is not
    // by itself a failure — but no report at all means the run never happened,
    // and that must not read as "no mutants, all good".
    givenRun({ mutants: [] });
    existsSync.mockImplementation((p: string) => !String(p).endsWith('mutation.json'));
    // Only the Stryker call fails; the coverage run and git before it must
    // still work, or the test would be proving the wrong thing.
    execFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (isStryker(args)) throw new Error('stryker exited 1');
      return cmd === 'git' ? git(args, {}) : '';
    });

    expect(() => main(['src/a.ts'])).toThrow(/no report/i);
  });
});

describe('the mutation exemption', () => {
  it('exempts nothing by default; each project names its own exemptions with --exempt', () => {
    // A scoping decision, so it lives in the project's config where it can be argued about.
    // a pilot project passes `--exempt src/db/schema.ts` (the owner, 2026-09-25): it declares
    // tables and decides nothing, and grading it cost ~3 hours on one of its tickets.
    expect(MUTATION_EXEMPT).toEqual([]);
  });

  it('does not mutate a file passed with --exempt', () => {
    givenRun({ mutants: [], covered: true });

    main(['--exempt', 'src/b.ts', 'src/a.ts', 'src/b.ts']);

    expect(mutateList()?.some((m) => m.includes('src/b.ts'))).toBe(false);
    expect(mutateList()?.some((m) => m.includes('src/a.ts'))).toBe(true);
  });

  it('still grades an exempt file for CRAP', () => {
    // The bar is aimed, not lowered: complexity and coverage still apply here.
    givenRun({ mutants: [], covered: false, source: BRANCHY });

    expect(main(['--exempt', 'scripts/quality/cli.ts', 'scripts/quality/cli.ts'])).toBe(1);
  });

  it('does not report "no mutants" when every file was exempt', () => {
    // An empty result then means "nothing to mutate", not "the run covered
    // nothing" — firing the no-mutants rule on it would be a false escalation.
    givenRun({ mutants: [], covered: true });

    expect(main(['--exempt', 'scripts/quality/cli.ts', 'scripts/quality/cli.ts'])).toBe(0);
  });
});

describe('main — the fast merge gate (ticket 31)', () => {
  /** Six top-level lines, so no line widens to a function. */
  const FLAT = 'const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\nconst e = 5;\nconst f = 6;\n';

  /** git with one diff against the base (lines 1-6) and another against the trusted tip. */
  function givenMerge(sinceTip: string | Error, mutants: string[] = ['Killed']) {
    givenRun({ mutants, source: FLAT, diff: diffAdding(['src/a.ts'], '+1,6') });
    const base = execFileSync.getMockImplementation()!;
    execFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd !== 'git' || !args.includes('tip123')) return base(cmd, args);
      if (sinceTip instanceof Error) throw sinceTip;
      return sinceTip;
    });
  }

  const ranVitest = () => execFileSync.mock.calls.some(([cmd, args]) => cmd !== 'git' && args.some((a) => a.includes('vitest')));
  const ranStryker = () => execFileSync.mock.calls.some(([, args]) => isStryker(args));
  const logged = () => vi.mocked(console.log).mock.calls.flat().join('\n');
  const written = (path: string) => JSON.parse(String(writeFileSync.mock.calls.find(([p]) => p === path)?.[1])) as Record<string, unknown>;

  it('grades CRAP from the coverage file it is given and never runs the suite again', () => {
    givenRun({ mutants: ['Killed'] });

    expect(main(['--coverage', '/runs/cov/coverage-final.json', 'src/a.ts'])).toBe(0);
    expect(readFileSync).toHaveBeenCalledWith('/runs/cov/coverage-final.json', 'utf8');
    expect(ranVitest()).toBe(false);
  });

  it('collects coverage itself, as before, without --coverage', () => {
    givenRun({ mutants: ['Killed'] });

    main(['src/a.ts']);

    expect(ranVitest()).toBe(true);
  });

  it('with --trust, mutates only the lines that also differ from the trusted tip: the conflict resolution', () => {
    givenMerge(diffAdding(['src/a.ts'], '+3'));

    expect(main(['--base', 'base1', '--trust', 'tip123', 'src/a.ts'])).toBe(0);
    expect(mutateList()).toEqual(['src/a.ts:3-3']);
    expect(logged()).toContain('Mutation scope: only the lines that differ from tip123; the rest is trusted from its gate');
  });

  it('runs no Stryker, and passes, when every changed line equals the trusted tip', () => {
    givenMerge('');

    expect(main(['--base', 'base1', '--trust', 'tip123', 'src/a.ts'])).toBe(0);
    expect(ranStryker()).toBe(false);
    expect(mutateList()).toBeNull();
  });

  it('still grades CRAP on every changed line under --trust', () => {
    givenMerge('');
    readFileSync.mockImplementation((path: string) => (String(path).endsWith('coverage-final.json') ? coverageReport(false) : BRANCHY));

    expect(main(['--base', 'base1', '--trust', 'tip123', 'src/a.ts'])).toBe(1);
  });

  it('trusts nothing, and mutates every changed line, when git cannot diff against the tip', () => {
    givenMerge(new Error('fatal: bad revision'));

    main(['--base', 'base1', '--trust', 'tip123', 'src/a.ts']);

    expect(mutateList()).toEqual(['src/a.ts:1-6']);
  });

  it('writes the run as data to --json', () => {
    givenRun({ mutants: ['Killed', 'Timeout'] });

    main(['--json', '/runs/onkel.json', 'src/a.ts']);

    expect(written('/runs/onkel.json')).toMatchObject({ verdict: 'pass', files: ['src/a.ts'], mutants: { killed: 2, total: 2 }, survivors: [], timeouts: { count: 1 } });
  });

  it('writes an escalated run with its survivors', () => {
    givenRun({ mutants: ['Survived'] });

    expect(main(['--json', '/runs/onkel.json', 'src/a.ts'])).toBe(1);
    expect(written('/runs/onkel.json')).toMatchObject({ verdict: 'escalate', mutants: { killed: 0, total: 1 }, survivors: [{ file: 'src/a.ts', line: 1, status: 'Survived' }] });
  });

  it('hands Stryker the configured timeouts and prints what its timeouts cost', () => {
    givenRun({ mutants: ['Timeout'] });

    main(['--timeout-ms', '9000', '--timeout-factor', '2', 'src/a.ts']);

    expect(JSON.parse(String(writeFileSync.mock.calls[0][1]))).toMatchObject({ timeoutMS: 9000, timeoutFactor: 2 });
    expect(logged()).toContain('Stryker timeouts: 1 mutant(s) timed out, waiting at most 9.0 s in all');
  });

  it("leaves Stryker's own timeouts alone when none are configured", () => {
    givenRun({ mutants: ['Killed'] });

    main(['src/a.ts']);

    const config = JSON.parse(String(writeFileSync.mock.calls[0][1])) as Record<string, unknown>;
    expect(config).not.toHaveProperty('timeoutMS');
    expect(config).not.toHaveProperty('timeoutFactor');
  });
});
