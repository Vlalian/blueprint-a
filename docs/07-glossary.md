# Glossary

**Added lines**: the lines a change adds, read from a zero-context diff. Several gates judge only
these, so old code does not block new work.

**Authority tier**: one of four levels (analyze, draft, auto-run, never) that says what an action
may do without the human. Kept in one config file; tier 4 is enforced by a hook.

**Batch review**: one review of all of a run's tickets for a project, by several read-only
reviewers in parallel, followed by a skeptic.

**Briefing**: the human's regular report: what needs them, what waits for approval, what ran and
why, trends, new concepts explained once, and patterns in their own choices.

**Controller**: the per-project orchestrating agent. Drafts plans, writes briefs, routes handoffs,
escalates. Never writes code.

**CRAP score**: Change Risk Anti-Patterns, `complexity² × (1 − coverage)³ + complexity` per
function. High when code is complex and poorly tested. The bar here is ≤ 6 on touched functions.

**Directives**: a per-project file of the human's standing instructions, read by every
controller. Tier 4: agents cannot edit it.

**Dispatcher**: a plain script (no model) that starts and supervises a run: preflight, slots,
caps, retries, queue, briefing.

**EARS**: Easy Approach to Requirements Syntax: criteria in fixed forms such as "When X, the
system shall Y". Lintable.

**Escalation**: a script-written record that hands a ticket back to the human with a reason.

**Exit codes 0 / 1 / 2**: pass / fail / could not run. Exit 2 never counts as a pass.

**Fail closed**: when a check cannot run or its input cannot be read, the result is failure, not
pass.

**Four checks**: the project's lint, typecheck, test and build commands.

**Gate**: a program that needs no judgement and gives the same result for the same input; prints
JSON and exits 0, 1 or 2.

**Handoff**: what one role passes to the next: a validated file naming a commit (or a one-line
note). Agents write a draft; the handoff gate writes the real file.

**Hyper Intelligence**: the principle that human and AI produce together what neither could
alone, with learning in both directions.

**Lesson**: a proposed change to the workflow derived from observations, with a suggested
destination (directive, workflow rule, or gate). Applies only after the human accepts it.

**Mutation testing**: making small deliberate changes ("mutants") to code and checking that some
test fails for each. A surviving mutant shows a weak test. **Equivalent mutant**: one that
cannot change behaviour, so no test can kill it; suppress only with a written reason.

**Pre-tool event / stop event / post-tool event**: generic harness hook points: before a tool
call runs, when an agent declares itself finished, and after a tool call ran.

**Pre-commit backstop**: a version-control hook that runs gate programs on every commit,
whatever harness made the change.

**Property test**: a test that checks a rule over many generated inputs. Kept out of coverage,
mutation and CRAP runs so it cannot mask weak example tests.

**Prove it bites**: the standard gate test: clean → pass, inject a violation → fail, revert →
pass.

**Red check**: the gate that runs new tests against the code before the change and requires them
to fail there.

**Role agent**: a short-lived agent with one job (specifier, coder, cleaner, hardener, reviewer,
skeptic) and one set of gates.

**Run**: one start of the dispatcher, until the queue is empty, the budget is spent, or a usage
limit stops it.

**Skeptic**: a read-only agent that tries to refute one high-severity review finding with
evidence. Unrefuted findings block.

**Stop gate**: the gate on the stop event that refuses "done" while the role's checks are red;
two blocks, then escalation.

**Verdict ledger**: a record of verdicts keyed by exact commit hash; a new commit starts
unverified.

**Worktree**: a separate working copy of a repository on its own branch, so parallel work does
not collide.
