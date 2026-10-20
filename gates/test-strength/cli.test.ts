import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Spawns processes: under a full-suite load on Windows they run several times slower (ticket 29).
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const CLI = join(import.meta.dirname, 'cli.ts');
const SOURCE = ['export function sign(n: number): number {', '  if (n > 0) return 1;', '  return n < 0 ? -1 : 0;', '}', ''].join('\n');

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A project holding src/sign.ts and an istanbul coverage file in which `ran` of its statements ran. */
function project(ran: number[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'test-strength-cli-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'sign.ts'), SOURCE);
  const statementMap = { 0: { start: { line: 2 } }, 1: { start: { line: 3 } } };
  writeFileSync(join(dir, 'cov.json'), JSON.stringify({ [join(dir, 'src', 'sign.ts')]: { statementMap, s: { 0: ran[0], 1: ran[1] } } }));
  return dir;
}

const run = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

describe('test-strength CLI', () => {
  it('passes a covered function through the JS/TS adapter with the given coverage file', () => {
    const r = run('crap', '--runner', 'karma', '--cwd', project([1, 1]), '--coverage', 'cov.json', 'src/sign.ts');
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ gate: 'crap', pass: true, functions: 1 });
  });

  it('fails an untested branchy function and names it', () => {
    const r = run('crap', '--runner', 'karma', '--cwd', project([0, 0]), '--coverage', 'cov.json', 'src/sign.ts');
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout)).toMatchObject({ pass: false, over: [{ file: 'src/sign.ts', name: 'sign', complexity: 3, crap: 12 }] });
  });

  it('reads a Cobertura file through the .NET adapter with --runner dotnet, and fails the untested method', () => {
    const dir = mkdtempSync(join(tmpdir(), 'test-strength-cli-'));
    dirs.push(dir);
    // The recorded report's sources name /work/dotnet-sample; point them at this project.
    const recorded = readFileSync(join(import.meta.dirname, '..', '..', 'adapters', 'dotnet', 'fixtures', 'coverage-untested.cobertura.xml'), 'utf8');
    writeFileSync(join(dir, 'cov.xml'), recorded.replace('<source>/work/dotnet-sample/src/Sample/</source>', `<source>${join(dir, 'src', 'Sample') + sep}</source>`));
    const r = run('crap', '--runner', 'dotnet', '--cwd', dir, '--coverage', 'cov.xml', 'src/Sample/Grades.cs', 'src/Sample/Parity.cs');
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout)).toMatchObject({ pass: false, functions: 2, over: [{ file: 'src/Sample/Grades.cs', name: 'Sample.Grades.Grade', complexity: 4, crap: 20 }] });
  });

  it('exits 2 with what to install when there is no dotnet', () => {
    const empty = mkdtempSync(join(tmpdir(), 'test-strength-cli-'));
    dirs.push(empty);
    const r = spawnSync(process.execPath, [CLI, 'mutation', '--runner', 'dotnet', '--cwd', empty, 'src/A.cs'], { encoding: 'utf8', env: { ...process.env, PATH: empty, Path: empty } });
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout)).toMatchObject({ gate: 'test-strength', pass: false, error: expect.stringMatching(/^dotnet was not found: install the \.NET SDK 8 or later/) });
  });

  it('exits 2 with the usage when it cannot run', () => {
    const r = run('crap');
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout)).toMatchObject({ gate: 'test-strength', pass: false, error: expect.stringMatching(/^usage: test-strength/) });
  });
});
