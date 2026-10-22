// node scripts/evaluate.ts --since <ref or time> [--now <iso time>] [--state <dir>] [--root <repo>]
// The evaluation report (ticket 15c): every function's value, cost, trend and rule-based
// suggestion over the window after --since (a commit, whose commit time is used, or a time), from
// <state>/logs/observations.jsonl (default: the repo's state/). Writes docs/evaluations/<date>.md
// and .json under --root (default: this repo) and prints their paths. Deterministic: no model call;
// the evaluator agent only words the summary. Exit 0, or 2 when a config cannot be read or --since
// is neither. The decisions are in evaluate-core.ts; this file only wires in the files, git and the clock.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { evaluationBefore, evaluationReport, sinceTime } from './evaluate-core.ts';

const { values } = parseArgs({ options: { since: { type: 'string', default: '' }, now: { type: 'string' }, state: { type: 'string' }, root: { type: 'string' } } });
const ROOT = resolve(values.root ?? join(import.meta.dirname, '..'));
const now = values.now ?? new Date().toISOString();
const read = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8') : undefined);
const evaluations = join(ROOT, 'docs', 'evaluations');
const previous = evaluationBefore(existsSync(evaluations) ? readdirSync(evaluations) : [], (name) => read(join(evaluations, name)), now.slice(0, 10));
const commit = spawnSync('git', ['log', '-1', '--format=%cI', values.since, '--'], { cwd: ROOT, encoding: 'utf8' });
const since = sinceTime(values.since, commit);

const report = evaluationReport(
  {
    observations: read(join(values.state ?? join(ROOT, 'state'), 'logs', 'observations.jsonl')),
    registry: read(join(ROOT, 'config', 'functions.json')),
    prices: read(join(ROOT, 'config', 'prices.json')),
    config: read(join(ROOT, 'config', 'evaluation.json')),
    previous,
  },
  { since, sinceLabel: values.since, now },
);
for (const [path, text] of report.files) {
  mkdirSync(dirname(join(ROOT, path)), { recursive: true });
  writeFileSync(join(ROOT, path), text);
}
process.stdout.write(report.stdout);
process.stderr.write(report.stderr);
// process.exitCode, never process.exit(): exiting right after a write to a piped stdout crashes
// Node on Windows (exit 0xC0000409).
process.exitCode = report.exitCode;
