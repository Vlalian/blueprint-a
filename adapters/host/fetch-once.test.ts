// The child the synchronous HTTP client runs, end to end through process.execPath. No network: a
// data: URL is answered by fetch itself, and a scheme fetch does not speak fails before any request.

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { childHttp } from './http.ts';

// Spawns processes: under a full-suite load on Windows they run several times slower (ticket 29).
vi.setConfig({ testTimeout: 60_000 });

const SCRIPT = join(import.meta.dirname, 'fetch-once.ts');
const run = (input: string) => spawnSync(process.execPath, [SCRIPT], { input, encoding: 'utf8' });
const SECRET = 'Basic OmZha2UtdG9rZW4tZm9yLXRlc3Rz';

describe('fetch-once', () => {
  it('answers a request with the reply status and body, printing nothing of the headers', () => {
    const r = run(JSON.stringify({ method: 'GET', url: 'data:application/json,{"count":0}', headers: { Authorization: SECRET } }));
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ status: 200, body: '{"count":0}' });
    expect(r.stdout + r.stderr).not.toContain(SECRET);
  });

  it('exits 1 naming why when no reply came, printing nothing of the headers', () => {
    const r = run(JSON.stringify({ method: 'GET', url: 'ftp://example.test/x', headers: { Authorization: SECRET } }));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/fetch failed/);
    expect(r.stdout + r.stderr).not.toContain(SECRET);
  });

  it('is what childHttp runs', () => {
    expect(childHttp(run)({ method: 'GET', url: 'data:text/plain,hello', headers: {} })).toEqual({ status: 200, body: 'hello' });
  });
});
