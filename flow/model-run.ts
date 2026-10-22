// One way to run any model (ticket 84, from scripts/flow/codex-build.ts, scripts/codex-review*.ts
// and scripts/codex-io.ts): a family's build or review command from config/flow.json, with the
// round's brief on stdin and its placeholders ({prompt}, {worktree}, {branch}, {ticket}, {head},
// {base}, {out}) passed as environment variables the command line only names (render), run through
// a shell in the worktree and stopped at the family's timeout. Codex, Claude Code, opencode or a local model are all one command line.
// The other-family rule (11-optimisations item 5) lives here too: a round is reviewed by a
// configured family other than the one that built it, never by its own. With the process injected.

import type { ProcessResult } from '../adapters/host/process-result.ts';
import type { Family, FlowConfig } from './config.ts';

export type RunResult = ProcessResult & { timedOut?: boolean };

export interface ModelIo {
  /** The platform the shell runs on: cmd on win32, sh elsewhere. */
  platform: NodeJS.Platform;
  /** A shell command in `cwd` with `input` on stdin and `env` added to the environment, stopped after `timeoutMs`; never throws. */
  shell(command: string, cwd: string, input: string, timeoutMs: number, env: Record<string, string>): RunResult;
}

export interface ModelRun {
  exitCode: number;
  output: string;
  timedOut: boolean;
}

type Families = Pick<FlowConfig, 'families'>;

const names = (c: Families) => c.families.map((f) => f.name).join(', ') || 'none';

/** The configured family of that name; throws naming the families there are. */
export function familyNamed(c: Families, name: string): Family {
  const family = c.families.find((f) => f.name === name);
  if (family === undefined) throw new Error(`no family ${name} in config/flow.json (families: ${names(c)})`);
  return family;
}

/**
 * The family that reviews a round `builder` built: `requested` when given, else the first
 * configured family that is not the builder's. Throws when the reviewer would be the builder's own
 * family, or when no other family is configured (the stand-in reviewer of 02-flow-and-roles.md
 * applies then, and the briefing says so).
 */
export function reviewerFor(builder: string, c: Families, requested?: string): Family {
  if (requested === builder) throw new Error(`refusing a review of ${builder}'s round by ${builder}, its own family`);
  if (requested !== undefined) return familyNamed(c, requested);
  const other = c.families.find((f) => f.name !== builder);
  if (other === undefined) throw new Error(`no family but ${builder} in config/flow.json to review its round (families: ${names(c)}); add one, or use the stand-in reviewer`);
  return other;
}

export interface Rendered {
  command: string;
  env: Record<string, string>;
}

/**
 * A value as cmd's variable holds it: cmd expands a variable once, so `%`, `&`, `^` and the like
 * stay literal inside the double quotes around it, but a double quote would end them and a line
 * break would end the command, so those are refused; trailing backslashes are doubled so the
 * program's argument parser does not read the closing quote as escaped.
 */
function forCmd(name: string, value: string): string {
  if (/["\r\n]/.test(value)) throw new Error(`{${name}} cannot be passed to cmd on Windows: ${JSON.stringify(value)} has a double quote or a line break`);
  return value.replace(/\\+$/, (tail) => tail + tail);
}

/**
 * The command with each {name} it has a value for replaced by a double-quoted reference to the
 * variable FLOW_<NAME> (`"$FLOW_NAME"` for sh, `"%FLOW_NAME%"` for cmd on win32), and those
 * variables: a value never becomes part of the command line, so the shell runs nothing a path or
 * a branch carries. Any other braces stay. Write each placeholder bare, unquoted, in the template.
 */
export function render(template: string, values: Record<string, string>, platform: NodeJS.Platform): Rendered {
  const env: Record<string, string> = {};
  const command = template.replace(/\{(\w+)\}/g, (all, name: string) => {
    if (!Object.hasOwn(values, name)) return all;
    const variable = `FLOW_${name.toUpperCase()}`;
    env[variable] = platform === 'win32' ? forCmd(name, values[name]!) : values[name]!;
    return platform === 'win32' ? `"%${variable}%"` : `"$${variable}"`;
  });
  return { command, env };
}

/** Runs the family's build or review command; its exit code (1 when it was stopped or never started), output and whether it timed out. */
export function runModel(family: Family, kind: 'build' | 'review', values: Record<string, string>, cwd: string, brief: string, io: ModelIo): ModelRun {
  const { command, env } = render(family[kind], values, io.platform);
  const r = io.shell(command, cwd, brief, family.timeoutMs, env);
  const timedOut = r.timedOut === true;
  const output = `${r.stdout}${r.stderr}${r.error === undefined ? '' : `${r.error.message}\n`}`;
  return { exitCode: r.status ?? 1, output, timedOut };
}
