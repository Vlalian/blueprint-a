// Where a project's SonarQube is (ticket 59): projects/<name>/project.json "sonarqube" names the
// "server" (its address) and the "projectKey". The token is never in that file: the adapter reads
// it from the SONAR_TOKEN environment variable only, the name SonarSource's own scanners read.

export const TOKEN_VARIABLE = 'SONAR_TOKEN';

export interface SonarConfig {
  /** The server's address, without a trailing slash. */
  server: string;
  projectKey: string;
}

/**
 * Which analysis of the project: a branch's, or a pull request's. A pull request's analysis is tied
 * to its commit only by the Compute Engine task the scanner submitted for that commit ("ceTaskId" in
 * the scanner's report-task.txt): SonarQube's public API names no commit for a pull request analysis.
 */
export type SonarRef = { pullRequest: string; task?: string } | { branch: string };

const named = (value: unknown) => typeof value === 'string' && value !== '';

function serverOf(server: unknown): string {
  if (!named(server)) throw new Error('"sonarqube" needs "server" (the SonarQube address)');
  if (!/^https?:\/\//.test(server as string)) throw new Error(`"sonarqube" needs "server" (an http or https address), not ${JSON.stringify(server)}`);
  return (server as string).replace(/\/+$/, '');
}

/** The project's SonarQube; throws naming what is missing. */
export function sonarConfigOf(block: unknown): SonarConfig {
  if (block === undefined) throw new Error('the project config has no "sonarqube" block: it needs "server" (the SonarQube address) and "projectKey"');
  const config = Object(block) as Record<string, unknown>;
  const server = serverOf(config.server);
  if (!named(config.projectKey)) throw new Error('"sonarqube" needs "projectKey" (the project key in SonarQube)');
  return { server, projectKey: config.projectKey as string };
}

/** The pull request (with the scanner's task when given) when one is named, else the branch; throws when neither is. */
export function sonarRefOf(options: { pr?: string; task?: string; branch?: string }): SonarRef {
  if (named(options.pr)) return named(options.task) ? { pullRequest: options.pr!, task: options.task! } : { pullRequest: options.pr! };
  if (named(options.branch)) return { branch: options.branch! };
  throw new Error('name the pull request (--pr <id>) or the branch (--branch <name>) SonarQube analysed');
}
