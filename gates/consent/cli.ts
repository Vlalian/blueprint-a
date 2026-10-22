// @process-shell
// node gates/consent/cli.ts --staged | --base <ref> [--branch <name>] [--config <path>]
// The consent gate for any CI or pre-commit (ticket 72): exit 0 pass, 1 refused, 2 could not run.
// The owner and the ticket folder are in --config (default config/consent.json); the locked paths
// are the locks gate's list (config/locks.json, or its default).
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { emit, failClosed } from '../lib/contract.ts';
import { lockList } from '../locks/gate.ts';
import { parseConsent } from './core.ts';
import { consentCheck } from './gate.ts';
import { file, gitConsentIo, indexFile, repoRoot } from './io.ts';

const { values } = parseArgs({ options: { staged: { type: 'boolean', default: false }, base: { type: 'string' }, branch: { type: 'string' }, config: { type: 'string', default: join('config', 'consent.json') } } });
emit(failClosed('consent', () => {
  const root = repoRoot();
  // --staged judges the index, so its configuration comes from the index too.
  const read = (path: string) => values.staged ? indexFile(root, path) : file(root, path);
  const config = read(values.config);
  if (config === undefined) throw new Error(`${values.config} is missing: it names the owner and the ticket folder`);
  return consentCheck(gitConsentIo(root, values), parseConsent(config), lockList({ read }));
}));
