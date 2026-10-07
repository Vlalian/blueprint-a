# SonarQube adapter

The sonarqube gate (`gates/sonarqube/gate.ts`) reads SonarQube through four calls
(`sonarqube.ts`). Each one is one or more GETs on SonarQube's Web API:

| Call | Gives | Web API |
|---|---|---|
| `analysisFor(sha, ref)` | the analysis of that exact commit, or why there is none yet | branch: `api/project_analyses/search`, then `api/ce/component`; pull request: `api/ce/task` |
| `qualityGate(target)` | the quality gate's status (`OK`, `ERROR`, `NONE`) and its conditions | `api/qualitygates/project_status` |
| `newIssues(ref)` | the issues in the ref's new code, every page | `api/issues/search` |
| `newCodeMeasures(ref)` | coverage, duplication and issue counts on new code | `api/measures/component` |

`awaitAnalysis` looks again every 10 seconds, for up to the wait the project sets (10 minutes by
default). It keeps looking while the analysis is still running and while only an older commit's
analysis (or none) is there. A done, failed or unbound analysis ends the wait at once. The gate
maps what it finds onto the ci-on-sha verdicts:
- `VERIFIED`: the quality gate of the commit's own analysis is `OK`.
- `FAILED`: that quality gate is `ERROR`; the failing conditions are listed.
- `NOT-VERIFIED`: anything else. That covers an analysis still running, an analysis of an older
  commit only, a failed analysis, a pull request without the scanner's task, and `NONE` (no
  quality gate).

A stale analysis is never a pass.

`config.ts` reads where the server is from the project's settings:

```json
{ "sonarqube": { "server": "https://sonar.example.test", "projectKey": "fabrikam-web", "waitMinutes": 10 } }
```

The token is read from the `SONAR_TOKEN` environment variable only. That is the name SonarSource's
own scanners read; the token is never read from a file or from settings. Without it, the gate
exits 2 and names the variable. The token is sent only in the `Authorization` header and is cut
out of every error message before it is thrown.

HTTP runs through the injected client of `adapters/host/http.ts`, the same one the Azure DevOps
adapter uses. The tests play back replies in `fixtures/sonarqube/` and never call a SonarQube
server.

## The spike (ticket 59)

**Sources.** SonarSource's documentation for SonarQube Server,
<https://docs.sonarsource.com/sonarqube-server/latest/extension-guide/web-api/>. It could not be
fetched from where this was built, so what it says was read only from search-result extracts. For
that reason every call below was checked against SonarQube's own source, at commit
`166b83df0a2319209d22925261f5d1e005f583f4` (2026-10-05) of <https://github.com/SonarSource/sonarqube>.
The files used are each web service's definition with its changelog, the protobuf answer schemas,
and the `*-example.json` answers the Web API documentation is generated from. Paths below are
under `server/sonar-webserver-webapi/src/main/` unless they start with `sonar-ws/`.

| Call | Request | Source | Since |
|---|---|---|---|
| A branch's analyses with their commit | `GET api/project_analyses/search?project={key}&branch={branch}&ps=20` | `java/org/sonar/server/projectanalysis/ws/SearchAction.java`; `sonar-ws/src/main/protobuf/ws-projectanalyses.proto` (`Analysis.revision`) | 6.3; `branch` 6.6 |
| The project's Compute Engine queue and last task | `GET api/ce/component?component={key}` | `java/org/sonar/server/ce/ws/ComponentAction.java`, `resources/org/sonar/server/ce/ws/component-example.json` | 5.2; `component` required from 8.8 |
| One Compute Engine task | `GET api/ce/task?id={ceTaskId}` | `java/org/sonar/server/ce/ws/TaskAction.java`, `sonar-ws/src/main/protobuf/ws-ce.proto` (`Task`, `TaskStatus`) | 5.2 |
| One analysis's quality gate | `GET api/qualitygates/project_status?analysisId={id}` (or `projectKey` with `branch` or `pullRequest`) | `java/org/sonar/server/qualitygate/ws/ProjectStatusAction.java`, `resources/.../qualitygate/ws/project_status-example.json` | 5.3; `branch`, `pullRequest` 7.7 |
| New-code issues | `GET api/issues/search?components={key}&pullRequest={id}` (or `branch`) `&inNewCodePeriod=true&ps=500&p={n}` | `java/org/sonar/server/issue/ws/SearchAction.java`, `sonar-ws/src/main/protobuf/ws-issues.proto`, `ws-commons.proto` | `components` 10.2 (was `componentKeys`); `inNewCodePeriod` 9.4 |
| New-code measures | `GET api/measures/component?component={key}&pullRequest={id}` (or `branch`) `&metricKeys=new_coverage,...` | `java/org/sonar/server/measure/ws/ComponentAction.java`, `resources/.../measure/ws/component-example.json` | 5.4; `branch` 6.6, `pullRequest` 7.1 |

What the source says, and how the adapter reads it:

- **Only an analysis names its commit.** The `revision` field of `api/project_analyses/search`
  is the commit the scanner analysed. A Compute Engine task has no commit field. For a branch, the
  adapter looks for that commit's `revision` among the branch's 20 newest analyses. If it is not
  there, the adapter checks for a task queued or running for the branch (then the analysis is
  `running`) or a last task for the branch that failed (then `failed`). Otherwise only an older
  commit was analysed (`stale`, naming its revision), or nothing was (`none`).
- **A pull request's analyses cannot be found by commit.** `api/project_analyses/search` has no
  `pullRequest` parameter: the request object carries one, but the web service never reads it.
  The exact link between a pull request analysis and its commit is the Compute Engine task the
  scanner submitted for that commit. The scanner writes the task's id as `ceTaskId` in
  `.scannerwork/report-task.txt`, and the gate takes it as `--task`. The adapter reads that task
  and checks that it belongs to the project and to that pull request. Then:
  - `PENDING` or `IN_PROGRESS`: the analysis is running.
  - `SUCCESS` with an `analysisId`: the analysis is done.
  - `FAILED`, `CANCELED`, or anything else: the analysis failed.

  Without a task id, a pull request is `unbound` and NOT-VERIFIED.
- **The quality gate is read by the analysis id**, so a newer analysis landing in between cannot
  answer for the commit. `status` `OK` is VERIFIED and `ERROR` is FAILED. `NONE` (no quality
  gate) and `WARN` (in the schema; the `warning` field has been deprecated since 7.6) are
  NOT-VERIFIED. Each condition carries `metricKey`, `comparator`, `errorThreshold` and
  `actualValue`.
- **Issues** are read without `resolved`, so that issues people marked as false positives or as
  accepted still come back and count as false alarms. Fixed or removed ones (`status` `CLOSED`,
  `resolution` `FIXED` or `REMOVED`) are left out, because they are gone from the code. Reading
  continues page by page until the total is reached. Pages hold up to 500 issues
  (`SearchOptions.MAX_PAGE_SIZE`), and the search answers at most 10,000 issues in all. Security
  hotspots are not issues (since 8.2; `api/hotspots/search`) and are not read.
  - `type` (`BUG`, `VULNERABILITY`, `CODE_SMELL`) and `severity` were deprecated in 10.4 and
    un-deprecated in 10.8.
  - `impacts` (software quality and severity) has existed since 10.2, and `issueStatus` since 10.4.
  - The adapter reads all of them, so both older and newer servers classify.
- **New-code measures** come back as `period.value` (since 8.1). Before 10.0 they were the first
  entry of `periods`. A plain `value` is read too.
  - **There is no new-code cognitive complexity metric**: `CoreMetrics` has `cognitive_complexity`
    for the whole project only. On new code, cognitive complexity shows up as issues of rule
    `S3776` ("Refactor this function to reduce its Cognitive Complexity"), which the findings map
    to our complexity gate.
- **Authentication**: the token is the basic-auth login with an empty password. SonarQube's
  `UserTokenAuthentication` accepts that, and so does every version the docs show (`curl -u
  TOKEN:`). `Authorization: Bearer` is also accepted, and documented from 10.0.
  - Of the four token types, a user token can read everything above.
  - `api/issues/search` needs Browse permission, which project and global analysis tokens do not
    give.
- **The default "Sonar way" quality gate** (`server/sonar-server-common/.../SonarWayQualityGate.java`)
  fails new code on:
  - any new issue (`new_violations` > 0);
  - coverage under 80% (`new_coverage`);
  - duplication over 3% (`new_duplicated_lines_density`);
  - security hotspots reviewed under 100%.

  Coverage and duplication are ignored on fewer than 20 new lines (`ignoredConditions: true`).

**Editions.**
- Branch and pull request analysis start at Developer Edition. Community Edition, now Community
  Build, analyses the main branch only. The source agrees: the `branch` and `pullRequest`
  parameters say "Not available in the community edition".
- With Community, the gate can only check the main branch (`--branch main`) after a merge, never a
  pull request before it.
- Taint analysis (security rules that follow data across functions) starts at Developer Edition.
- Secrets detection is in every edition; Developer and above detect more kinds of secret.

**Unverified.** No SonarQube server was reachable from where this was built, and SonarSource's
documentation pages could only be read as search extracts. The first live check happens at work.

1. That the `branch` parameter of `api/project_analyses/search` works on the work server. It is
   marked internal, which means it is not part of SonarQube's public contract and may change
   without notice.
2. Since which version analyses carry `revision`. It is in the schema at master, but not in the
   changelog.
3. That the work pipeline keeps `report-task.txt`, or can hand its `ceTaskId` to the gate, for
   each pull request commit. Without it, a pull request is NOT-VERIFIED (see
   `docs/06-open-questions.md`, section 7).
4. The full list of `issueStatus` values. `ACCEPTED`, `FIXED` and the deprecated `CONFIRMED` are
   in the source; `OPEN` and `FALSE_POSITIVE` are taken from the docs' extracts.
5. That 401 and 403 are the status codes of "Authentication is required" and "Insufficient
   privileges". The replies in the fixtures follow SonarQube's `{"errors":[{"msg"}]}` shape.
6. Which version first accepted `Authorization: Bearer`. The adapter does not depend on it.
7. Whether a recent Community Build gained branch or pull request analysis. Nothing found says so.
8. That Node's `fetch` reaches the server through the company's proxy (as for Azure DevOps:
   `NODE_USE_ENV_PROXY=1` on Node 24).
