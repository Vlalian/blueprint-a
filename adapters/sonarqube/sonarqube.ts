// The SonarQube adapter (ticket 59): the four reads the sonarqube gate makes, through SonarQube's
// Web API (docs: https://docs.sonarsource.com/sonarqube-server/latest/extension-guide/web-api/; the
// spike, its sources and what is unverified are in README.md beside this file).
// - analysisFor(sha, ref): the analysis of that exact commit (api/project_analyses/search, whose
//   analyses carry the commit as "revision"), else whether one is still queued or running for the
//   ref (api/ce/component), failed, or only an older commit's exists. A stale analysis is never
//   the commit's.
// - qualityGate(target): the quality gate of one analysis (api/qualitygates/project_status).
// - newIssues(ref): the issues in the ref's new code (api/issues/search), every page.
// - newCodeMeasures(ref): coverage, duplication and issue counts on new code (api/measures/component).
// The token comes from the SONAR_TOKEN environment variable only, goes out only in the
// Authorization header, and is cut out of every error before it is thrown. Pull request and branch
// analysis need Developer Edition or above: Community has only the main branch.

import { redact, type HttpClient, type HttpReply, type HttpRequest } from '../host/http.ts';
import { TOKEN_VARIABLE, type SonarConfig, type SonarRef } from './config.ts';

export interface SonarIssue {
  key: string;
  rule: string;
  /** BUG, VULNERABILITY or CODE_SMELL; deprecated since 10.2 but still answered. */
  type?: string;
  /** BLOCKER to INFO; deprecated since 10.2 in favour of the impacts' severities. */
  severity?: string;
  /** The Clean Code taxonomy (10.2+): software quality and severity; empty on older servers. */
  impacts: Array<{ softwareQuality: string; severity: string }>;
  /** The path in the project, without the project key. */
  file: string;
  line?: number;
  message: string;
  status: string;
  resolution?: string;
  /** 10.4+: OPEN, CONFIRMED, ACCEPTED, FALSE_POSITIVE, FIXED. */
  issueStatus?: string;
}

export interface Condition {
  metric: string;
  status: string;
  comparator: string;
  threshold: string;
  actual: string;
}

export interface QualityGate {
  /** OK, ERROR or NONE (no quality gate). */
  status: string;
  conditions: Condition[];
}

/** Measures on new code by metric key, as numbers; a metric SonarQube did not answer is left out. */
export type Measures = Record<string, number>;

export type AnalysisLook =
  /** The analysis of the commit: found by its revision (a branch), or the scanner's task for it (a pull request). */
  | { state: 'done'; analysisId: string; date: string; boundBy: 'revision' | 'task' }
  | { state: 'running' }
  | { state: 'failed' }
  | { state: 'stale'; revision: string; date: string }
  | { state: 'none' }
  /** A pull request without the scanner's task id: SonarQube's public API does not name a pull request analysis's commit. */
  | { state: 'unbound' };

export interface SonarQubeAdapter {
  /** One look at the analysis of a full 40-character SHA on the ref. */
  analysisFor(sha: string, ref: SonarRef): AnalysisLook;
  qualityGate(target: SonarRef | { analysisId: string }): QualityGate;
  newIssues(ref: SonarRef): SonarIssue[];
  newCodeMeasures(ref: SonarRef): Measures;
}

export const NEW_CODE_METRICS = ['new_coverage', 'new_duplicated_lines_density', 'new_violations', 'new_bugs', 'new_vulnerabilities', 'new_code_smells', 'new_security_hotspots', 'new_lines'];
/** How many of the ref's newest analyses are searched for the commit. */
const ANALYSES_SEARCHED = '20';
/** The most api/issues/search answers in one page; it answers no more than 10,000 issues in all. */
const PAGE_SIZE = 500;
const MAX_PAGES = 20;
const ERROR_CHARS = 300;

type Query = Record<string, string>;
type Call = (path: string, query: Query) => unknown;

const snippet = (text: string) => (text.length > ERROR_CHARS ? `${text.slice(0, ERROR_CHARS)}…` : text);

/** The JSON of a 2xx reply, or why there is none. */
function answerOf(reply: HttpReply): { json: unknown } | { why: string } {
  if (reply.status < 200 || reply.status > 299) return { why: ` answered ${reply.status}: ${snippet(reply.body)}` };
  try {
    return { json: JSON.parse(reply.body) };
  } catch {
    return { why: ` answered ${reply.status} with no JSON: ${snippet(reply.body)}` };
  }
}

function send(http: HttpClient, request: HttpRequest): HttpReply | { why: string } {
  try {
    return http(request);
  } catch (e) {
    return { why: `: ${(e as Error).message}` };
  }
}

/**
 * GET calls with the token as the basic-auth login and an empty password, which every SonarQube
 * version accepts (Bearer is documented from 10.0); an error status, no JSON or no reply throws,
 * the token cut out.
 */
function caller(config: SonarConfig, http: HttpClient, token: string): Call {
  const basic = Buffer.from(`${token}:`).toString('base64');
  const headers = { Authorization: `Basic ${basic}`, Accept: 'application/json' };
  return (path, query) => {
    const sent = send(http, { method: 'GET', url: `${config.server}/${path}?${new URLSearchParams(query)}`, headers });
    const answer = 'why' in sent ? sent : answerOf(sent);
    if ('why' in answer) throw new Error(redact(`SonarQube GET ${path}${answer.why}`, [token, basic]));
    return answer.json;
  };
}

const refQuery = (ref: SonarRef): Query => ('pullRequest' in ref ? { pullRequest: ref.pullRequest } : { branch: ref.branch });

type Analysis = { key: string; date: string; revision?: string };
type Task = { id: string; status: string; componentKey: string; analysisId?: string; branch?: string; pullRequest?: string; executedAt?: string };

/** Queued or running for the branch (api/ce/component's queue), or the branch's last task failed. */
function queueState(call: Call, config: SonarConfig, ref: { branch: string }): 'running' | 'failed' | undefined {
  const ce = call('api/ce/component', { component: config.projectKey }) as { queue: Task[]; current?: Task };
  if (ce.queue.some((t) => t.branch === ref.branch)) return 'running';
  return ce.current?.branch === ref.branch && ce.current.status === 'FAILED' ? 'failed' : undefined;
}

/** A branch's analysis of the commit: the analyses name their commit as "revision". */
function branchAnalysis(call: Call, config: SonarConfig, sha: string, ref: { branch: string }): AnalysisLook {
  const { analyses } = call('api/project_analyses/search', { project: config.projectKey, branch: ref.branch, ps: ANALYSES_SEARCHED }) as { analyses: Analysis[] };
  const exact = analyses.find((a) => a.revision === sha);
  if (exact) return { state: 'done', analysisId: exact.key, date: exact.date, boundBy: 'revision' };
  const queued = queueState(call, config, ref);
  if (queued) return { state: queued };
  const newest = analyses[0];
  return newest ? { state: 'stale', revision: newest.revision ?? 'unknown', date: newest.date } : { state: 'none' };
}

/** PENDING and IN_PROGRESS still run; FAILED, CANCELED and anything unknown will not give an analysis. */
const RUNNING = new Set(['PENDING', 'IN_PROGRESS']);

/** Throws unless the task is the project's, for that pull request. */
function needTaskOf(task: Task, config: SonarConfig, ref: { pullRequest: string; task: string }): void {
  if (task.componentKey === config.projectKey && task.pullRequest === ref.pullRequest) return;
  throw new Error(`SonarQube task ${ref.task} is of ${task.componentKey} pull request ${task.pullRequest ?? '(none)'}, not ${config.projectKey} pull request ${ref.pullRequest}`);
}

const doneTask = (task: Task): AnalysisLook | undefined =>
  task.status === 'SUCCESS' && task.analysisId ? { state: 'done', analysisId: task.analysisId, date: task.executedAt ?? '', boundBy: 'task' } : undefined;

/** A pull request's analysis through the task the scanner submitted for the commit (its report-task.txt "ceTaskId"). */
function taskAnalysis(call: Call, config: SonarConfig, ref: { pullRequest: string; task: string }): AnalysisLook {
  const { task } = call('api/ce/task', { id: ref.task }) as { task: Task };
  needTaskOf(task, config, ref);
  return doneTask(task) ?? { state: RUNNING.has(task.status) ? 'running' : 'failed' };
}

function analysisFor(call: Call, config: SonarConfig, sha: string, ref: SonarRef): AnalysisLook {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`SonarQube is read for a full 40-character SHA, not ${JSON.stringify(sha)}`);
  if ('branch' in ref) return branchAnalysis(call, config, sha, ref);
  return ref.task === undefined ? { state: 'unbound' } : taskAnalysis(call, config, { pullRequest: ref.pullRequest, task: ref.task });
}

type RawCondition = { status: string; metricKey: string; comparator: string; errorThreshold?: string; actualValue?: string };

function qualityGate(call: Call, config: SonarConfig, target: SonarRef | { analysisId: string }): QualityGate {
  const query: Query = 'analysisId' in target ? { analysisId: target.analysisId } : { projectKey: config.projectKey, ...refQuery(target) };
  const { projectStatus } = call('api/qualitygates/project_status', query) as { projectStatus: { status: string; conditions?: RawCondition[] } };
  const conditions = (projectStatus.conditions ?? []).map((c) => ({ metric: c.metricKey, status: c.status, comparator: c.comparator, threshold: c.errorThreshold ?? '', actual: c.actualValue ?? '' }));
  return { status: projectStatus.status, conditions };
}

type RawIssue = Omit<SonarIssue, 'file' | 'impacts'> & { component: string; impacts?: SonarIssue['impacts'] };

/** A fixed issue is gone from the code: it is no finding. */
const live = (i: RawIssue) => i.status !== 'CLOSED' && i.resolution !== 'FIXED' && i.resolution !== 'REMOVED';

function issueOf(raw: RawIssue, projectKey: string): SonarIssue {
  const { component, impacts, key, rule, type, severity, line, message, status, resolution, issueStatus } = raw;
  const file = component.startsWith(`${projectKey}:`) ? component.slice(projectKey.length + 1) : component;
  return { key, rule, type, severity, impacts: impacts ?? [], file, line, message, status, resolution, issueStatus };
}

function newIssues(call: Call, config: SonarConfig, ref: SonarRef): SonarIssue[] {
  const raw: RawIssue[] = [];
  for (let p = 1; p <= MAX_PAGES; p++) {
    const page = call('api/issues/search', { components: config.projectKey, ...refQuery(ref), inNewCodePeriod: 'true', ps: String(PAGE_SIZE), p: String(p) }) as { issues: RawIssue[]; paging: { total: number } };
    raw.push(...page.issues);
    if (page.issues.length < PAGE_SIZE || raw.length >= page.paging.total) break;
  }
  return raw.filter(live).map((i) => issueOf(i, config.projectKey));
}

type RawMeasure = { metric: string; value?: string; period?: { value: string }; periods?: Array<{ value: string }> };

/** A new-code metric's value: in "period" (8.1+), else the first of "periods", else "value" (a pull request's). */
const valueOf = (m: RawMeasure) => m.period?.value ?? m.periods?.[0]?.value ?? m.value;

function newCodeMeasures(call: Call, config: SonarConfig, ref: SonarRef): Measures {
  const { component } = call('api/measures/component', { component: config.projectKey, ...refQuery(ref), metricKeys: NEW_CODE_METRICS.join(',') }) as { component: { measures: RawMeasure[] } };
  const pairs = component.measures.map((m) => [m.metric, Number(valueOf(m))] as const);
  return Object.fromEntries(pairs.filter(([, v]) => Number.isFinite(v)));
}

/** The adapter; throws naming the variable when the token is not set. */
export function sonarQubeAdapter(config: SonarConfig, http: HttpClient, env: Record<string, string | undefined>): SonarQubeAdapter {
  const token = env[TOKEN_VARIABLE];
  if (!token) throw new Error(`${TOKEN_VARIABLE} is not set: the SonarQube adapter reads its token from that environment variable only`);
  const call = caller(config, http, token);
  return {
    analysisFor: (sha, ref) => analysisFor(call, config, sha, ref),
    qualityGate: (target) => qualityGate(call, config, target),
    newIssues: (ref) => newIssues(call, config, ref),
    newCodeMeasures: (ref) => newCodeMeasures(call, config, ref),
  };
}

export interface WaitClock {
  now(): number;
  sleep(ms: number): void;
}

const WAIT_INTERVAL_MS = 10_000;
/** Looks that waiting does not change. */
const FINAL = new Set<AnalysisLook['state']>(['done', 'failed', 'unbound']);

/**
 * Looks until the analysis of the commit is done or failed, or `minutes` have passed: while it runs,
 * or only an older commit's (or none) is there yet, it may still come. The last look is the answer.
 */
export function awaitAnalysis(sonar: Pick<SonarQubeAdapter, 'analysisFor'>, sha: string, ref: SonarRef, minutes: number, clock: WaitClock): AnalysisLook {
  const deadline = clock.now() + minutes * 60_000;
  for (;;) {
    const look = sonar.analysisFor(sha, ref);
    if (FINAL.has(look.state) || clock.now() >= deadline) return look;
    clock.sleep(WAIT_INTERVAL_MS);
  }
}
