// Renders the pre-commit template for one project: absolute paths to node and the Workflow repo,
// the fingerprint of the repo's other git hooks and the state folder for the tamper gate
// (gates/tamper/repo.ts takes the fingerprint), plus the project's own check commands.

const forward = (p: string) => p.split('\\').join('/');

/** A string as one single-quoted POSIX shell word, safe whatever quotes it contains. */
export const shellQuote = (s: string) => `'${s.split("'").join(`'\\''`)}'`;

export function renderPreCommit(template: string, opts: { node: string; workflowHome: string; checks: string[]; hooks: string; state: string }): string {
  const checks = opts.checks
    .map((c) => `${c} || { echo "pre-commit: project check failed:" ${shellQuote(c)} >&2; exit 1; }`)
    .join('\n');
  // Replacer functions, not strings: a `$&` or `$$` in a path or a check is copied as it is.
  return template
    .replaceAll('__NODE__', () => forward(opts.node))
    .replaceAll('__WORKFLOW_HOME__', () => forward(opts.workflowHome))
    .replaceAll('__HOOKS__', () => opts.hooks)
    .replaceAll('__STATE__', () => forward(opts.state))
    .replace('__PROJECT_CHECKS__', () => checks);
}
