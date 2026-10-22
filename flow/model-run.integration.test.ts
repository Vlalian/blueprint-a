import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { flowIo } from './flow-io.ts';
import { render } from './model-run.ts';

const dir = mkdtempSync(join(tmpdir(), 'flow-model-run-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// Values a repo path or a branch can carry that a shell would act on; cmd cannot take a double quote at all.
const VALUES =
  process.platform === 'win32'
    ? { worktree: join(dir, 'a b', '%PATH%', "it's & more ^ | <x>"), branch: 'ticket/1-a!b' }
    : { worktree: join(dir, 'a b', '$(printf changed)', '`printf tick`', `it's "quoted" $HOME`), branch: 'ticket/1-a"; printf no; "' };

describe('a model command through the real shell', () => {
  it('passes each placeholder to the program as the literal value, one argument each', () => {
    const io = flowIo(dir);
    const { command, env } = render(`"${process.execPath}" -e "process.stdout.write(JSON.stringify(process.argv.slice(1)))" {worktree} {branch}`, VALUES, io.platform);
    const r = io.shell(command, dir, '', 60_000, env);
    expect(r.stderr).toBe('');
    expect(JSON.parse(r.stdout)).toEqual([VALUES.worktree, VALUES.branch]);
  }, 60_000);
});
