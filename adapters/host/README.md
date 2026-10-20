# Host adapters

The CI and pull-request gates read one interface (`host.ts`), so the same gates run where the
code, the pipelines and the boards live:

| Call | Gives | GitHub (`github.ts`, the `gh` CLI) | Azure DevOps (`azure-devops.ts`, REST) |
|---|---|---|---|
| `checksForCommit(sha)` | CI on that exact commit: green, failing or pending, with the names | check runs and commit statuses of the commit | the newest pipeline run of each pipeline on the commit |
| `openDraftPr(branch, base, title, body)` | the draft PR, or the open one for the branch reused | `gh pr list`, then `gh pr create --draft` | list active PRs for the branch, then create with `isDraft: true` |
| `prStatus(id)` | open, closed or merged; draft; head commit; blocking policies | `gh pr view` (required checks are checks on the head commit) | the PR, then its policy evaluations |
| `workItem(id)` | title, state, type | a GitHub issue | an Azure Boards work item |
| `setWorkItemState(id, state)` | the item after the change | `gh issue close` or `reopen` | a JSON patch of `System.State` |

`verdictOf` maps CI on a commit to the ledger's words the same way on both hosts: green is
`VERIFIED`, failing `FAILED`, pending or nothing reported `NOT-VERIFIED`. The CI gate
(`gates/ci-on-sha/gate.ts`) reads only `checksForCommit`.

`config.ts` reads which host a project uses from its settings:

```json
{ "pr": { "remote": "origin", "base": "dev", "host": "azure-devops", "organization": "fabrikam", "project": "Fabrikam-Fiber", "repository": "fabrikam-web" } }
```

`host` is `github` when left out. The Azure DevOps adapter reads its personal access token from
the `AZURE_DEVOPS_PAT` environment variable only: never from a file, never from settings. Without
it every call fails as "could not run" (exit 2) naming the variable. The token is sent only in
the `Authorization` header and is cut out of every error message before it is thrown.

HTTP runs through an injected client (`http.ts`). The real one runs `fetch-once.ts` in a child
Node process with the request on stdin, so the synchronous gates can wait for it and the token
never appears on a command line. The tests play back replies in `fixtures/azure-devops/`; they
never call Azure DevOps or GitHub.

## The Azure DevOps calls (spike, ticket 54)

All calls are `https://dev.azure.com/{organization}/{project}/_apis/...` with
`api-version=7.1` unless noted, authenticated with basic auth: an empty user name and the token as
the password ("Personal access token. Use any value for the user name and the token as the
password", the specs' `accessToken` security definition).

Sources: Microsoft's REST API reference, <https://learn.microsoft.com/rest/api/azure/devops/>,
read through the OpenAPI specifications and http examples it is generated from,
<https://github.com/MicrosoftDocs/vsts-rest-api-specs> (`specification/<area>/7.1/<area>.json`
and `httpExamples/`). The reference pages themselves:

| Call | Request | Page | Scope |
|---|---|---|---|
| Pipeline runs for a commit | `GET build/builds?queryOrder=queueTimeDescending&$top=200` | [Builds - List](https://learn.microsoft.com/rest/api/azure/devops/build/builds/list?view=azure-devops-rest-7.1) | `vso.build` |
| Active PR for a branch | `GET git/repositories/{repository}/pullrequests?searchCriteria.sourceRefName=refs/heads/{branch}&searchCriteria.targetRefName=refs/heads/{base}&searchCriteria.status=active&$top=1` | [Pull Requests - Get Pull Requests](https://learn.microsoft.com/rest/api/azure/devops/git/pull-requests/get-pull-requests?view=azure-devops-rest-7.1) | `vso.code` |
| Draft PR | `POST git/repositories/{repository}/pullrequests` with `{sourceRefName, targetRefName, title, description, isDraft: true}` | [Pull Requests - Create](https://learn.microsoft.com/rest/api/azure/devops/git/pull-requests/create?view=azure-devops-rest-7.1) | `vso.code_write` |
| PR status | `GET git/repositories/{repository}/pullrequests/{id}` | [Pull Requests - Get Pull Request](https://learn.microsoft.com/rest/api/azure/devops/git/pull-requests/get-pull-request?view=azure-devops-rest-7.1) | `vso.code` |
| PR policies | `GET policy/evaluations?artifactId=vstfs:///CodeReview/CodeReviewId/{projectId}/{id}&api-version=7.1-preview.1` | [Evaluations - List](https://learn.microsoft.com/rest/api/azure/devops/policy/evaluations/list?view=azure-devops-rest-7.1) | `vso.code` |
| Work item | `GET wit/workitems/{id}?fields=System.Title,System.State,System.WorkItemType` | [Work Items - Get Work Item](https://learn.microsoft.com/rest/api/azure/devops/wit/work-items/get-work-item?view=azure-devops-rest-7.1) | `vso.work` |
| Work item state | `PATCH wit/workitems/{id}`, `Content-Type: application/json-patch+json`, `[{op: add, path: /fields/System.State, value}]` | [Work Items - Update](https://learn.microsoft.com/rest/api/azure/devops/wit/work-items/update?view=azure-devops-rest-7.1) | `vso.work_write` |

What the specs say, and how the adapter reads it:

- **Builds - List has no filter by commit.** Its filters are definitions, queues, build number,
  times, requester, reason, status, result, tags, branch, build ids and repository. The adapter
  lists the project's newest 200 builds and keeps those whose `sourceVersion` is the commit, the
  newest run of each pipeline (`definition.name`) only, as GitHub keeps the newest check run of
  each name. `status` other than `completed` is pending; `completed` with `result: succeeded` is
  passed; any other result (`partiallySucceeded`, `failed`, `canceled`, `none`) is failing.
- **A PR is created as a draft** by `isDraft` on `GitPullRequest`. The adapter sends no
  `autoCompleteSetBy` and no `completionOptions`, so the PR never completes itself, and it never
  updates a PR after creating it.
- **PR status** `active`, `abandoned`, `completed` is read as `OPEN`, `CLOSED`, `MERGED`; any
  other status fails the call. The head commit is `lastMergeSourceCommit.commitId`.
- **Policy evaluations** are only published as `7.1-preview.1`. The artifact id template
  `vstfs:///CodeReview/CodeReviewId/{projectId}/{pullRequestId}` is from that page; the project id
  comes from the PR's `repository.project.id`. Enabled, blocking policies count: `approved` passed,
  `queued` and `running` pending, `rejected` and `broken` failing; `notApplicable` is left out.

**Unverified** (no Azure DevOps organisation was reachable from where this was built; the first
live check happens at work):

1. That `isDraft: true` on create is honoured by the server (the field is on the model; the
   create example does not show it).
2. That 200 newest builds is enough: in a busy project a commit's runs can be older. The
   `repositoryId`/`repositoryType` and `branchName` filters could narrow the list, and
   `continuationToken` page through it; neither is used yet.
3. Where pipelines report when the code stays on GitHub: the Azure Pipelines GitHub app is
   expected to post check runs on the commit, in which case the GitHub adapter already reads
   them and `host: github` is the right setting for CI. Which of the two applies is a question
   for work (`docs/06-open-questions.md`, section 7).
4. That a missing or expired token is answered with a sign-in page (status 203, HTML) rather than
   401. The adapter treats any reply that is not JSON as a failure either way.
5. That the human-facing PR address is `https://dev.azure.com/{organization}/{project}/_git/{repository}/pullrequest/{id}`
   (the API's own `url` field is documented as "used internally").
6. That Node's `fetch` reaches Azure DevOps through the company's proxy. Node's fetch ignores
   `HTTPS_PROXY` unless told to use it (`NODE_USE_ENV_PROXY=1` on Node 24).
7. That the token's scopes in the table are all it needs (they are the specs' OAuth scopes per
   call). Whether work allows personal access tokens at all, or wants Microsoft Entra tokens
   instead (sent as a Bearer header, which this adapter does not do), is a question for work.
