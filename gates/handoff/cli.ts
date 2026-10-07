// node gates/handoff/cli.ts --draft <file> --outbox <dir> [--cwd <repo>]
// Validates a handoff draft and writes the canonical file into the outbox (tmp file, then a hard
// link, so a reader never sees half a file and an existing file is never overwritten). The sender and the known roles come from the agent's
// environment (WORKFLOW_ROLE, WORKFLOW_ROLES), never from the draft. Logic in gate.ts.
// Exit 0 written, 1 refused (repair messages on stdout), 2 could not run.

import { spawnSync } from 'node:child_process';
import { existsSync, linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { emit, failClosed } from '../lib/contract.ts';
import { claimSequence, commitFromGit, createdExclusively, handoffGate, type HandoffGateIo } from './gate.ts';

type Options = { draft?: string; outbox?: string; cwd?: string };

const options = (): Options => parseArgs({ options: { draft: { type: 'string' }, outbox: { type: 'string' }, cwd: { type: 'string' } } }).values;
const cwdOf = (o: Options) => o.cwd ?? process.cwd();

const outboxOf = (o: Options) => o.outbox ?? '';

/** The outbox folder, created with its tmp and claim folders; '' when none was given (the gate refuses that). */
function prepared(outbox: string): string {
  if (outbox) {
    mkdirSync(join(outbox, 'tmp'), { recursive: true });
    mkdirSync(join(outbox, '.claimed'), { recursive: true });
  }
  return outbox;
}

/** Claims the next number with an exclusive marker in .claimed/, then records it in .sequence. */
function nextSequence(outbox: string): number {
  const file = join(outbox, '.sequence');
  const claim = (n: number) => createdExclusively(() => writeFileSync(join(outbox, '.claimed', String(n)), '', { flag: 'wx' }));
  const next = claimSequence(existsSync(file) ? readFileSync(file, 'utf8') : undefined, claim);
  writeFileSync(file, String(next));
  return next;
}

/** tmp file, then a hard link: atomic, and it fails EEXIST rather than overwrite (renameSync would). */
function writeNew(outbox: string, name: string, text: string): void {
  const tmp = join(outbox, 'tmp', `${name}.tmp`);
  writeFileSync(tmp, text);
  try {
    linkSync(tmp, join(outbox, name));
  } finally {
    rmSync(tmp);
  }
}

function io(cwd: string, outbox: string): HandoffGateIo {
  return {
    readDraft: (p) => readFileSync(p, 'utf8'),
    env: process.env,
    // LC_ALL=C: commitFromGit reads git's English messages, and Git for Windows may be localised.
    resolveCommit: (abbrev) =>
      commitFromGit(spawnSync('git', ['rev-parse', '--verify', `${abbrev}^{commit}`], { cwd, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } })),
    now: () => new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    nextSequence: () => nextSequence(outbox),
    writeToOutbox: (name, text) => writeNew(outbox, name, text),
  };
}

// Everything that can throw runs inside failClosed, so a bad option or outbox exits 2, never 1.
emit(
  failClosed('handoff', () => {
    const o = options();
    return handoffGate(o, io(cwdOf(o), prepared(outboxOf(o))));
  }),
);
