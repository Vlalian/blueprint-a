// node gates/plan/cli.ts --plan <plan.md> --ticket <ticket.md> [--allow <command>]… [--repo <dir>] [--research <dir>]
// Checks a plan before it reaches the owner. Exit 0 pass, 1 fail, 2 could not run. Logic in gate.ts.
// --research is the ticket's folder of claims files, state/research/<project>/<ticket>/ in the
// Workflow repo (ticket 35): every claim ID the plan cites must be in one of them.

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { emit, failClosed } from '../lib/contract.ts';
import { claimsIn, planGate } from './gate.ts';
import { existsInRepo } from './repo-path.ts';

// parseArgs runs inside failClosed, so an unknown option exits 2, never 1.
emit(
  failClosed('plan', () => {
    const { values } = parseArgs({
      options: { plan: { type: 'string' }, ticket: { type: 'string' }, allow: { type: 'string', multiple: true }, repo: { type: 'string' }, research: { type: 'string' } },
    });
    const repo = values.repo ?? process.cwd();
    return planGate(values, {
      readPlan: (p) => readFileSync(p, 'utf8'),
      readTicket: (p) => readFileSync(p, 'utf8'),
      exists: (p) => existsInRepo(repo, p, realpathSync),
      claims: claimsIn(values.research, (p) => (existsSync(p) ? readFileSync(p, 'utf8') : undefined)),
    });
  }),
);
