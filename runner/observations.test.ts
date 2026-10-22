import { describe, expect, it } from 'vitest';
import {
  appendObservations,
  gateObservations,
  sourcedGateObservations,
  OBSERVATIONS,
  observationLine,
  parseObservations,
  toolObservation,
  type Observation,
} from './observations.ts';

const env = { WORKFLOW_STATE_DIR: '/s', WORKFLOW_RUN_ID: 'r1', WORKFLOW_PROJECT: 'sample', WORKFLOW_TICKET: 'sample-01-coder', WORKFLOW_ROLE: 'coder' };
const at = '2026-10-04T21:00:00.000Z';
const base = { at, run: 'r1', project: 'sample', ticket: 'sample-01-coder', role: 'coder' };
const call = (tool_name: string, tool_input: unknown, tool_response: unknown = {}) => JSON.stringify({ tool_name, tool_input, tool_response });

describe('toolObservation: one record per tool call', () => {
  it('records the tool, its target, the result, the time, the role and the ticket', () => {
    expect(toolObservation(env, call('Edit', { file_path: 'src/a.ts' }), at)).toEqual({ ...base, kind: 'tool', tool: 'Edit', target: 'src/a.ts', result: 'ok' });
  });

  it.each([
    ['Bash', { command: 'npm test' }, 'npm test'],
    ['PowerShell', { command: 'Get-Item x' }, 'Get-Item x'],
    ['NotebookEdit', { notebook_path: 'n.ipynb' }, 'n.ipynb'],
    ['Grep', { pattern: 'todo', path: 'src' }, 'todo'],
    ['Glob', { pattern: '**/*.ts' }, '**/*.ts'],
    ['WebFetch', { url: 'https://x' }, 'https://x'],
    ['Task', { description: 'look around' }, 'look around'],
    ['Read', { file_path: 'a.md' }, 'a.md'],
    ['Other', { thing: 1 }, ''],
    ['Read', null, ''],
    ['Read', { file_path: 7 }, ''],
  ])('takes the target of %s from its input', (tool, input, target) => {
    expect(toolObservation(env, call(tool, input), at)?.target).toBe(target);
  });

  it('keeps a target to one line of at most 200 characters', () => {
    expect(toolObservation(env, call('Bash', { command: 'a\n\tb' }), at)?.target).toBe('a b');
    expect(toolObservation(env, call('Bash', { command: 'x'.repeat(300) }), at)?.target).toBe('x'.repeat(200));
  });

  it.each([
    [{ is_error: true }, 'error'],
    [{ success: false }, 'error'],
    [{ error: 'boom' }, 'error'],
    [{ interrupted: true }, 'error'],
    [{ success: true, is_error: false }, 'ok'],
    ['plain text', 'ok'],
    [null, 'ok'],
  ])('reads the result from the tool response %j', (response, result) => {
    expect(toolObservation(env, call('Bash', { command: 'x' }, response), at)?.result).toBe(result);
  });

  it('names an unknown tool, run, project, ticket or role as unknown or empty', () => {
    expect(toolObservation({ WORKFLOW_STATE_DIR: '/s' }, '{}', at)).toEqual({ at, run: '', project: '', ticket: '', role: '', kind: 'tool', tool: 'unknown', target: '', result: 'ok' });
  });

  it('records nothing outside a workflow run or for input that is not a JSON object', () => {
    expect(toolObservation({}, call('Read', { file_path: 'a' }), at)).toBeUndefined();
    expect(toolObservation(env, '{nope', at)).toBeUndefined();
    expect(toolObservation(env, '3', at)).toBeUndefined();
    expect(toolObservation(env, 'null', at)).toBeUndefined();
  });
});

describe('the observation log', () => {
  it('lives in state/logs/observations.jsonl', () => {
    expect(OBSERVATIONS).toBe('logs/observations.jsonl');
  });

  it('is one JSON object per line', () => {
    const o: Observation = { ...base, kind: 'tool', tool: 'Read', target: 'a', result: 'ok' };
    expect(observationLine(o)).toBe(`${JSON.stringify(o)}\n`);
  });

  it('appends every record in one write, and nothing at all when there are none', () => {
    const writes: string[] = [];
    const io = { append: (path: string, text: string) => void writes.push(`${path}|${text}`) };
    const o: Observation = { ...base, kind: 'escalation', source: 'stop-gate', reason: 'red' };
    appendObservations('/s/x.jsonl', [o, o], io);
    appendObservations('/s/x.jsonl', [], io);
    expect(writes).toEqual([`/s/x.jsonl|${observationLine(o)}${observationLine(o)}`]);
  });

  it('reads back every whole record and skips a cut-off, foreign or blank line', () => {
    const o: Observation = { ...base, kind: 'tool', tool: 'Read', target: 'a', result: 'ok' };
    const text = `${observationLine(o)}\n{"kind":\n[1]\n{"at":"x"}\n{"kind":"tool"}\n{"kind":3,"at":"x"}\n{"kind":"tool","at":3}\n"s"\nnull\n${observationLine(o)}{"kind":"tool"`;
    expect(parseObservations(text)).toEqual([o, o]);
    expect(parseObservations(undefined)).toEqual([]);
  });
});

describe('gateObservations: one record per check of a gate run', () => {
  const results = [
    { name: 'lint', command: 'l', exitCode: 0, tail: '' },
    { name: 'test', command: 't', exitCode: 1, tail: 'line 1\nFAIL a.test.ts\n' },
  ];

  it('records each check as its own gate with its verdict, the failing tail as reasons, and its time', () => {
    expect(gateObservations(base, { gate: 'four-checks', pass: false, results }, [120, 3400], 'abc1234')).toEqual([
      { ...base, kind: 'gate', gate: 'lint', sha: 'abc1234', verdict: 'pass', reasons: [], ms: 120 },
      { ...base, kind: 'gate', gate: 'test', sha: 'abc1234', verdict: 'fail', reasons: ['line 1', 'FAIL a.test.ts'], ms: 3400 },
    ]);
  });

  it('records a gate that could not run once, with the error as its reason', () => {
    expect(gateObservations(base, { gate: 'four-checks', pass: false, results: [], error: 'no checks' }, [], '')).toEqual([
      { ...base, kind: 'gate', gate: 'four-checks', sha: '', verdict: 'could-not-run', reasons: ['no checks'], ms: 0 },
    ]);
  });

  it('keeps at most the last 5 lines of a failing tail', () => {
    const tail = ['1', '2', '3', '4', '5', '6', '7'].join('\n');
    const [o] = gateObservations(base, { gate: 'four-checks', pass: false, results: [{ name: 'test', command: 't', exitCode: 2, tail }] }, [1], 's');
    expect(o).toMatchObject({ verdict: 'fail', reasons: ['3', '4', '5', '6', '7'] });
  });
});

describe('sourcedGateObservations: where each check came from (ticket 37)', () => {
  it('records each check with its source and its ms here, and a cached one with the ms its run took', () => {
    const results = [
      { name: 'lint', command: 'l', exitCode: 0, tail: '', source: 'cached' as const, ms: 0, savedMs: 4200 },
      { name: 'test', command: 't', exitCode: 1, tail: 'FAIL', source: 'ran' as const, ms: 3400 },
    ];
    expect(sourcedGateObservations(base, { gate: 'four-checks', pass: false, results }, 'abc')).toStrictEqual([
      { ...base, kind: 'gate', gate: 'lint', sha: 'abc', verdict: 'pass', reasons: [], ms: 0, source: 'cached', savedMs: 4200 },
      { ...base, kind: 'gate', gate: 'test', sha: 'abc', verdict: 'fail', reasons: ['FAIL'], ms: 3400, source: 'ran' },
    ]);
  });

  it('records a gate that could not run as before, with no source', () => {
    expect(sourcedGateObservations(base, { gate: 'four-checks', pass: false, results: [], error: 'no checks' }, '')).toEqual([
      { ...base, kind: 'gate', gate: 'four-checks', sha: '', verdict: 'could-not-run', reasons: ['no checks'], ms: 0 },
    ]);
  });
});
