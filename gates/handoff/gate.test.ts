import { describe, expect, it } from 'vitest';
import { claimSequence, createdExclusively, nextSequenceAfter, commitFromGit, handoffGate, type HandoffGateIo } from './gate.ts';

describe('commitFromGit', () => {
  it('reads git rev-parse: a SHA on success, ambiguous when git says so, else null', () => {
    expect(commitFromGit({ status: 0, stdout: 'abc123\n', stderr: '' })).toEqual({ sha: 'abc123' });
    expect(commitFromGit({ status: 128, stdout: '', stderr: 'error: short object ID a1 is ambiguous' })).toBe('ambiguous');
    expect(commitFromGit({ status: 128, stdout: '', stderr: 'fatal: Needed a single revision\n' })).toBeNull();
  });

  it('throws, so the gate exits 2, when git could not look at all (review #23)', () => {
    // Not a repo, git missing or killed: the draft is not at fault, and must not be told it is.
    expect(() => commitFromGit({ status: 128, stdout: '', stderr: 'fatal: not a git repository (or any of the parent directories): .git\n' })).toThrow(
      // An Error, so the whole message is compared: a substring would let a trailing newline through.
      new Error('git could not look up the commit: fatal: not a git repository (or any of the parent directories): .git'),
    );
    expect(() => commitFromGit({ status: 1, stdout: '', stderr: '' })).toThrow('git could not look up the commit: exit 1');
    expect(() => commitFromGit({ status: null, stdout: null, stderr: null })).toThrow('git could not look up the commit: exit null');
  });
});

function fakeIo(draft: string) {
  const written: Array<[string, string]> = [];
  const io: HandoffGateIo = {
    readDraft: () => draft,
    env: { WORKFLOW_ROLE: 'coder', WORKFLOW_ROLES: 'coder,cleaner' },
    resolveCommit: () => ({ sha: 'f'.repeat(40) }),
    now: () => '2026-10-04T08:00:00Z',
    nextSequence: () => 1,
    writeToOutbox: (name, text) => void written.push([name, text]),
  };
  return { io, written };
}

describe('handoffGate', () => {
  it('writes a valid draft to the outbox and passes', () => {
    const { io, written } = fakeIo('type: note\nto: cleaner\npriority: 70\nmessage: Ready when you are.\n');
    expect(handoffGate({ draft: 'd', outbox: 'o' }, io)).toEqual({
      gate: 'handoff',
      pass: true,
      errors: [],
      file: '70_20261004T080000Z_000001_from_coder_to_cleaner.handoff',
    });
    expect(written.map(([n]) => n)).toEqual(['70_20261004T080000Z_000001_from_coder_to_cleaner.handoff']);
  });

  it('writes nothing and fails on an invalid draft', () => {
    const { io, written } = fakeIo('type: chat\n');
    expect(handoffGate({ draft: 'd', outbox: 'o' }, io)).toMatchObject({ pass: false, errors: ['type must be git_handoff, note or research_request; got "chat"'] });
    expect(written).toEqual([]);
  });

  it('refuses when the environment does not say who is sending', () => {
    const { io } = fakeIo('type: note\nto: cleaner\npriority: 70\nmessage: x\n');
    io.env = {};
    expect(handoffGate({ draft: 'd', outbox: 'o' }, io).errors).toContain('to: unknown role "cleaner" (known: )');
  });

  it('reads the role list without empty entries, and names a missing sender', () => {
    const { io } = fakeIo('type: note\nto: reviewer\npriority: 70\nmessage: x\n');
    io.env = { WORKFLOW_ROLE: 'coder', WORKFLOW_ROLES: ',coder,,cleaner,' };
    expect(handoffGate({ draft: 'd', outbox: 'o' }, io).errors).toEqual(['to: unknown role "reviewer" (known: coder, cleaner)']);
    io.env = { WORKFLOW_ROLES: 'coder,cleaner' };
    expect(handoffGate({ draft: 'd', outbox: 'o' }, io).errors[0]).toBe('sender "" (WORKFLOW_ROLE) is not a known role');
  });

  it('throws a usage error without --draft and --outbox', () => {
    expect(() => handoffGate({ draft: 'd' }, fakeIo('').io)).toThrow(/usage: handoff --draft/);
    expect(() => handoffGate({ outbox: 'o' }, fakeIo('').io)).toThrow(/usage: handoff --draft/);
  });
});

describe('nextSequenceAfter', () => {
  it('counts on from the stored number, starting at 1', () => {
    expect(nextSequenceAfter(undefined)).toBe(1);
    expect(nextSequenceAfter('41')).toBe(42);
    expect(nextSequenceAfter('41\n')).toBe(42);
  });

  it.each(['', ' \n', 'abc', '1.5', '-3', '1e400'])('refuses a sequence file holding %j rather than writing a NaN name', (text) => {
    expect(() => nextSequenceAfter(text)).toThrow(`the outbox sequence file holds ${JSON.stringify(text)}, not a count; repair it by hand`);
  });
});

describe('claimSequence — a number no other writer holds (review #24)', () => {
  it('claims the number after the stored one when it is free', () => {
    const asked: number[] = [];
    expect(claimSequence('41', (n) => (asked.push(n), true))).toBe(42);
    expect(asked).toEqual([42]);
  });

  it('counts past numbers another writer already claimed', () => {
    // Two handoffs in the same second both read 41; the second must not reuse 42.
    const taken = new Set([1, 2, 3]);
    expect(claimSequence(undefined, (n) => !taken.has(n))).toBe(4);
  });

  it('refuses a sequence file that is not a count before claiming anything', () => {
    const claim = (): boolean => {
      throw new Error('claimed');
    };
    expect(() => claimSequence('abc', claim)).toThrow('not a count');
  });
});

describe('createdExclusively — an exclusive create read as won or lost', () => {
  it('is true when the create succeeds', () => {
    expect(createdExclusively(() => {})).toBe(true);
  });

  it('is false when the target already exists', () => {
    const exists = Object.assign(new Error('EEXIST: file already exists'), { code: 'EEXIST' });
    expect(
      createdExclusively(() => {
        throw exists;
      }),
    ).toBe(false);
  });

  it('throws any other failure, so the gate exits 2', () => {
    const denied = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    expect(() =>
      createdExclusively(() => {
        throw denied;
      }),
    ).toThrow(denied);
  });
});
