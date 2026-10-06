// HTTP for the Azure DevOps host adapter (ticket 54). The gates and the controller are synchronous
// (spawnSync, a blocking sleep), and fetch is not, so a request runs in a child node process:
// fetch-once.ts reads one request on stdin, fetches it and prints the reply. The request, its
// Authorization header included, goes over stdin only: never on a command line, never in a file.
// The client is a plain function, so tests pass recorded replies instead.

import type { ProcessResult } from './process-result.ts';

export interface HttpRequest {
  method: 'GET' | 'POST' | 'PATCH';
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface HttpReply {
  status: number;
  body: string;
}

/** One request, one reply; throws only when no reply came (network, DNS, proxy). */
export type HttpClient = (request: HttpRequest) => HttpReply;

/** What fetch-once.ts prints for the request it read: the reply's status and body, as JSON. */
export async function fetchOnce(input: string, fetchFn: typeof fetch): Promise<string> {
  const { method, url, headers, body } = JSON.parse(input) as HttpRequest;
  const reply = await fetchFn(url, { method, headers, body });
  return JSON.stringify({ status: reply.status, body: await reply.text() });
}

/** The client that runs fetch-once.ts: `run` starts it with the request as its stdin. */
export function childHttp(run: (input: string) => ProcessResult): HttpClient {
  return (request) => {
    const r = run(JSON.stringify(request));
    if (r.status !== 0) throw new Error(`the HTTP request could not be made: ${(r.stderr || r.error?.message || `exit ${r.status}`).trim()}`);
    return JSON.parse(r.stdout) as HttpReply;
  };
}

/** text with every copy of each non-empty secret replaced. */
export function redact(text: string, secrets: string[]): string {
  return secrets.filter((s) => s !== '').reduce((t, s) => t.replaceAll(s, '[redacted]'), text);
}
