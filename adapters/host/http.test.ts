import { describe, expect, it } from 'vitest';
import { childHttp, fetchOnce, redact, type HttpRequest } from './http.ts';

const REQ: HttpRequest = { method: 'POST', url: 'https://example.test/a', headers: { Accept: 'application/json' }, body: '{"x":1}' };

describe('fetchOnce', () => {
  it('makes the request it reads and prints the status and body', async () => {
    const seen: Array<[string, RequestInit]> = [];
    const fake = (async (url: string, init: RequestInit) => (seen.push([url, init]), new Response('{"ok":true}', { status: 201 }))) as unknown as typeof fetch;
    expect(JSON.parse(await fetchOnce(JSON.stringify(REQ), fake))).toEqual({ status: 201, body: '{"ok":true}' });
    expect(seen).toEqual([['https://example.test/a', { method: 'POST', headers: { Accept: 'application/json' }, body: '{"x":1}' }]]);
  });

  it('passes an error status through as an answer', async () => {
    const fake = (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch;
    expect(JSON.parse(await fetchOnce(JSON.stringify({ ...REQ, method: 'GET', body: undefined }), fake))).toEqual({ status: 401, body: 'nope' });
  });
});

describe('childHttp', () => {
  it('hands the request to the child on stdin and reads its reply', () => {
    const inputs: string[] = [];
    const http = childHttp((input) => (inputs.push(input), { status: 0, stdout: '{"status":200,"body":"{}"}', stderr: '' }));
    expect(http(REQ)).toEqual({ status: 200, body: '{}' });
    expect(inputs.map((i) => JSON.parse(i))).toEqual([REQ]);
  });

  it('throws with the child stderr, the spawn error or the exit code when it could not ask', () => {
    expect(() => childHttp(() => ({ status: 1, stdout: '', stderr: 'fetch failed: ENOTFOUND\n' }))(REQ)).toThrow(/^the HTTP request could not be made: fetch failed: ENOTFOUND$/);
    expect(() => childHttp(() => ({ status: null, stdout: '', stderr: '', error: new Error('spawn ENOENT') }))(REQ)).toThrow('the HTTP request could not be made: spawn ENOENT');
    expect(() => childHttp(() => ({ status: 3, stdout: '', stderr: '' }))(REQ)).toThrow('the HTTP request could not be made: exit 3');
  });
});

describe('redact', () => {
  it('replaces every copy of every secret', () => {
    expect(redact('a s3cret b s3cret c t0ken', ['s3cret', 't0ken'])).toBe('a [redacted] b [redacted] c [redacted]');
  });

  it('ignores an empty secret', () => {
    expect(redact('abc', [''])).toBe('abc');
  });
});
