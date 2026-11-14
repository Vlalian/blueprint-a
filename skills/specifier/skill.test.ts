// Ticket 35: the specifier's skill takes its test paths and its research folder from its brief,
// which takes them from project.json, never from a fixed tests/new/ or the project's research/.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');
const SKILL = readFileSync(join(ROOT, 'skills', 'specifier', 'SKILL.md'), 'utf8');
const flat = SKILL.replace(/\s+/g, ' ');

describe('specifier skill', () => {
  it('writes and runs its tests under the test paths in its brief, never a fixed tests/new/', () => {
    expect(flat).toContain('under the test paths in your brief');
    expect(flat).toContain('Your tools allow edits under the test paths in your brief only.');
    expect(SKILL).not.toContain('tests/new/');
  });

  it('knows that a round with no new test fails the red check', () => {
    expect(flat).toContain('a round that adds no test fails too');
  });

  it("reads its research from the folder its brief names, not the project's research/", () => {
    expect(flat).toContain('from the claims files in the research folder your brief names, outside the project');
    expect(SKILL).not.toContain("the project's `research/`");
  });

});
