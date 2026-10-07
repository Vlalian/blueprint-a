// node gates/git-guard/cli.ts --branch <checked-out branch> [--dialect sh|powershell|cmd] "<command line>"
// Says whether an agent may run a shell command line under the git and gh rules. Exit 0 pass,
// 1 blocked (each blocked command and why in the JSON), 2 could not run or could not read the
// line. The logic is in gate.ts.

import { emit, failClosed } from '../lib/contract.ts';
import { gitGuard } from './gate.ts';

emit(failClosed('git-guard', () => gitGuard(process.argv.slice(2))));
