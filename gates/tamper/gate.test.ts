import { describe, expect, it } from 'vitest';
import { hooksFingerprint, type ExceptionContext } from './core.ts';
import { tamperGate, USAGE, type TamperIo } from './gate.ts';

const HOOKS = [{ name: 'pre-commit', text: 'run gates' }];
const FP = hooksFingerprint(HOOKS, '', []);

function io(over: Partial<TamperIo> = {}): TamperIo {
  return {
    protectedPaths: ['CONTEXT.md', 'NOTES.md'],
    owner: 'the lead',
    changed: () => [],
    before: (path) => (path === 'NOTES.md' ? 'old' : undefined),
    after: (path) => (path === 'NOTES.md' ? 'new' : undefined),
    hooks: () => ({ files: HOOKS, hooksPath: '' }),
    list: () => ['f'],
    read: () => 'r',
    ...over,
  };
}

describe('tamperGate', () => {
  it('passes when nothing protected changed and the hooks are as they were', () => {
    expect(tamperGate({ base: 'abc', staged: false, hooks: FP }, io({ changed: () => ['src/a.ts'] }))).toEqual({ gate: 'tamper', pass: true, base: 'abc', problems: [] });
  });

  it('fails on a changed protected file, naming the owner', () => {
    const r = tamperGate({ base: 'abc', staged: false, hooks: FP }, io({ changed: () => ['CONTEXT.md'] }));
    expect(r).toEqual({ gate: 'tamper', pass: false, base: 'abc', problems: ['CONTEXT.md is tier 4 and differs from the base; only the lead changes it, and agents never do'] });
  });

  it('fails when the hooks or core.hooksPath differ from the fingerprint taken at the base', () => {
    const problem = 'the hooks or core.hooksPath differ from the base; agents never change the hooks';
    expect(tamperGate({ base: 'abc', staged: false, hooks: FP }, io({ hooks: () => ({ files: [], hooksPath: '' }) })).problems).toEqual([problem]);
    expect(tamperGate({ base: 'abc', staged: false, hooks: FP }, io({ hooks: () => ({ files: HOOKS, hooksPath: '/dev/null' }) })).problems).toEqual([problem]);
  });

  it('leaves the pre-commit hook out of the fingerprint when it runs as that hook, since it cannot hold its own fingerprint', () => {
    const others = hooksFingerprint([], '', []);
    expect(tamperGate({ staged: true, hooks: others }, io())).toMatchObject({ pass: true, base: 'HEAD' });
    expect(tamperGate({ staged: true, hooks: FP }, io()).pass).toBe(false);
    expect(tamperGate({ base: 'abc', staged: false, hooks: others }, io()).pass).toBe(false);
  });

  it('asks the exception rule about each protected change, with the state folder and what it may read', () => {
    const asked: Array<[string, ExceptionContext]> = [];
    const exception = (path: string, ctx: ExceptionContext) => (asked.push([path, ctx]), ctx.after(path) === 'new' ? {} : { problem: 'no' });
    const lets = tamperGate({ base: 'abc', staged: false, hooks: FP, state: 'S' }, io({ changed: () => ['NOTES.md', 'src/a.ts'], exception }));
    expect(lets).toMatchObject({ pass: true, problems: [] });
    const [[path, ctx]] = asked as [[string, ExceptionContext]];
    expect([path, ctx.state, ctx.before(path), ctx.list('d'), ctx.read('p')]).toEqual(['NOTES.md', 'S', 'old', ['f'], 'r']);
    const refuses = tamperGate({ base: 'abc', staged: false, hooks: FP }, io({ changed: () => ['NOTES.md'], after: () => 'x', exception }));
    expect(refuses.problems).toEqual(['NOTES.md: no']);
  });

  it.each([
    [{ staged: false, hooks: FP }],
    [{ base: 'abc', staged: true, hooks: FP }],
    [{ base: 'abc', staged: false }],
    [{ base: '', staged: false, hooks: FP }],
  ])('refuses to run without exactly one of --base and --staged, and --hooks: %j', (opts) => {
    expect(() => tamperGate(opts, io())).toThrow(USAGE);
  });

  it('runs without --state: only an exception rule may need it', () => {
    expect(tamperGate({ base: 'abc', staged: false, hooks: FP }, io()).pass).toBe(true);
    expect(USAGE).toBe('usage: tamper (--base <ref> | --staged) --hooks <fingerprint> [--state <state folder>] [--config <file>] [--cwd <dir>]');
  });
});
