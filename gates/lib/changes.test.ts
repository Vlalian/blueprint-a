import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { changedLines, changedLinesFrom, gitChangesIo, type ChangesIo } from './changes.ts';
import { addedLines as addedLinesOf } from './diff.ts';

// Spawns processes: under a full-suite load on Windows they run several times slower (ticket 29).
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const DIFF = '+++ b/a.ts\n@@ -0,0 +1 @@\n+tracked line\n';

const io = (over: Partial<ChangesIo> = {}): ChangesIo => ({
  diffStaged: () => DIFF,
  diffSince: () => DIFF,
  untracked: () => [],
  read: () => undefined,
  ...over,
});

describe('changedLinesFrom', () => {
  it('reads the staged diff in --staged mode, and nothing untracked', () => {
    const lines = changedLinesFrom({ staged: true }, io({ untracked: () => ['new.ts'], read: () => 'x' }));
    expect(lines).toEqual([{ file: 'a.ts', line: 1, text: 'tracked line' }]);
  });

  it('in --base mode adds every line of untracked files, numbered from 1', () => {
    const lines = changedLinesFrom({ base: 'HEAD' }, io({ untracked: () => ['new.ts'], read: () => 'one\r\ntwo' }));
    expect(lines).toEqual([
      { file: 'a.ts', line: 1, text: 'tracked line' },
      { file: 'new.ts', line: 1, text: 'one' },
      { file: 'new.ts', line: 2, text: 'two' },
    ]);
  });

  it('diffs against the given base ref', () => {
    const seen: string[] = [];
    changedLinesFrom({ base: 'abc123' }, io({ diffSince: (ref) => (seen.push(ref), '') }));
    expect(seen).toEqual(['abc123']);
  });

  it('skips an untracked file that vanished before it could be read', () => {
    expect(changedLinesFrom({ base: 'HEAD' }, io({ diffSince: () => '', untracked: () => ['gone.ts'] }))).toEqual([]);
  });

  it('splits untracked files on plain LF as well as CRLF', () => {
    const lines = changedLinesFrom({ base: 'HEAD' }, io({ diffSince: () => '', untracked: () => ['n.ts'], read: () => 'one\ntwo' }));
    expect(lines.map((l) => l.text)).toEqual(['one', 'two']);
  });

  it('throws a usage error without a mode', () => {
    expect(() => changedLinesFrom({}, io())).toThrow(/--staged or --base/);
  });
});

describe('gitChangesIo and changedLines in a real repo', () => {
  // a.txt: line 3 changed and staged. b.txt: a line appended, not staged. u.txt untracked,
  // ignored.txt untracked but ignored.
  function repo() {
    const dir = mkdtempSync(join(tmpdir(), 'changes-'));
    const g = (...a: string[]) => execFileSync('git', a, { cwd: dir });
    g('init', '-q', '-b', 'main');
    g('config', 'user.email', 't@t');
    g('config', 'user.name', 't');
    g('config', 'core.autocrlf', 'false');
    writeFileSync(join(dir, 'a.txt'), '1\n2\n3\n4\n5\n');
    writeFileSync(join(dir, 'b.txt'), 'x\n');
    writeFileSync(join(dir, '.gitignore'), 'ignored.txt\n');
    g('add', '-A');
    g('commit', '-qm', 'base');
    writeFileSync(join(dir, 'a.txt'), '1\n2\nthree\n4\n5\n');
    g('add', 'a.txt');
    writeFileSync(join(dir, 'b.txt'), 'x\ny\n');
    writeFileSync(join(dir, 'u.txt'), 'u1\nu2');
    writeFileSync(join(dir, 'ignored.txt'), 'nope\n');
    return dir;
  }
  const dir = repo();
  const real = gitChangesIo(dir);

  it('diffs only the index in staged mode, with no context lines', () => {
    expect(real.diffStaged()).toContain('@@ -3 +3 @@\n-3\n+three\n');
    expect(changedLines(dir, { staged: true })).toEqual([{ file: 'a.txt', line: 3, text: 'three' }]);
  });

  it('diffs the working tree against a ref, with no context lines', () => {
    expect(real.diffSince('HEAD')).toContain('@@ -1,0 +2 @@ x\n+y\n');
    expect(addedLinesOf(real.diffSince('HEAD'))).toEqual([
      { file: 'a.txt', line: 3, text: 'three' },
      { file: 'b.txt', line: 2, text: 'y' },
    ]);
  });

  it('lists untracked files that are not ignored', () => {
    expect(real.untracked()).toEqual(['u.txt']);
  });

  it('reads a file, or gives undefined when it is gone', () => {
    expect(real.read('u.txt')).toBe('u1\nu2');
    expect(real.read('gone.txt')).toBeUndefined();
  });

  it('in base mode returns the tracked changes then every untracked line', () => {
    expect(changedLines(dir, { base: 'HEAD' })).toEqual([
      { file: 'a.txt', line: 3, text: 'three' },
      { file: 'b.txt', line: 2, text: 'y' },
      { file: 'u.txt', line: 1, text: 'u1' },
      { file: 'u.txt', line: 2, text: 'u2' },
    ]);
  });
});
