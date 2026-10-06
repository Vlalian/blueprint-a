import { afterEach, describe, expect, it, vi } from 'vitest';
import { emit, exitCodeFor, failClosed, type Gate } from './contract.ts';

describe('exitCodeFor', () => {
  it('maps pass to 0, fail to 1 and a gate that could not run to 2', () => {
    expect(exitCodeFor({ gate: 'x', pass: true })).toBe(0);
    expect(exitCodeFor({ gate: 'x', pass: false })).toBe(1);
    expect(exitCodeFor({ gate: 'x', pass: false, error: 'bad usage' })).toBe(2);
  });

  it('never returns 0 for a result that carries an error, even if pass was set', () => {
    expect(exitCodeFor({ gate: 'x', pass: true, error: 'oops' })).toBe(2);
  });
});

describe('failClosed', () => {
  it('turns a gate that throws into a failing result with the error, never a pass', () => {
    const gate: Gate = () => {
      throw new Error('cannot read file');
    };
    expect(failClosed('x', gate)).toEqual({ gate: 'x', pass: false, error: 'cannot read file' });
  });

  it('returns the gate result unchanged when it does not throw', () => {
    expect(failClosed('x', () => ({ gate: 'x', pass: true }))).toEqual({ gate: 'x', pass: true });
  });
});

describe('emit', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  // process.exit() right after a write to a piped stdout crashes Node on Windows (libuv
  // assertion, exit 0xC0000409), so emit sets the exit code and lets the process end on its own.
  it('prints the result as indented JSON on stdout and sets its exit code without calling process.exit', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const result = { gate: 'x', pass: false, error: 'bad usage' };

    emit(result);

    expect(write).toHaveBeenCalledWith('{\n  "gate": "x",\n  "pass": false,\n  "error": "bad usage"\n}\n');
    expect(process.exitCode).toBe(2);
    expect(exit).not.toHaveBeenCalled();
  });
});
