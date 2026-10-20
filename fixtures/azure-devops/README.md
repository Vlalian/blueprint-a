# Azure DevOps replies

The replies `adapters/host/azure-devops.test.ts` plays back, one file per reply, for one commit
(`4c1e2f0a…`) on a ticket branch of a sample organisation (`fabrikam`, the name Microsoft's own
examples use) and project (`Fabrikam-Fiber`).

They were **not captured from a live organisation**: no real Azure DevOps API was called. Each is
written in the shape of Microsoft's REST API reference for api-version 7.1, field for field, from the
OpenAPI specifications and http examples Microsoft publishes for that reference
(<https://github.com/MicrosoftDocs/vsts-rest-api-specs>, `specification/{build,git,policy,wit}/7.1`).
The first live check of the adapter, and of these shapes, happens at work.

| File | The reply to | Shows |
|---|---|---|
| `builds-pending.json` | Builds - List | the commit's `ci` run still in progress; a run of another commit succeeded |
| `builds-failed.json` | Builds - List | the same run completed and failed |
| `builds-succeeded.json` | Builds - List | `ci` run again and succeeded, the failed run still listed; `e2e` succeeded |
| `builds-other-commit.json` | Builds - List | runs of another commit only: nothing reported on this one |
| `pr-list-none.json`, `pr-list-open.json` | Pull Requests - Get Pull Requests | no active PR for the branch; one active PR someone marked ready |
| `pr-created.json` | Pull Requests - Create | the draft PR just opened |
| `pr-active.json`, `pr-completed.json`, `pr-abandoned.json` | Pull Requests - Get Pull Request | open (a draft), merged, closed |
| `policy-evaluations-running.json` | Evaluations - List | the required Build policy still running, required reviewers approved, an optional policy rejected |
| `workitem.json`, `workitem-resolved.json` | Work Items - Get Work Item, Work Items - Update | a user story, then moved to Resolved |
| `workitem-bad-state.json` | Work Items - Update, answered 400 | a state the process does not allow |
| `unauthorized.html` | any call with a bad token | the sign-in page Azure DevOps is known to answer with instead of JSON (unverified) |
