# Decisions, with reasons

Paraphrased from the reference build's decision records and plan. Each decision has the reason
it was made, so you can tell which ones still hold in your setting.

| # | Decision | Reason |
|---|---|---|
| 1 | Build an own workflow from the best mechanisms of five public flows, rather than adopt one | Every flow had one strong idea and many prose-only rules; none was a good baseline. All five were analysed through the same lens: gates, flow shape, roles, handoffs, recovery, memory, portability, cost |
| 2 | Two blueprints: one for the reference harness, one harness-neutral package (this) | The second machine runs a different harness and a local model; harness-specific code would not transfer, contracts do |
| 3 | Quality is decided by code gates; review only adds findings | A model following prose skips steps under pressure; a program with an exit code does not |
| 4 | A language model orchestrates; hooks enforce the key gates | A purely scripted state machine was considered and rejected as too rigid for planning and triage. Hooks make the gates fire whether or not the model remembers |
| 5 | A stop gate blocks finishing while checks are red, at most twice, then escalates | Feeding failures back fixes most problems; a cap stops endless loops and brings the human in |
| 6 | Dispatcher script → one controller per project → short-lived role agents; at most 2 controllers at once | The controller never writes code, so it stays a router. Short-lived roles keep context small. The cap protects a shared usage quota. A long-lived swarm (one process per role) was rejected on cost; its handoff protocol was kept |
| 7 | One role owns one set of gates; no role grades its own work | Separation means a role cannot quietly lower its own bar |
| 8 | A reviewer from a second model family joins the batch review | Different model families miss different things. An earlier decision against two-model review (on cost) was reversed; the review runs once per batch to contain cost, with a stand-in from the main family when the second is unavailable |
| 9 | Red check and test-deletion guard are new gates | None of the five flows checked red-before-green or prevented deleting tests; both are mechanical |
| 10 | Complexity-times-coverage ≤ 6 and every mutant killed, on touched code only | Strict where it matters, without blocking work on old debt. A global coverage threshold was rejected as weaker |
| 11 | Every gate has a prove-it-bites test | A gate never seen failing proves nothing |
| 12 | Handoffs pass only through a validating script; queue state is a file's location | Agents produce malformed messages; a validator with repair errors fixes that. Folder state is easy to inspect and hard to corrupt |
| 13 | Authority tiers in one config file; tier 4 enforced by hook | Instructions can be ignored; a hook cannot. One file makes the boundary reviewable |
| 14 | "Reads free, writes ask", with one written exception (an automatic production rollback on a code rule) | Agents may observe anything; changes to shared infrastructure need a human. The exception exists because a broken production deploy cannot wait for an evening review, and the trigger is a deterministic rule, not a model's opinion |
| 15 | Runs push feature branches and open draft pull requests only; the human merges | Merge is the human's final gate |
| 16 | Every lesson goes through the briefing first, with a suggested destination | The human stays in charge of how the workflow changes. Continuous learning was rejected once on token cost and later re-adopted as an idea, with the analysis batched once per run |
| 17 | Observe every tool call, cheaply | An asynchronous, append-only, silent hook makes observation nearly free; the model call happens once per run |
| 18 | A pre-commit hook runs the gate programs too | It is the backstop that works in any harness, including one without hook points |
| 19 | Watch public upstream workflows weekly; propose, never apply | Upstream ideas keep arriving; a script compare means no model call when nothing changed, and a licence check comes before borrowing |
| 20 | Order: understand the flows, then spec, then build gates first, then export this package | Everything else relies on the gates, so they are built and proven first |
| 21 | The reference build now builds tickets in cloud sessions and runs every gate locally before merging | Saves local resources and allows parallel builds; costs a round trip when a gate is red. (to confirm after the pilot) |

## Where the ideas come from

Credited by name; no text from these sources is included.

- **pstack** (a public agent plugin): a coordinator that never writes code; a verdict valid only
  for one exact commit (the ledger, with patch identity to decide re-verification); a nine-field
  brief for sub-agents; a retry table by failure type; a pull-request state machine with typed
  exit codes; a single-writer lock; a plan linter.
- **ECC** (a public agent plugin): small hooks that block a tool call so the model cannot skip
  them; a shell-parsing guard for dangerous version-control commands; config protection; fail
  closed on truncated input; external tool health checks; a review step whose output must match a
  JSON schema, with a skeptic for high findings; secret and hidden-Unicode scans; CI on the exact
  commit; a supply-chain scan; cost logging; hook hygiene findings from its community.
- **mattpocock/skills** (a public skill collection): the human-steered chain of grilling, spec,
  tickets, implementation and review; harness-locked human-only skills; "prove the rule bites";
  import-boundary rules; a pre-commit backstop; turning a repeated lesson into a gate.
- **swarm-forge and the Agentic Discipline material by Robert C. Martin ("Uncle Bob")**: one
  gate per role and roles that do not grade their own work; a validating handoff script with only
  two message types; queue state as file location; duplication, boundary, property-test and
  spec-mutation gates; the CRAP metric combined with mutation testing as the core quality bar.
  This material has no clear licence, so only its ideas are used, in our own words.
- **The owner's own earlier flow**: a cold-read plan file with real test code and expected
  failures, a ticket state machine, a two-axis review, and a gate script that decides pass or
  escalate while the agent obeys.
- **Spec-driven tools** (Spec Kit's cross-artifact analysis, Kiro's EARS criteria): the plan
  gate's cross-artifact and EARS checks.
