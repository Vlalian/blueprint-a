// node gates/ci-on-sha/cli.ts [--sha <ref>] [--cwd <repo>] [--project <name>]
// Passes only when CI is green on the exact commit the ref names (HEAD by default), read through
// the host the project's project.json "pr" names (GitHub through gh when no project or no host is
// given; Azure DevOps with AZURE_DEVOPS_PAT from the environment). Exit 0 green, 1 failing or
// still pending, 2 could not run. Logic in gate.ts.

import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { hostConfigOf } from '../../adapters/host/config.ts';
import { hostFor, readProjectJson } from './host-io.ts';
import { emit, failClosed } from '../lib/contract.ts';
import { ciOnShaGate, type CiOnShaIo } from './gate.ts';

const options = () => parseArgs({ options: { sha: { type: 'string' }, cwd: { type: 'string', default: '.' }, project: { type: 'string' } } }).values;

const prOf = (project: string | undefined) => (project === undefined ? undefined : (readProjectJson(project) as { pr?: unknown }).pr);

function io(cwd: string, project: string | undefined): CiOnShaIo {
  return {
    resolveSha: (ref) => execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim(),
    host: hostFor(cwd, hostConfigOf(prOf(project))),
  };
}

// Everything that can throw runs inside failClosed, so a bad option, ref, project or missing token exits 2, never 1.
emit(
  failClosed('ci-on-sha', () => {
    const o = options();
    return ciOnShaGate(o, io(o.cwd, o.project));
  }),
);
