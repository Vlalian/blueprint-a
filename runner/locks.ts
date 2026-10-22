// @process-shell
// node scripts/locks.ts --relock: this repo's writer of config/locks.lock (gates/locks/cli.ts --relock
// is the same writer where the gates travel without scripts/, ticket 72).
import { parseArgs } from 'node:util';
import { emit, failClosed } from '../gates/lib/contract.ts';
import { locksCommand } from '../gates/locks/gate.ts';
import { lockRoot, locksIo } from '../gates/locks/io.ts';

const { values } = parseArgs({ options: { relock: { type: 'boolean', default: false } } });
emit(failClosed('locks', () => locksCommand(values.relock, locksIo(lockRoot(), false))));
