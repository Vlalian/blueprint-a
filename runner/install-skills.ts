// Install the router skill and its linked reference under os.homedir(). Ticket 97: roles run as
// general-purpose subagents, so no agent file is written and the old dispatch-worker is removed.
// @process-shell
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export function installDispatch(root: string, home: () => string = homedir): string {
  const destination = join(home(), '.claude', 'skills', 'dispatch');
  rmSync(destination, { recursive: true, force: true });
  cpSync(join(root, 'skills', 'dispatch'), destination, { recursive: true });
  rmSync(join(home(), '.claude', 'agents', 'dispatch-worker.md'), { force: true });
  const path = join(destination, 'SKILL.md');
  const source = readFileSync(path, 'utf8');
  writeFileSync(path, source.replaceAll('{{WORKFLOW_ROOT}}', root));
  return path;
}

if (import.meta.main) process.stdout.write(`Wrote ${installDispatch(resolve(import.meta.dirname, '..'))}\n`);
