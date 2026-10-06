import { describe, expect, it } from 'vitest';
import { runChecks, type Runner } from './check.ts';

const commands = { lint: 'npm run lint', typecheck: 'npm run typecheck', test: 'npm test', build: 'npm run build' };

const runnerWith = (exitCodes: Record<string, number>): Runner => (command) => ({
  exitCode: exitCodes[command] ?? 0,
  output: `ran ${command}\n`,
});

describe('runChecks', () => {
  it('passes when every command exits 0', () => {
    const result = runChecks(commands, runnerWith({}), '/repo');
    expect(result.pass).toBe(true);
    expect(result.results.map((r) => r.name)).toEqual(['lint', 'typecheck', 'test', 'build']);
  });

  it('fails when one command fails, and still runs the rest so the report is complete', () => {
    const result = runChecks(commands, runnerWith({ 'npm test': 1 }), '/repo');
    expect(result.pass).toBe(false);
    expect(result.results).toHaveLength(4);
    expect(result.results.find((r) => r.name === 'test')?.exitCode).toBe(1);
  });

  it('keeps only the last 20 lines of output per check', () => {
    const long = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n');
    const result = runChecks({ test: 'npm test' }, () => ({ exitCode: 1, output: long }), '/repo');
    const tail = result.results[0]!.tail.split('\n');
    expect(tail).toHaveLength(20);
    expect(tail.at(-1)).toBe('line 49');
  });

  it('drops trailing blank lines before taking the tail, and keeps leading indentation', () => {
    const result = runChecks({ test: 'npm test' }, () => ({ exitCode: 1, output: '  indented\nlast\n\n\n' }), '/repo');
    expect(result.results[0]!.tail).toBe('  indented\nlast');
  });

  it('reports every check with its command, exit code and tail', () => {
    const result = runChecks({ lint: 'npm run lint' }, runnerWith({ 'npm run lint': 3 }), '/repo');
    expect(result).toEqual({
      gate: 'four-checks',
      pass: false,
      results: [{ name: 'lint', command: 'npm run lint', exitCode: 3, tail: 'ran npm run lint' }],
    });
  });

  it('fails closed when no commands are configured', () => {
    expect(runChecks({}, runnerWith({}), '/repo')).toEqual({
      gate: 'four-checks',
      pass: false,
      results: [],
      error: 'no checks configured; refusing to pass',
    });
  });
});
