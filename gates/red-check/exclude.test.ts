import { describe, expect, it } from 'vitest';
import { ensureTempDirExcluded, excludeFile, excludeWithTempDir } from './exclude.ts';

describe('ensureTempDirExcluded', () => {
  const io = (current: string | undefined) => {
    const calls: string[] = [];
    return {
      calls,
      io: {
        read: (p: string) => (calls.push(`read ${p}`), current),
        makeDir: (p: string) => void calls.push(`mkdir ${p}`),
        write: (p: string, text: string) => void calls.push(`write ${p} ${JSON.stringify(text)}`),
      },
    };
  };

  it("creates the file's folder and writes the temp folder in when it is missing", () => {
    const f = io('*.log\n');
    ensureTempDirExcluded('/r/.git/info/exclude', f.io);
    expect(f.calls).toEqual(['mkdir /r/.git/info', 'read /r/.git/info/exclude', 'write /r/.git/info/exclude "*.log\\n\\n/.red-check/\\n"']);
  });

  it('writes nothing when the temp folder is already excluded', () => {
    const f = io('/.red-check/\n');
    ensureTempDirExcluded('/r/.git/info/exclude', f.io);
    expect(f.calls).toEqual(['mkdir /r/.git/info', 'read /r/.git/info/exclude']);
  });
});

describe('excludeFile', () => {
  it("resolves git's info/exclude from an absolute or a relative git dir, with any slashes", () => {
    expect(excludeFile('C:/repo', 'C:/repo/.git')).toBe('C:/repo/.git/info/exclude');
    expect(excludeFile('/repo', '.git')).toBe('/repo/.git/info/exclude');
    expect(excludeFile('/repo', '/elsewhere/.git')).toBe('/elsewhere/.git/info/exclude');
    expect(excludeFile(String.raw`C:\repo`, '.git')).toBe('C:/repo/.git/info/exclude');
    expect(excludeFile('/x', String.raw`D:\wt\.git`)).toBe('D:/wt/.git/info/exclude');
    // A relative git dir with a drive-like folder inside it is still relative.
    expect(excludeFile('/repo', 'odd/c:/.git')).toBe('/repo/odd/c:/.git/info/exclude');
  });
});

describe('excludeWithTempDir', () => {
  it('appends the temp folder once, and returns undefined when it is already there', () => {
    expect(excludeWithTempDir(undefined)).toBe('\n/.red-check/\n');
    expect(excludeWithTempDir('*.log\n')).toBe('*.log\n\n/.red-check/\n');
    expect(excludeWithTempDir('*.log\n/.red-check/\n')).toBeUndefined();
  });
});
