// A stand-in for Angular's @Injectable, so the fixture reads like an Angular service without the
// Angular runtime.
export function Injectable(_options: { providedIn: 'root' }) {
  return <T>(target: T): T => target;
}
