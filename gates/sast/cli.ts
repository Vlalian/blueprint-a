// @process-shell
// node gates/sast/cli.ts --base <ref> [--cwd <dir>] [--json <path>]
// Semgrep's security rules (ticket 60, pinned in gates/sast/rules) on the source files changed
// since <ref>: fails on a new ERROR finding, reports WARNING ones. Exit 0 pass, 1 fail, 2 could not
// run (Semgrep missing or failing; the JSON says what to install). The logic is in gate.ts; this
// file only wires in Semgrep, git and the file system.

import { emit, failClosed } from '../lib/contract.ts';
import { sastCli } from './gate.ts';
import { realSastIo, SAST_RULES } from './io.ts';

emit(failClosed('sast', () => sastCli(process.argv.slice(2), { rules: SAST_RULES, cwd: process.cwd() }, (cwd) => realSastIo(cwd))));
