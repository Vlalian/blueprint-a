// The run queue on real files (decision 30): the QueueIo for scripts/queue.ts, with this process
// as the claimer and a real process check (lock-fs.ts). A move renames onto a name nothing else
// uses, which works the same on Windows, where a rename onto an existing file fails.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname } from 'node:path';
import { ifThere, isAlive } from '../runner/lock-fs.ts';
import type { QueueIo } from './queue.ts';

const inFolder = (path: string) => (mkdirSync(dirname(path), { recursive: true }), path);

export const queueFs: QueueIo = {
  list: (dir) => (existsSync(dir) ? readdirSync(dir) : []),
  write: (path, text) => writeFileSync(inFolder(path), text),
  move: (from, to) => renameSync(from, inFolder(to)),
  read: (path) => ifThere(() => readFileSync(path, 'utf8')),
  remove: (path) => rmSync(path, { force: true }),
  self: { pid: process.pid, host: hostname() },
  isAlive: (pid) => isAlive(pid),
};
