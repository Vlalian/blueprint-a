// The controller's planning section and the grill skill: what they tell the model must match what
// the plan gates check, so a skill cannot drift from the gates that judge its output.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ALLOW } from '../../gates/plan/commands.ts';
import { VAGUE_WORDS } from '../../gates/plan/ears.ts';
import { REQUIRED_HEADERS, REQUIRED_SECTIONS } from '../../gates/plan/lint.ts';
import { BUG_PLAN, BUG_TICKET } from '../../gates/plan/bug-fixtures.ts';
import { bugPlanFindings } from '../../gates/plan/bug.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const skill = (name: string) => readFileSync(join(ROOT, 'skills', name, 'SKILL.md'), 'utf8');
const section = (text: string, title: string) => text.slice(text.indexOf(`## ${title}\n`)).split(/^## (?!#)/m)[1]!;

describe('controller skill, planning section', () => {
  const planning = section(skill('controller'), 'Planning');

  it('names the header lines and the sections the plan linter requires, in its order', () => {
    const list = /```text\n([\s\S]*?)\n```/.exec(planning)![1]!.split('\n');
    expect(list).toEqual([...REQUIRED_HEADERS, ...REQUIRED_SECTIONS]);
  });

  it('names exactly the commands the allowlist lets through', () => {
    const named = [...planning.matchAll(/`((?:npm|npx) [^`]+)`/g)].map((m) => m[1]);
    expect(named).toEqual(DEFAULT_ALLOW);
  });

  it('asks for the plan only, starting at its "Plan for:" line, which is where the controller reads it from', () => {
    expect(planning).toContain('Print the plan and nothing else: start with the `Plan for:` line');
  });
});

// Ticket 48: how the Approach chooses its seams (Matt Pocock's to-spec and codebase-design, v1.3.1).
describe('controller skill, choosing seams', () => {
  const planning = section(skill('controller'), 'Planning').replace(/\s+/g, ' ');

  it('prefers an existing seam, then the highest, then the fewest', () => {
    expect(planning).toContain('Choose seams in this order: an existing seam first, then the highest seam that works, then the fewest seams.');
  });

  it('treats the interface as the test surface', () => {
    expect(planning).toContain('The interface is the test surface: the behaviours test through it.');
  });

  it('calls a seam with one adapter a hypothetical seam, and says so', () => {
    expect(planning).toContain('A seam with one adapter is a hypothetical seam: say so in the plan.');
  });

  it('has modules accept their dependencies and return results', () => {
    expect(planning).toContain('Modules accept their dependencies as arguments and return results to their caller.');
  });
});

// Ticket 51: the bug plan and the triage verdict the skill asks for are what the code checks.
describe('controller skill, bug plans', () => {
  const bug = section(skill('controller'), 'Planning').split('### Bug plans\n')[1]!.split('\n### ')[0]!;

  it('names each section and line the plan linter asks of a bug plan', () => {
    for (const title of ['Reproduction', 'Hypotheses', 'Test seam']) {
      expect(bug).toContain(`**${title}:**`);
      expect(bugPlanFindings(BUG_PLAN.replace(`## ${title}\n`, '## Other\n'), BUG_TICKET).map((f) => f.message)).toContain(`missing section "## ${title}" (the ticket is a bug)`);
    }
    for (const line of ['`Fails before the fix with: <the wrong value>`', '`Minimised: <what you cut to get it this small>`', '`Check: <what you run or read, and what it would show>`', '`## Baseline`', '`[REDACTED]`']) expect(bug).toContain(line);
    expect(bug).toContain('that is a finding of the plan, never a reason to skip the test');
  });
});

describe('grill skill', () => {
  const grill = skill('grill');

  it('keeps the four rules of the interview', () => {
    expect(grill).toContain('**Ask in rounds.**');
    expect(grill).toContain('**Every question comes with your recommended answer**');
    expect(grill).toContain('**Look facts up; do not ask them.**');
    expect(grill).toContain('**Decisions belong to the owner.**');
  });

  it('writes tickets the planning step can plan: EARS criteria under ## Acceptance criteria', () => {
    expect(grill).toContain('`Status: ready-for-agent`');
    expect(grill).toContain('`## Acceptance criteria` in EARS form');
  });

  it('names the five EARS forms and points at the vague-word list the EARS check uses', () => {
    for (const form of ['"The system shall …"', '"When …"', '"While …"', '"Where …"', '"If …, then …"']) expect(grill).toContain(form);
    expect(grill).toContain('`VAGUE_WORDS` in `gates/plan/ears.ts`');
    const named = /\(correctly, ([^)]*);\s+the full list/.exec(grill)![1]!.split(', ');
    expect(['correctly', ...named].filter((w) => !VAGUE_WORDS.includes(w))).toEqual([]);
  });
});

describe('both skills', () => {
  it.each(['controller', 'grill'])('%s says in its header to compare it with the owner\'s original before the pilot', (name) => {
    const header = /<!--([\s\S]*?)-->/.exec(skill(name))![1]!;
    expect(header).toMatch(/Compare it with the\s+(?:owner's\s+)?original[\s\S]*before the pilot/);
  });
});
