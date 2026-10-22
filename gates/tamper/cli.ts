// node gates/tamper/cli.ts (--base <ref> | --staged) --hooks <fingerprint> [--state <state folder>] [--config <file>] [--cwd <dir>]
// Fails when a protected path (config/tamper.json beside the gates, or --config) or the hooks
// differ from the base; the only protected change it lets through is one the exception module the
// config names allows (in this repo: a lesson scripts/apply-lesson wrote under the owner's
// approval). A config in the repo under check is read, with its exception module, at the base
// (HEAD in --staged mode), and is itself protected. It has no skip switch. Exit 0 pass, 1 fail,
// 2 could not run. The logic is in gate.ts.

import { parseArgs } from 'node:util';
import { emit, failClosed, type GateResult } from '../lib/contract.ts';
import { git } from '../lib/git.ts';
import { tamperGate } from './gate.ts';
import { policyGuarded } from './core.ts';
import { configInRepo, HOME_CONFIG, loadException, readTamperConfig } from './io.ts';
import { changesOf, hooksOf, stateFiles } from './repo.ts';

const OPTIONS = { base: { type: 'string' }, staged: { type: 'boolean', default: false }, hooks: { type: 'string' }, state: { type: 'string' }, config: { type: 'string', default: HOME_CONFIG }, cwd: { type: 'string', default: process.cwd() } } as const;

async function run(): Promise<GateResult> {
  const { values } = parseArgs({ options: OPTIONS });
  const top = git(values.cwd, 'rev-parse', '--show-toplevel').trim();
  // The policy comes from the trusted base, never the working tree an agent may have changed.
  const trusted = { top, rev: values.staged ? 'HEAD' : String(values.base) };
  const config = readTamperConfig(values.config, trusted);
  const exception = await loadException(values.config, config, trusted);
  const changes = changesOf(top, values.staged, values.base);
  const protectedPaths = policyGuarded(config, configInRepo(values.config, trusted));
  return tamperGate(values, { ...changes, ...stateFiles, protectedPaths, owner: config.owner, exception, hooks: () => hooksOf(top, config.hooks) });
}

// Anything that throws, an unknown option included, is a could-not-run (exit 2), never a pass.
run().then(emit, (e: unknown) => emit(failClosed('tamper', () => { throw e; })));
