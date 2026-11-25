// The sast gate's Python part (ticket 99): bandit's findings on the Python source files a change
// touched, read from its JSON, in the shape of a Semgrep finding so gate.ts judges both alike.
// HIGH and MEDIUM severity block (ERROR); LOW is reported (WARNING). bandit honours its own
// `# nosec` comments; a `# nosec` here must name the bandit test it silences and give a reason after
// ` -- `, or it is itself a blocking finding, as a nosemgrep comment is. Semgrep's p/python runs in
// CI on Linux instead (templates/ci), where Semgrep is not experimental. Pure.

import { relative, resolve } from 'node:path';
import { isTestFile } from '../lib/test-files.ts';
import type { Finding } from './core.ts';

const slashed = (p: string) => p.split('\\').join('/');

/** The changed Python source files bandit scans: no tests (nor conftest.py), no fixtures, no top-level dist/. */
export const banditSources = (files: string[]) =>
  files.filter((f) => f.endsWith('.py') && !isTestFile(f) && !/(?:^|\/)conftest\.py$/.test(f) && !f.split('/').includes('fixtures') && !f.startsWith('dist/'));

/** bandit's arguments before the target files. */
export const BANDIT_ARGS = ['-f', 'json', '-q'];

type Raw = { test_id: string; issue_severity: string; issue_confidence: string; filename: string; line_number: number; issue_text: string };
type Output = { results?: Raw[]; errors?: Array<{ filename: string; reason: string }> };

const BLOCKING = new Set(['HIGH', 'MEDIUM']);

/**
 * bandit's `-f json` output and exit status (0 clean, 1 issues found), its file names (as it was
 * given them: absolute, or joined onto `dir`) made relative to `dir`; throws when it could not run.
 */
export function parseBandit(stdout: string, status: number | null, dir: string): { findings: Finding[]; notScanned: string[] } {
  const out = jsonOf(stdout);
  if (!FINISHED.has(status) || !Array.isArray(out?.results)) throw new Error(`bandit exited ${status}: no JSON on stdout`);
  const fileOf = (name: string) => slashed(relative(resolve(dir), resolve(name)));
  return {
    findings: out.results.map((r) => findingOf(r, fileOf(r.filename))),
    notScanned: (out.errors ?? []).map((e) => `${fileOf(e.filename)}: ${e.reason}`),
  };
}

// bandit exits 0 when it finds nothing and 1 when it finds something; any other exit did not scan.
const FINISHED = new Set<number | null>([0, 1]);

function jsonOf(stdout: string): Output | undefined {
  try {
    return JSON.parse(stdout) as Output;
  } catch {}
}

const findingOf = (r: Raw, file: string): Finding => ({
  rule: `bandit.${r.test_id}`,
  severity: BLOCKING.has(r.issue_severity) ? 'ERROR' : 'WARNING',
  file,
  line: r.line_number,
  message: `${r.issue_text} (bandit ${r.issue_severity}, confidence ${r.issue_confidence})`,
});

const NOSEC = /#\s*nosec\b(.*)$/;
const REASONED = /^\s*:?\s*B\d{3}(?:\s*,\s*B\d{3})*\s+--\s*\S/;
const STRING = /(["'])(?:\\.|(?!\1).)*\1/g;
const NO_REASON = 'a # nosec comment needs the bandit test id and a reason: # nosec B602 -- <reason>';

/** A blocking finding for each `# nosec` comment (outside a string) that names no bandit test or gives no reason. */
export function nosecFindings(texts: Map<string, string>): Finding[] {
  return [...texts].flatMap(([file, text]) =>
    text.split(/\r?\n/).flatMap((line, i) => {
      const m = NOSEC.exec(line.replace(STRING, '""'));
      return m === null || REASONED.test(m[1]!) ? [] : [{ rule: 'sast.suppression-without-reason', severity: 'ERROR', file, line: i + 1, message: NO_REASON }];
    }),
  );
}
