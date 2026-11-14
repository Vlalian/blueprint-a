// Ticket 97: /dispatch is a router skill over the role skills, with a task finder, a Choose step,
// a queue of 2 to 3 parallel tickets, no worker hooks, and the reviewer beside the solution skeptic.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const flat = (path: string) => read(path).replace(/\s+/g, ' ');
const router = flat('skills/dispatch/SKILL.md');
const queue = flat('skills/dispatch/queue.md');
const roles = flat('skills/dispatch/roles.md');
const merge = flat('skills/dispatch/merge-into-dev.md');

describe('the dispatch router', () => {
  it('names every role skill it routes to, and each exists', () => {
    const named = [...router.matchAll(/`(skills\/[a-z-]+\/SKILL\.md)`/g)].map((m) => m[1]!);
    expect(new Set(named)).toEqual(new Set(['task-finder', 'controller', 'researcher', 'specifier', 'coder', 'cleaner', 'hardener', 'review', 'skeptic', 'walker', 'scout', 'briefing'].map((s) => `skills/${s}/SKILL.md`)));
    expect(named.filter((p) => !existsSync(join(ROOT, p)))).toEqual([]);
  });

  it('links only files that exist', () => {
    const links = [...['SKILL.md', 'queue.md', 'roles.md', 'merge-into-dev.md'].map((f) => read(`skills/dispatch/${f}`)).join('\n').matchAll(/\]\(([a-z-]+\.md)\)/g)].map((m) => m[1]!);
    expect(links.filter((l) => !existsSync(join(ROOT, 'skills', 'dispatch', l)))).toEqual([]);
  });

  it('runs each role as a fresh general-purpose subagent, with no worker agent file and no role hook', () => {
    expect(router).toContain('Each role runs as a fresh `general-purpose` subagent told to read and follow its skill');
    expect(['skills/dispatch/worker.md', 'skills/dispatch/role-brief.md', 'adapters/claude-code/dispatch-role.ts', 'adapters/claude-code/dispatch-role-core.ts'].filter((p) => existsSync(join(ROOT, p)))).toEqual([]);
  });

  it('shows every found task with 2 to 4 recommended and waits for the owner before planning', () => {
    expect(router).toContain('Show the owner every task it returns, ranked by value, with your 2 to 4 recommended picks marked');
    expect(router).toContain('Then wait for his choice: no planning, claiming or building happens before it.');
  });

  it('runs at most 3 tickets at once and claims the first queued ticket whose dependencies are done before any work', () => {
    expect(router).toContain('Run up to 3 tickets at once.');
    expect(queue).toContain('A **slot** is free while fewer than 3 tickets are `claimed` or later');
    expect(queue).toContain("the next ticket is the first `queued` line, in queue order, whose `Depends on:` tickets are all `done` and that nobody has claimed. Before any work on it:");
    expect(queue).toContain('Write `claimed` on its queue line');
  });

  it("runs a returned role's gates from project.json, sends the first red back and puts the second in Needs you", () => {
    expect(roles).toContain("When a role returns, run its gates yourself: every command under `roles.<role>.checks` in the project's `project.json`");
    expect(roles).toContain("**First red:** send the same role, fresh, the red gate's name and output, plus its own closing summary");
    expect(roles).toContain('**Second red** of that role on this ticket: stop the ticket, add it to **Needs you**');
  });

  it('starts the reviewer and the solution skeptic side by side from the other family, and routes their verdicts', () => {
    expect(roles).toContain('When the consolidated check is green, start two judges side by side, both from the family that did not build the ticket');
    expect(roles).toContain('"does not solve the ticket": start a fix round.');
    expect(roles).toContain('"a better design exists": add it to **Needs you**');
    expect(roles).toContain('At most 2 fix rounds');
  });

  it('merges a green PR on its own only into dev, never into main or another integration branch (review round 1)', () => {
    expect(merge).toContain('When the integration branch is `dev` and the gates, the judges, the walk and CI are green on that same head with no stale evidence, merge the PR into `dev`');
    expect(merge).toContain("Every other integration branch needs the owner's yes for each merge");
    expect(router).toContain('you never push it and never merge into it.');
    expect(merge).not.toMatch(/--base main|merge into `main`/);
  });

  it('checks the walk with the walk gate: verdict, head and every criterion (review round 1)', () => {
    expect(roles).toContain('`node "<Workflow root>/gates/walk/cli.ts" --report <report> --head <sha> --patch-id <id> --repo <worktree>`');
    expect(roles).toContain('with one `--criterion <id>` per acceptance criterion');
    expect(roles).not.toContain('gates/evidence/cli.ts');
  });

  it("runs every role's gates once on the final head, and again on every later head change (review rounds 1 and 2)", () => {
    expect(roles).toContain("When the hardener's gates are green, run the **consolidated check** on that head: every role's gates from `project.json`, each command once.");
    expect(roles).toContain('Whenever the head changes after that (a fix round, a merge of the integration branch into it), record the new head, mark all earlier evidence **stale**, and run the consolidated check again, then both judges and the walk.');
    expect(roles).toContain('Stale evidence never counts as green.');
    expect(merge).toContain('A branch a role is writing to gets a **pending update** line in **Ticket progress**');
  });

  it('briefs the solution skeptic without the diff, so it designs blind (review round 1)', () => {
    expect(roles).toContain('the solution skeptic does not, because it writes its own design before it reads the diff itself.');
    expect(roles).not.toContain('Each gets the ticket, the plan, the diff against the base and the worktree.');
  });

  it('writes its new prose without em-dashes', () => {
    const files = ['skills/dispatch/SKILL.md', 'skills/dispatch/queue.md', 'skills/dispatch/roles.md', 'skills/dispatch/merge-into-dev.md', 'skills/task-finder/SKILL.md', 'skills/skeptic/SKILL.md'];
    expect(files.filter((f) => read(f).includes('â€”'))).toEqual([]);
  });

  it('keeps skill-creator evals for each skill it writes', () => {
    for (const skill of ['dispatch', 'task-finder', 'skeptic']) {
      const evals = join(ROOT, 'skills', skill, 'evals');
      const cases = readdirSync(evals, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
      expect(cases.length, skill).toBeGreaterThanOrEqual(2);
      for (const c of cases) {
        expect(['prompt.md', 'case.yaml'].filter((f) => !existsSync(join(evals, c, f))), `${skill}/${c}`).toEqual([]);
        expect(readdirSync(join(evals, c, 'graders')).length, `${skill}/${c}`).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe('the task finder and the solution skeptic', () => {
  it('the task finder collects existing work, applies the run-afk filter and does not analyse code', () => {
    const text = flat('skills/task-finder/SKILL.md');
    expect(text).toContain('You do not analyse the code for new work; finding new work is the scout\'s job.');
    expect(text).toContain('AFK-SAFETY.md');
    expect(text).toContain('Mark the top 2 to 4 as recommended.');
  });

  it('the skeptic designs its own solution before it reads the diff', () => {
    const text = flat('skills/skeptic/SKILL.md');
    expect(text.indexOf('## 1. Design blind')).toBeLessThan(text.indexOf('## 2. Compare'));
    expect(text).toContain('Before you open the diff, write your own solution from the ticket and the codebase');
    expect(text).not.toContain('refuted');
  });
});

describe('the hardener stage of a pilot project', () => {
  const app = JSON.parse(read('projects/a pilot project/project.json'));

  it('runs the security gates on the finished build: SAST, secret scan, hidden Unicode and supply chain', () => {
    const checks: Record<string, string> = app.roles.hardener.checks;
    expect(checks).toMatchObject({
      sast: 'node "{WORKFLOW}/gates/sast/cli.ts" --base {BASE}',
      'secret-scan': 'node "{WORKFLOW}/gates/secret-scan/cli.ts" --base {BASE}',
      'hidden-unicode': 'node "{WORKFLOW}/gates/hidden-unicode/cli.ts" --base {BASE}',
      'supply-chain': 'node "{WORKFLOW}/gates/supply-chain/cli.ts" --base {BASE}',
    });
    const scripts = Object.values(checks).map((c) => /"\{WORKFLOW\}\/([^"]+\.ts)"/.exec(c)?.[1]).filter((p): p is string => p !== undefined);
    expect(scripts.filter((p) => !existsSync(join(ROOT, p)))).toEqual([]);
  });

  it('keeps every gate the hardener already had', () => {
    expect(app.roles.hardener.checks).toMatchObject({ lint: 'npm run lint', typecheck: 'npx tsc --noEmit', onkel: 'node "{WORKFLOW}/gates/hardener/cli.ts" --base origin/dev' });
  });

  it.each(['coder', 'cleaner', 'hardener'])('gives the %s the four checks with skipped tests red, the build, test deletion and debug leftovers (review round 1)', (role) => {
    const checks: Record<string, string> = app.roles[role].checks;
    expect(checks.test).toBe('node "{WORKFLOW}/gates/four-checks/skips-cli.ts" --base {BASE} --report .vitest-report.json --test "node {CWD}/node_modules/vitest/vitest.mjs run --reporter=default --reporter=json --outputFile.json=.vitest-report.json"');
    expect(checks).toMatchObject({ lint: 'npm run lint', typecheck: 'npx tsc --noEmit', build: 'npm run build', 'debug-leftovers': 'node "{WORKFLOW}/gates/debug-leftovers/cli.ts" --base {BASE} --config "{WORKFLOW}/projects/a pilot project/project.json"' });
    expect(checks).toHaveProperty('test-deletion');
  });
});
