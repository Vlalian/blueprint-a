// Ticket 39: a CRAP failure from complexity alone comes back to the cleaner with a Complexity
// section after the ticket; the skill says what that round asks.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');
const SKILL = readFileSync(join(ROOT, 'skills', 'cleaner', 'SKILL.md'), 'utf8');
const flat = SKILL.replace(/\s+/g, ' ');

describe('cleaner skill', () => {
  it('splits each function a Complexity section names, under the ceiling, without changing behaviour or tests', () => {
    expect(flat).toContain('If your brief ends with a `## Complexity` section');
    expect(flat).toContain('complexity of 6 or less');
    expect(flat).toContain("the hardener's proposal");
    expect(flat).toContain('the existing tests stay green');
  });

  // Ticket 48: Matt Pocock's codebase-design and code-review skills, v1.3.1.
  it('applies the deletion test to each module the change added', () => {
    expect(flat).toContain('Apply the deletion test to each module the change added: would deleting it make its callers simpler? When it would, the module is a pass-through: inline it.');
  });

  it("checks the change for Fowler's twelve smells as judgement calls, with project standards first", () => {
    const smells = [
      'Mysterious Name', 'Duplicated Code', 'Feature Envy', 'Data Clumps', 'Primitive Obsession', 'Repeated Switches',
      'Shotgun Surgery', 'Divergent Change', 'Speculative Generality', 'Message Chains', 'Middle Man', 'Refused Bequest',
    ];
    const list = /Fowler's twelve smells, each a judgement call: (.*?)\. The project's standards override them/.exec(flat)?.[1]?.split(', ');
    expect(list).toEqual(smells);
  });

});
