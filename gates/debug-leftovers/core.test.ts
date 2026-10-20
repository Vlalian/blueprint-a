import { describe, expect, it } from 'vitest';
import { debugLeftovers, leftoversCheck, leftoversFor, printAllowedOf } from './core.ts';

/** A `git diff -U0` adding these lines at the top of a file. */
const added = (file: string, ...lines: string[]) => [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map((l) => `+${l}`)].join('\n');

describe('debugLeftovers', () => {
  it('finds added console.log, console.debug and debugger lines in source files, at their line', () => {
    const diff = added('src/orders.ts', 'const a = 1;', '  console.log(a);', 'console.debug ("x")', 'debugger;', '\tdebugger', 'if (x) console.log(x); // why');
    expect(debugLeftovers(diff, [])).toEqual([
      { file: 'src/orders.ts', line: 2, text: '  console.log(a);' },
      { file: 'src/orders.ts', line: 3, text: 'console.debug ("x")' },
      { file: 'src/orders.ts', line: 4, text: 'debugger;' },
      { file: 'src/orders.ts', line: 5, text: '\tdebugger' },
      { file: 'src/orders.ts', line: 6, text: 'if (x) console.log(x); // why' },
    ]);
  });

  it('leaves tests, files that are not source, and files the project allows to print', () => {
    const diff = [added('src/orders.test.ts', 'console.log(1)'), added('src/a.spec.tsx', 'debugger;'), added('README.md', 'console.log(1)'), added('scripts/cli.ts', 'console.log(1)'), added('tools/x/run.mjs', 'console.log(1)')].join('\n');
    expect(debugLeftovers(diff, ['scripts/cli.ts', 'tools/**'])).toEqual([]);
    expect(debugLeftovers(diff, []).map((l) => l.file)).toEqual(['scripts/cli.ts', 'tools/x/run.mjs']);
  });

  it('judges every JS and TS source extension', () => {
    const files = ['a.ts', 'a.tsx', 'a.js', 'a.jsx', 'a.mjs', 'a.cjs', 'a.mts', 'a.cts'];
    expect(debugLeftovers(files.map((f) => added(f, 'console.log(1)')).join('\n'), []).map((l) => l.file)).toEqual(files);
    expect(debugLeftovers(['a.tsx.bak', 'a.json', 'ats'].map((f) => added(f, 'console.log(1)')).join('\n'), [])).toEqual([]);
  });

  it('leaves lines that only look alike: other console methods, longer names, a name without a call, comments', () => {
    const diff = added(
      'src/a.ts',
      ...['console.error(e);', 'console.logger.x();', 'myconsole.log(1)', 'console.log', 'const debuggerOn = true;', '// see debugger docs', 'x.debugger = 1;', 'console.warn(w)'],
      ...['// console.log(x);', '  /* console.log(x) */', ' * console.debug(x)', '*console.log(x)', '\t// debugger'],
    );
    expect(debugLeftovers(diff, [])).toEqual([]);
  });

  it('judges only added lines, never removed or context ones', () => {
    const diff = ['--- a/src/a.ts', '+++ b/src/a.ts', '@@ -3,1 +3,1 @@', '-console.log(old)', '+const x = 1;'].join('\n');
    expect(debugLeftovers(diff, [])).toEqual([]);
  });
});

describe('leftoversCheck', () => {
  it('passes with nothing found', () => {
    expect(leftoversCheck([])).toEqual({ name: 'debug-leftovers', command: 'added console.log, console.debug or debugger lines in source files', exitCode: 0, tail: '' });
  });

  it('fails naming each line', () => {
    const r = leftoversCheck([{ file: 'src/a.ts', line: 4, text: '  console.log(a);  ' }, { file: 'src/b.ts', line: 9, text: 'debugger;' }]);
    expect(r.exitCode).toBe(1);
    expect(r.tail).toBe('Added debug lines; take them out, or list a file that prints by design in "printAllowed":\nsrc/a.ts:4: console.log(a);\nsrc/b.ts:9: debugger;');
  });
});

describe('leftoversFor', () => {
  const diff = added('src/a.ts', 'console.log(1)');

  it("judges a session's diff with the project's printAllowed list", () => {
    expect(leftoversFor(diff, {})!.exitCode).toBe(1);
    expect(leftoversFor(diff, { printAllowed: ['src/*.ts'] })!.exitCode).toBe(0);
    expect(leftoversFor('', { checks: { test: 't' } })!.exitCode).toBe(0);
  });

  it('is undefined without a diff, or when the project runs the check among its own', () => {
    expect(leftoversFor(undefined, {})).toBeUndefined();
    expect(leftoversFor(diff, { checks: { 'debug-leftovers': 'x' } })).toBeUndefined();
    expect(leftoversFor(diff, { checks: Object.create({ 'debug-leftovers': 'inherited' }) })!.exitCode).toBe(1);
  });
});

describe('printAllowedOf', () => {
  it('is the project config\'s printAllowed globs, none when it lists none', () => {
    expect(printAllowedOf('{"printAllowed":["scripts/**"]}')).toEqual(['scripts/**']);
    expect(printAllowedOf('{"checks":{}}')).toEqual([]);
  });
});
