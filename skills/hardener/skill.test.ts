// Ticket 36: the hardener's skill takes its test paths from its brief, which takes them from
// project.json, never from a fixed tests/hardener/ outside the app's test include; and it may run
// its project's checks itself.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');
const SKILL = readFileSync(join(ROOT, 'skills', 'hardener', 'SKILL.md'), 'utf8');
const flat = SKILL.replace(/\s+/g, ' ');

describe('hardener skill', () => {
  it('writes its tests under the test paths in its brief, never a fixed tests/hardener/', () => {
    expect(flat).toContain('Your tools allow new files under the test paths in your brief only.');
    expect(SKILL).not.toContain('tests/hardener/');
  });

  it("runs its project's checks itself, on the files it names", () => {
    expect(flat).toContain("You may run your project's checks yourself");
  });

  // Ticket 39: tests cannot lower a fully covered function's CRAP below its complexity.
  it('leaves a function whose complexity alone is over the ceiling to the cleaner, with the split as a SIMPLIFY block', () => {
    expect(flat).toContain('complexity alone is over 6');
    expect(flat).toContain('the dispatcher sends it back to the cleaner');
  });

});
