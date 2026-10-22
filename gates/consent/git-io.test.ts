import { expect, it } from 'vitest';
import { consentIo, type GitRun } from './git-io.ts';

/** A fake git: each command line maps to its stdout; a missing one exits 128. */
function fake(replies: Record<string, string>) {
  const calls: string[] = [];
  const git: GitRun = (args) => {
    const line = args.join(' ');
    calls.push(line);
    return line in replies ? { status: 0, stdout: replies[line]! } : { status: 128, stdout: '' };
  };
  return { git, calls };
}
const noFile = () => { throw new Error('no working-tree read'); };

it('reads a staged change: the index against HEAD, a file a side lacks as undefined', () => {
  const f = fake({
    'diff --cached --name-only -z --no-renames': 'a.ts\0b c.ts\0',
    'show HEAD:a.ts': 'old',
    'show :a.ts': 'new',
    'ls-files -z': 'a.ts\0b c.ts\0',
    'branch --show-current': 'ticket/9-x\n',
  });
  const io = consentIo(f.git, noFile, { staged: true });
  expect(io.changed()).toEqual(['a.ts', 'b c.ts']);
  expect([io.before('a.ts'), io.after('a.ts'), io.before('b c.ts'), io.after('b c.ts')]).toEqual(['old', 'new', undefined, undefined]);
  expect(io.list()).toEqual(['a.ts', 'b c.ts']);
  expect(io.branch()).toBe('ticket/9-x');
});

it('reads the working tree against --base, untracked files included, and takes --branch as given', () => {
  const f = fake({
    'diff --name-only -z --no-renames origin/main --': 'a.ts\0',
    'ls-files -z --others --exclude-standard': 'new.ts\0',
    'ls-files -z --cached --others --exclude-standard': 'a.ts\0new.ts\0',
    'show origin/main:a.ts': 'old',
  });
  const io = consentIo(f.git, (p) => (p === 'a.ts' ? 'now' : undefined), { staged: false, base: 'origin/main', branch: 'origin/ticket/9-x' });
  expect(io.changed()).toEqual(['a.ts', 'new.ts']);
  expect([io.before('a.ts'), io.after('a.ts'), io.before('new.ts'), io.after('gone.ts')]).toEqual(['old', 'now', undefined, undefined]);
  expect(io.list()).toEqual(['a.ts', 'new.ts']);
  expect(io.branch()).toBe('origin/ticket/9-x');
  expect(f.calls.some((c) => c.startsWith('branch'))).toBe(false);
});

it('throws naming the git command that failed, and asks for a mode', () => {
  const io = consentIo(fake({}).git, noFile, { staged: true });
  expect(() => io.changed()).toThrow('git diff --cached --name-only -z --no-renames failed');
  expect(() => io.list()).toThrow('git ls-files -z failed');
  expect(() => io.branch()).toThrow('git branch --show-current failed');
  expect(() => consentIo(fake({}).git, noFile, { staged: false })).toThrow('give --staged or --base <ref>');
});
