# Open questions for the work-PC LLM

Work through these with your local LLM. Nothing below assumes how your harness works; where a
mapping is suggested, it is a **hypothesis to verify** against your harness's own documentation
and a small experiment, not a fact.

## 1. Mapping onto the harness (agents, commands, plugins)

A first guess at how the pieces could map onto an opencode-style harness. Confirm each row.

| Workflow piece | Possible mapping | Questions to settle |
|---|---|---|
| Role agents (specifier, coder, cleaner, hardener, reviewers, skeptic) | One **agent** definition each: own prompt, own tool permissions (reviewers and skeptic read-only), possibly own model | Can an agent's tools be restricted per role (no shell for reviewers, no writes outside an area)? Can different agents use different models? |
| Controller | A primary **agent** that spawns role agents as sub-agents | Can an agent spawn sub-agents with a fresh context and wait for their result? If not, should the dispatcher script start each role as a separate session instead? |
| Dispatcher | A plain script outside the harness that starts headless sessions | Does the harness have a non-interactive mode (prompt in, result out, exit code)? How are permissions granted in that mode? |
| Human-run steps (approve plan, start review, merge) | **Commands** | Can a command be marked so the model cannot invoke it on its own (human-only)? If not, how do we enforce that (tier 4 hook)? |
| Pre-tool gates (A1 to A6) | A **plugin** hooked on the event before a tool executes, which refuses by throwing or returning an error | Does throwing actually block the call, or only log? (One public plugin port examined for the reference build only logged, so it could not be used to block.) What payload does the hook see: the full shell command, the file path, the new content? Is there a size limit? |
| Post-tool log and formatter | A plugin on the event after a tool executes | Can it run asynchronously without slowing each call? |
| Stop gate (B) | A plugin on the session-idle or end-of-turn event | Can it **refuse** the stop and feed a message back so the agent continues? If it can only observe, the fallback is: the dispatcher runs the gates after the session ends and starts a fix session with the failures (one round trip per red result). |
| Gates (C, D, E, F) | Plain command-line programs, called by hooks, scripts, pre-commit and CI | Which language and runtime are available on the work PC? Are the mutation-testing, clone-detection and dependency-graph tools allowed there? |
| Pre-commit backstop | A version-control pre-commit hook | Is this allowed on the work PC's repositories? |
| Briefing | A generated page or document | Where does the human read it, and how are accept/reject decisions recorded so the next run can read them back (a file the human edits, a small form)? |

## 2. Model capability

1. Which local model, what context size, what speed? Which roles can it handle reliably, and
   which (planning, review) might need a larger model, if one is available?
2. Is a **second model family** available for review? If not, does a second review pass with a
   different prompt and fresh context help enough to keep?
3. How short must role briefs be for the local model to follow them? Should the nine-field brief
   be cut down?
4. Does the local model produce valid JSON reliably for the review schema? If not, does a
   grammar or structured-output mode exist in the harness or model server?
5. At what context fill should a role hand off to a fresh agent (the reference default is about
   70%)? (to confirm after the pilot)

## 3. Gates

1. Which gates come first? Suggested order: four checks + stop gate, then secret scan and
   hidden Unicode in pre-commit, then pre-tool git and protected-file guards, then red check and
   test-deletion, then the test-strength gate, then the rest.
2. Is the test-strength bar (score ≤ 6 and every mutant killed on touched code) realistic for the
   work codebases and their test runners? Mutation testing is slow; the JS/TS mutation tool has an incremental mode,
   which the reference uses. In the pilot the bar held on real code; equivalent mutants cost one
   build an extra cleaner round (see [04-flow-control.md](04-flow-control.md)).
3. Which language ecosystems must the gates support? The contracts are language-neutral, but each
   gate needs a tool per ecosystem (clone detector, dependency graph, mutation tester).
4. The adapter-based test-strength gates print JSON like every other gate (v0.1). Is the
   change-scoped text report of `gates/onkel` still wanted next to them?
5. Is a version-control hosting CLI available for the CI-on-commit and pull-request gates, or does
   the work PC use a different code host with a different API? (See section 7.)

## 4. Flow and authority

1. Who plays the human role at work, and which actions belong in each authority tier there?
   Are there actions that must be tier 4 at work but were not in the reference (for example
   touching shared infrastructure or production data)?
2. Does unattended running fit the work rules at all? If not, which parts still help in an
   attended session (stop gate, pre-tool guards, plan gate)?
3. Should review run inside every run, or only when the human asks? (to confirm after the pilot)
4. Are the flow-control numbers in [04-flow-control.md](04-flow-control.md) right for the local
   model's speed? (to confirm after the pilot)
5. Is a run budget meaningful for a local model (no per-token cost), or should the limit be wall
   clock and machine load instead?

## 5. Learning loop

1. Which observations can the harness give cheaply (every tool call, or only session outcomes)?
2. Is one analysis call per run affordable on the local model, and good enough to produce useful
   lessons?
3. How does the human accept or reject lessons at work, and where do accepted lessons go (project
   directives, workflow rules, new gates)?
4. Which of the human's choices may be recorded under the work PC's privacy rules?

## 6. Optional extras

1. Is there any production system an incident watcher should look at? If so, which signals are
   readable, and is any automatic write (like a rollback) acceptable at all?
2. Should an upstream watcher follow public workflow repositories from the work PC, or is that
   done elsewhere?

## 7. Adapters for work

The reference build talks to GitHub, deploys previews on Vercel and gives each run a Neon
database branch. Work uses code on GitHub, boards and pipelines in Azure DevOps, and Kubernetes.
Each row is a host adapter behind the same gate contracts. The host adapter for CI and pull
requests is code since v0.3 (`adapters/host`: GitHub through the `gh` CLI, Azure DevOps through its
REST API with a personal access token from the `AZURE_DEVOPS_PAT` environment variable; its
README lists the calls, their sources and what is unverified). Its first live check happens at
work. The environment adapter for previews and incidents is code since v0.4 (`adapters/environment`:
Kubernetes through `kubectl`, optionally Helm, with rollback off unless the project config turns it
on; [08-previews-kubernetes.md](08-previews-kubernetes.md) maps the rules). Its first live check
happens at work too. The SonarQube adapter is code since v0.5 (`adapters/sonarqube`, with
`gates/sonarqube/gate.ts`; see [09-sonarqube.md](09-sonarqube.md)); its edition and server questions
are in the SonarQube row. The rest are still to design.

| Piece | Reference build | At work | Questions to settle |
|---|---|---|---|
| CI on the exact commit (F1) | GitHub checks through the `gh` CLI | Azure Pipelines runs for a commit, while the code is on GitHub | Do Azure Pipelines report back to GitHub as checks on the commit? If they do, `host: github` reads them as is; if not, `host: azure-devops` reads the pipeline runs. Does the company allow personal access tokens, and who issues one with the build, code and work scopes? |
| Pull request state machine (F3) | GitHub pull requests through `gh` | GitHub pull requests; work items on Azure Boards | Does a pull request have to link an Azure Boards work item, and must a gate check that link? Who merges, and does a branch policy already require green pipelines? (The adapter reads a PR's blocking policies and reads and moves work items; which of that a gate should require is open.) |
| Work queue and tickets | Markdown tickets in the repository | Azure Boards work items | Should the controller read its queue from Azure Boards, or keep tickets in the repository and only link work items? Which states map to ready, running, done and failed? |
| Supply-chain scan (F4) | npm lockfile, GitHub | npm and NuGet, possibly an internal feed | Which lockfiles and feeds; is there a company allow list of licences already? |
| Previews and smoke test | Vercel preview deployments and a Neon database branch per run | Kubernetes | A namespace per branch, or a Helm release per branch in a shared namespace (`mode`)? Who may create a namespace, and does the pipeline annotate it with its branch so cleanup can prove it is the ticket's own? How long does a preview live, and what removes a forgotten one? What is the previews domain, and does it have a wildcard TLS certificate? Where does test data come from instead of a database branch? May an agent hold a kubeconfig at all, and scoped to what? |
| Incidents (optional) | Hosting and database status | Kubernetes events and the company's monitoring | Which metrics exist for HTTP errors (the app's own, the ingress controller's, a service mesh's, a managed Prometheus or an APM), and how are they labelled per release? Can Prometheus be reached through the API server's service proxy, or does it need its own client? Does production run in the same cluster, as Deployments or Helm releases? Is any automatic rollback acceptable at all (it stays off until the config turns it on), and who is told when one runs? |
| SonarQube (from v0.5) | the gate on recorded replies; no live SonarQube server | SonarQube judges new code and posts a quality gate on each pull request | Which edition and version does the work server run? Community Build has no branch or pull request analysis, so the gate could only judge the main branch after a merge. Can the pipeline hand the gate the scanner's `ceTaskId` (from `report-task.txt`) for each pull request commit, as the only exact link between a pull request analysis and its commit? Who issues a user token (`SONAR_TOKEN`) with Browse on the project, and may an agent's machine hold one? Is the `branch` parameter of `api/project_analyses/search` (internal in SonarQube's API) answered on the work server? Which quality gate is set on the projects, and is it the "Sonar way"? Are architecture rules (import boundaries) available in the edition, or only as a paid add-on? |
| Test-strength adapter | JS/TS: Stryker plus vitest, Jest or Karma; .NET: coverlet and Stryker.NET | Angular (JS/TS) and .NET | Does the Angular code use Jest or Karma, and does Karma emit istanbul json for the gate? For .NET: does every test project reference coverlet.collector, may Stryker.NET be a local tool, and does the complexity it counts from compiled branch points match what the team expects? The .NET adapter's last check happens on the real work code. |

## 8. Questions for the human, not the LLM

1. What does "done" look like for the first pilot ticket at work?
2. What must never leave the work PC (code, logs, observations), and does any piece of this
   design send data out?
