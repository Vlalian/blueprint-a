import { describe, expect, it } from 'vitest';
import { DEFAULTS } from './config.ts';
import { addGate, EMPTY_GATES, latestResult, listLines, readGates, resultLine, type GateResult } from './gate-queue-state.ts';

const result = (over: Partial<GateResult> = {}): GateResult => ({
  ticket: '12',
  branch: 'ticket/12-login',
  head: 'a'.repeat(40),
  base: 'b'.repeat(40),
  status: 'green',
  log: 'gate.log',
  at: '2026-10-21T00:00:00.000Z',
  ...over,
});

describe('the gate queue file', () => {
  it('is empty without a file and refuses one without both lists', () => {
    expect(readGates(undefined)).toBe(EMPTY_GATES);
    expect(readGates('{"queue":[],"results":[1]}')).toEqual({ queue: [], results: [1] });
    expect(() => readGates('{"queue":[]}')).toThrow('gate-queue.json has no queue and results lists');
    expect(() => readGates('{"results":[]}')).toThrow('gate-queue.json has no queue and results lists');
    expect(() => readGates('{')).toThrow('gate-queue.json could not be read');
  });

  it('gives the latest result of a ticket', () => {
    const q = { queue: [], results: [result({ head: '1' }), result({ ticket: '13', head: '2' }), result({ head: '3' })] };
    expect(latestResult(q, '12')?.head).toBe('3');
    expect(latestResult(q, '14')).toBeUndefined();
  });

  it('queues a ticket branch of the configured prefix once', () => {
    const one = addGate(EMPTY_GATES, 'ticket/12-login', 'now', DEFAULTS);
    expect(one).toEqual({ queue: { queue: [{ ticket: '12', branch: 'ticket/12-login', addedAt: 'now' }], results: [] }, note: 'ticket/12-login queued for the merge gate (1 in the queue)' });
    expect(addGate(one.queue, 'ticket/13-x', 'later', DEFAULTS).note).toBe('ticket/13-x queued for the merge gate (2 in the queue)');
    expect(addGate(one.queue, 'ticket/12-login', 'later', DEFAULTS)).toEqual({ queue: one.queue, note: 'ticket/12-login is already in the gate queue' });
    expect(addGate(EMPTY_GATES, 'main', 'now', { branchPrefix: 'feature/' })).toEqual({ queue: EMPTY_GATES, note: 'main is not a feature/<NN-name> branch; not queued' });
  });

  it('lists the queue and the latest result of each ticket', () => {
    expect(listLines(EMPTY_GATES)).toEqual(['Gate queue:', '(empty)', 'Latest results:', '(none)']);
    const q = { queue: [{ ticket: '14', branch: 'ticket/14-y', addedAt: 'then' }], results: [result({ status: 'red', stage: 'gate 1' }), result()] };
    expect(listLines(q)).toEqual(['Gate queue:', '1. ticket/14-y (queued then)', 'Latest results:', resultLine(result())]);
    expect(resultLine(result({ status: 'red', stage: 'gate 1' }))).toBe('12  red at gate 1  ticket/12-login @ aaaaaaa on bbbbbbb  2026-10-21T00:00:00.000Z  log gate.log');
    expect(resultLine(result())).toBe('12  green  ticket/12-login @ aaaaaaa on bbbbbbb  2026-10-21T00:00:00.000Z  log gate.log');
  });
});
