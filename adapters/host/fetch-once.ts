// node adapters/host/fetch-once.ts < request.json
// Makes one HTTP request read as JSON on stdin ({ method, url, headers, body }) and prints the reply
// as JSON ({ status, body }); exit 0 when a reply came, whatever its status, 1 when none did. The
// synchronous client in http.ts runs it. It prints nothing of the request, its headers least of all.

import { text } from 'node:stream/consumers';
import { fetchOnce } from './http.ts';

try {
  process.stdout.write(await fetchOnce(await text(process.stdin), fetch));
} catch (e) {
  // fetch names the cause (DNS, refused, TLS) in e.cause; neither carries the request's headers.
  const cause = (e as Error & { cause?: Error }).cause;
  process.stderr.write(`${(e as Error).message}${cause ? `: ${cause.message}` : ''}\n`);
  process.exitCode = 1;
}
