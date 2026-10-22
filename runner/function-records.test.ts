import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { denialObservations, hookObservation, sessionObservations, streamObservations, type StreamRun } from './function-records.ts';
import type { Observation } from './observations.ts';

const ROOT = resolve(import.meta.dirname, '..');
const recorded = (name: string) => readFileSync(join(ROOT, 'test', 'fixtures', 'sessions', name), 'utf8');
const BASE = { at: '2026-10-04T10:00:00.000Z', run: 'r1', project: 'sample', ticket: 'sample-01-coder', role: 'coder' };

describe('sessionObservations: the tokens of one headless session, per model, from its recorded JSON result', () => {
  it('writes one record per model the session used, with its tokens, the wall time, the outcome and the skills', () => {
    const records = sessionObservations(BASE, 'role:coder', { model: 'sonnet', skills: ['coder', 'no-ai-slop'], ms: 91_500 }, recorded('coder-two-models.json'));
    expect(records).toEqual<Observation[]>([
      { ...BASE, kind: 'session', fn: 'role:coder', model: 'claude-sonnet-4-5', tokensIn: 1000, tokensOut: 2400, cacheRead: 45000, cacheWrite: 3000, ms: 91_500, outcome: 'ok', skills: ['coder', 'no-ai-slop'] },
      { ...BASE, kind: 'session', fn: 'role:coder', model: 'claude-haiku-4-5', tokensIn: 200, tokensOut: 100, cacheRead: 0, cacheWrite: 0, ms: 0, outcome: 'ok', skills: ['coder', 'no-ai-slop'] },
    ]);
  });

  it('falls back to the summed usage under the configured model when the result has no per-model usage', () => {
    expect(sessionObservations(BASE, 'role:reviewer', { model: 'sonnet', skills: ['review'], ms: 30_000 }, recorded('reviewer-usage-only.json'))).toEqual([
      { ...BASE, kind: 'session', fn: 'role:reviewer', model: 'sonnet', tokensIn: 800, tokensOut: 300, cacheRead: 2000, cacheWrite: 100, ms: 30_000, outcome: 'ok', skills: ['review'] },
    ]);
  });

  it('records a crashed session with no result as an error with no tokens, so the zero guard sees it', () => {
    expect(sessionObservations(BASE, 'role:skeptic', { model: 'opus', skills: ['skeptic'], ms: 5 }, recorded('crashed.txt'))).toEqual([
      { ...BASE, kind: 'session', fn: 'role:skeptic', model: 'opus', tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, ms: 5, outcome: 'error', skills: ['skeptic'] },
    ]);
  });

  it('reads a reported error as an error, an empty per-model usage as absent, and a missing or odd count as 0', () => {
    const text = JSON.stringify({ is_error: true, modelUsage: {}, usage: { input_tokens: 'x', output_tokens: 7 } });
    expect(sessionObservations(BASE, 'role:coder', { model: 'm', skills: [], ms: 1 }, text)).toEqual([
      { ...BASE, kind: 'session', fn: 'role:coder', model: 'm', tokensIn: 0, tokensOut: 7, cacheRead: 0, cacheWrite: 0, ms: 1, outcome: 'error', skills: [] },
    ]);
    const odd = JSON.stringify({ is_error: false, modelUsage: { a: null } });
    expect(sessionObservations(BASE, 'role:coder', { model: 'm', skills: [], ms: 1 }, odd)).toEqual([
      { ...BASE, kind: 'session', fn: 'role:coder', model: 'a', tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, ms: 1, outcome: 'ok', skills: [] },
    ]);
    expect(sessionObservations(BASE, 'f', { model: 'm', skills: [], ms: 1 }, 'null')[0]).toMatchObject({ outcome: 'error', tokensIn: 0 });
  });

  it('records each tool call the session was denied after its tokens, with its target (ticket 52)', () => {
    const records = sessionObservations(BASE, 'role:coder', { model: 'sonnet', skills: ['coder'], ms: 420_000 }, recorded('coder-denied.json'));
    expect(records.slice(1)).toEqual<Observation[]>([
      { ...BASE, kind: 'denial', tool: 'Bash', target: 'git push origin HEAD' },
      { ...BASE, kind: 'denial', tool: 'WebFetch', target: 'https://example.com/docs' },
    ]);
    expect(records[0]).toMatchObject({ kind: 'session', tokensIn: 1000 });
  });

  it('reads a denial with no tool name or input as unknown with no target, and odd denials as none', () => {
    expect(denialObservations(BASE, JSON.stringify({ permission_denials: [{}, null] }))).toEqual([
      { ...BASE, kind: 'denial', tool: 'unknown', target: '' },
      { ...BASE, kind: 'denial', tool: 'unknown', target: '' },
    ]);
    expect(denialObservations(BASE, JSON.stringify({ permission_denials: 'Bash' }))).toEqual([]);
    expect(denialObservations(BASE, 'not json')).toEqual([]);
  });
});

describe('hookObservation and streamObservations', () => {
  it('records one hook call with its wall time and whether it blocked', () => {
    expect(hookObservation(BASE, 'pre-tool', 1234.6, 'block')).toEqual({ ...BASE, kind: 'hook', hook: 'pre-tool', ms: 1235, outcome: 'block' });
  });

  it('records each watched repo of a checked upstream run as a substream: commits read and proposals made', () => {
    const run: StreamRun = {
      status: 'checked',
            repos: [
        { repo: 'a/one', commits: 5 },
        { repo: 'b/two', commits: 0 },
      ],
      proposals: [{ repo: 'a/one' }, { repo: 'a/one' }],
    };
    expect(streamObservations(BASE, run)).toEqual([
      { ...BASE, kind: 'stream', stream: 'a/one', items: 5, ideas: 2 },
      { ...BASE, kind: 'stream', stream: 'b/two', items: 0, ideas: 0 },
    ]);
  });

  it('records nothing for a skipped or failed upstream run', () => {
    expect(streamObservations(BASE, { status: 'skipped' })).toEqual([]);
    expect(streamObservations(BASE, { status: 'failed' })).toEqual([]);
  });
});
