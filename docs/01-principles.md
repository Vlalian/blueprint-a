# Principles

Five ideas carry the whole design. If a later choice conflicts with one of them, the principle
wins and the choice is revisited.

## 1. Deterministic gates are the controller

A **gate** is a program that needs no judgement and gives the same result for the same input.
It reads files, a diff or a tool's output, and answers pass or fail with an exit code.

An analysis of five public agent workflows found that almost every "quality gate" in them was
run by the model *because the prose told it to*. A model under pressure skips prose. Only three
kinds of check actually controlled anything:

1. **Hooks** that refuse a tool call before it happens (the harness runs them, not the model).
2. **Scripts that return a verdict as an exit code**, which the flow obeys.
3. **CI** on the exact commit being shipped.

So every rule this workflow keeps is turned into one of those three. LLM review is still used,
but it only **adds findings**; it never passes work on its own. A model may decide *how* to
satisfy a gate, never *whether* the gate has passed.

Consequences:
- Gates live as **portable command-line programs** with a fixed contract (JSON on stdout, exit
  0/1/2). Harness integration is a thin adapter that calls them.
- The language model drives the phases (it is the orchestrator), but the **key gates fire on
  harness events whether or not it remembers** to run them.
- "Done" is a gate result, never a model's claim.

## 2. Authority tiers

Every action the workflow can take sits in exactly one of four tiers, kept in one config file
that the hooks read.

| Tier | Meaning | Examples |
|---|---|---|
| 1 Analyze | Runs freely; changes nothing the human owns | Gates, watchers, logs, digests, the briefing |
| 2 Draft | Agents produce it; it waits for the human | Plans, lessons, upstream proposals, draft pull requests |
| 3 Auto-run | Runs on its own; the human can override | Building inside an approved plan; review fix rounds |
| 4 Never | Refused by a hook (exit 2) | Editing the human's decision records, context file, standing directives or the tiers file itself; merging; pushing to the main branch; marking a ticket done |

Tier 4 is enforced mechanically, not by instruction. When an accepted lesson must change a
tier-4 file, it goes through one dedicated script that records which approval allowed it, so
every write to a human-owned file traces back to a decision the human made.

## 3. Fail closed

A gate that cannot run **never passes**. Crashes, missing input, malformed JSON, an unknown
option, a timed-out tool, hook input too large to inspect: all of these become a failure (exit
2, "could not run"), never a silent pass.

The same holds for judgement steps wrapped in code: a reviewer that crashes or returns output
that does not match the schema counts as **blocking**. A skeptic whose answer cannot be read
counts as **not refuted**. An empty folder handed to a scanner is an error, because it may mean
a wrong path.

A detail that matters on some platforms: a program that forces an immediate exit right after
writing to a pipe can crash before its output is flushed, and a hook may read that crash as
"allow". Set the exit code and let the program end normally.

## 4. Prove it bites

A gate that has never been seen to fail proves nothing. Every gate gets a **prove-it-bites**
test with three runs on a real (throwaway) project:

1. Clean: the gate passes (exit 0).
2. Inject one known violation: the gate fails (exit 1).
3. Revert the violation: the gate passes again (exit 0).

Expected result: `{clean: 0, injected: 1, reverted: 0}`. Each gate contract in
[03-gates.md](03-gates.md) names the violation to inject. The gates are also held to their own
standard: the gate code itself must pass the test-strength gate (every mutant killed).

## 5. Hyper Intelligence: human and AI learn from each other

The human and the agents should produce work that neither could produce alone.

- **The agents keep continuity.** They read everything, run every gate, and keep tickets moving
  while the human is away.
- **The human makes the calls.** They add what the code and data cannot show: product judgement,
  priorities, context. They approve plans, lessons and proposals, and they merge.
- **The loop runs both ways.**
  - *AI learns from the human:* the workflow records the human's choices (plan approvals and
    edits, accept/reject on proposals, review comments, merges and reverts, overrides,
    corrections) and run outcomes (gate failures, escalations, retries). Once per run it turns
    them into **lessons**, each with a suggested destination: a project directive, a workflow
    rule for all projects, or a new code gate when the lesson is mechanical enough.
  - *Human learns from the AI:* a regular **briefing** gives the reason and evidence for every
    decision the agents made on their own, trends over time (which gates fire most, escalations,
    how often plans needed changes, test-strength per project, cost), a short plain explanation
    the first time a new concept appears, and the patterns the AI sees in the human's own choices.
- **Nothing learned applies itself.** Every lesson is presented first; only lessons the human
  accepts are integrated.

How much of the learning loop is worth building on a local model is an open question
(to confirm after the pilot).
