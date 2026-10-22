// @process-shell
// Lock backstop for the repo these gates sit in. Other projects use their own checks; --staged reads
// the index, --branch names the ticket branch on a detached HEAD, --relock rewrites config/locks.lock.
import { parseArgs } from 'node:util';
import { emit, failClosed } from '../lib/contract.ts';
import { lockRoot, locksIo, workflowLocks } from './io.ts';
import { locksCommand } from './gate.ts';

const { values } = parseArgs({ options: { staged: { type: 'boolean', default: false }, branch: { type: 'string' }, relock: { type: 'boolean', default: false } } });
const root = lockRoot();
const io = locksIo(root, values.staged);
emit(failClosed('locks', () => workflowLocks(root) ? locksCommand(values.relock, { ...io, branch: () => values.branch ?? io.branch() }) : { gate: 'locks', pass: true }));
