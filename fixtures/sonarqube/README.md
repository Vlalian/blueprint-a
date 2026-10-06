# SonarQube replies

These are the replies that `adapters/sonarqube/sonarqube.test.ts` and `gates/sonarqube/run.test.ts`
play back, one file per reply. They describe one sample project (`fabrikam-web`) on a sample server
(`sonar.example.test`). Two commits matter: the head commit `4c1e2f0a…` and the commit before it,
`9e8d7c6b…`. The sample pull request is number 42, and the sample branch is `dev`.

These replies were **not captured from a live server**: no SonarQube server was called. Each one
follows the shape of SonarQube's own example answers and protobuf schemas, field for field. Those
are the files its Web API documentation is generated from, at <https://github.com/SonarSource/sonarqube>
(`server/sonar-webserver-webapi/src/main/resources/org/sonar/server/*/ws/*-example.json` and
`sonar-ws/src/main/protobuf/`). The adapter's README lists the sources and what is unverified. The
first live check of these shapes happens at work.

| File | The reply to | Shows |
|---|---|---|
| `analyses-head.json` | `api/project_analyses/search` | the branch's three newest analyses; the newest is of the head commit |
| `analyses-older-commit.json` | `api/project_analyses/search` | only the earlier commits analysed |
| `analyses-none.json` | `api/project_analyses/search` | no analysis yet |
| `ce-component-idle.json` | `api/ce/component` | nothing queued; the branch's last task succeeded |
| `ce-component-running.json` | `api/ce/component` | a task for the branch in progress, and one for pull request 42 pending |
| `ce-component-failed.json` | `api/ce/component` | the branch's last task failed |
| `ce-task-success.json` | `api/ce/task` | pull request 42's task done, with its analysis id |
| `ce-task-in-progress.json` | `api/ce/task` | the same task still running |
| `ce-task-failed.json` | `api/ce/task` | the same task failed |
| `qualitygate-ok.json` | `api/qualitygates/project_status` | the "Sonar way" conditions, all passed |
| `qualitygate-error.json` | `api/qualitygates/project_status` | new issues, coverage and duplication failed |
| `qualitygate-none.json` | `api/qualitygates/project_status` | no quality gate on the project |
| `issues-new.json` | `api/issues/search` | new issues of each type, listed below |
| `issues-none.json` | `api/issues/search` | no new issues |
| `measures-new-code.json` | `api/measures/component` | coverage, duplication and issue counts on new code |
| `unauthorized.json`, `forbidden.json` | any call with a bad token, or one without the permission | SonarQube's error answer |

The new issues in `issues-new.json` are:
- a bug (null dereference, a reliability impact);
- a vulnerability (a leaked key found by a `secrets:` rule);
- a cognitive-complexity smell (`S3776`);
- a duplicated block (`common-ts:DuplicatedBlocks`);
- a plain smell;
- a bug resolved as a false positive;
- a fixed issue that is no longer in the code.

The token in the tests is made up, and no fixture contains one.
