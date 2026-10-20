// A small shell reader for the pre-tool hook (after ECC's block-no-verify, which parses instead
// of pattern-matching): it splits a command line into simple commands and sees through the usual
// ways an agent can wrap one (env assignments, `env`/`sudo`/`timeout`/`xargs`, `sh -c`, `eval`,
// `powershell -Command`/`-EncodedCommand`, `cmd /c`, `( )`, `{ }`, `if … then`, `$( )`).
// It reads, never runs. When unsure it errs toward finding more commands, not fewer.
// `&&` and `||` need no tokens of their own: `&` and `|` already split, and an empty command between
// two separators is dropped.

/** How a command line is quoted: POSIX shells, PowerShell, or cmd.exe. */
export type Dialect = 'sh' | 'powershell' | 'cmd';

interface Syntax {
  /** The character that makes the next one literal, outside single quotes. */
  escape: string;
  quotes: Set<string>;
  separators: Set<string>;
  /** Text that runs as commands of its own: `$( )`, and backticks in sh. */
  substitution: RegExp;
  /** Reads a route folder in parentheses inside a path word as part of the word (sh only, ticket 36). */
  routeFolders: boolean;
}

const SEPARATORS = [';', '|', '&', '\n', '(', ')'];
const DOLLAR_PAREN = /\$\(([^()]*)\)/g;
const SYNTAX: Record<Dialect, Syntax> = {
  sh: { escape: '\\', quotes: new Set(['"', "'"]), separators: new Set(SEPARATORS), substitution: /\$\(([^()]*)\)|`([^`]*)`/g, routeFolders: true },
  // PowerShell: backslash is an ordinary path character, the backtick escapes, `{ }` holds a script block.
  powershell: { escape: '`', quotes: new Set(['"', "'"]), separators: new Set([...SEPARATORS, '{', '}']), substitution: DOLLAR_PAREN, routeFolders: false },
  // cmd.exe: `^` escapes, and a single quote is an ordinary character. It has no `$( )`, but
  // reading one anyway only finds more commands.
  cmd: { escape: '^', quotes: new Set(['"']), separators: new Set(SEPARATORS), substitution: DOLLAR_PAREN, routeFolders: false },
};

const WRAPPERS = new Set(['env', 'command', 'builtin', 'nohup', 'time', 'exec', 'sudo', 'xargs', 'nice', 'timeout', 'wsl']);
// Words that start a compound command; the command after them is still a command.
const KEYWORDS = new Set(['!', '{', '}', 'if', 'then', 'else', 'elif', 'do', 'while', 'until']);
// Shells that run the script after a flag (`sh -c '…'`, `pwsh -Command …`, `cmd /c …`).
const SHELLS = new Map<string, Dialect>([
  ['sh', 'sh'],
  ['bash', 'sh'],
  ['zsh', 'sh'],
  ['dash', 'sh'],
  ['ksh', 'sh'],
  ['powershell', 'powershell'],
  ['pwsh', 'powershell'],
  ['cmd', 'cmd'],
]);
// Commands that run their arguments as a script.
const EVALS = new Map<string, Dialect>([
  ['eval', 'sh'],
  ['iex', 'powershell'],
  ['invoke-expression', 'powershell'],
]);
const SCRIPT_FLAG = /^(?:-[a-z]*c|-com[a-z]*|\/[ck])$/i;
// PowerShell's -EncodedCommand and its abbreviations: base64 of UTF-16LE text.
const ENCODED_FLAG = /^-e(?:c|nc[a-z]*)?$/i;
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
// Scripts inside scripts deeper than this are refused rather than read: reading them costs time
// a hook does not have, and no honest command needs it.
const MAX_NESTING = 8;

interface Lexer {
  out: string[];
  word: string;
  hasWord: boolean;
  quote: string | null;
}

function flush(s: Lexer): void {
  if (s.hasWord) s.out.push(s.word);
  s.word = '';
  s.hasWord = false;
}

function append(s: Lexer, text: string, used: number): number {
  s.word += text;
  s.hasWord = true;
  return used;
}

/** One step inside quotes; returns the characters used. Only double quotes have escapes. */
function quotedStep(s: Lexer, line: string, i: number, syntax: Syntax): number {
  const c = line[i]!;
  if (c === s.quote) {
    s.quote = null;
    return 1;
  }
  return c === syntax.escape && s.quote === '"' ? append(s, line.slice(i + 1, i + 2), 2) : append(s, c, 1);
}

// A Next.js route folder in parentheses (`(app)`, `(..)`) right after a `/` or another such
// folder in a word: `src/app/(app)/page.test.tsx`. sh refuses a bare `(` inside a word as a syntax
// error, so reading it as part of the word hides no command that runs; anything else in the
// parentheses (a space, a `;`) still splits.
const ROUTE_FOLDER = /^\([\w.-]*\)/;

/** The route folder starting at i in a path word, or undefined. */
const routeFolder = (s: Lexer, line: string, i: number, syntax: Syntax) =>
  syntax.routeFolders && /[/)]$/.test(s.word) ? ROUTE_FOLDER.exec(line.slice(i))?.[0] : undefined;

/** One step outside quotes; returns the characters used. */
function bareStep(s: Lexer, line: string, i: number, syntax: Syntax): number {
  const c = line[i]!;
  const folder = routeFolder(s, line, i, syntax);
  if (folder !== undefined) return append(s, folder, folder.length);
  if (syntax.separators.has(c)) {
    flush(s);
    s.out.push(c);
    return 1;
  }
  if (syntax.quotes.has(c)) {
    s.quote = c;
    return append(s, '', 1);
  }
  if (c === syntax.escape) return append(s, line.slice(i + 1, i + 2), 2);
  if (/\s/.test(c)) {
    flush(s);
    return 1;
  }
  return append(s, c, 1);
}

/** Words and separators, with quotes removed from the words. */
function lex(line: string, syntax: Syntax): string[] {
  const s: Lexer = { out: [], word: '', hasWord: false, quote: null };
  for (let i = 0; i < line.length; ) i += s.quote ? quotedStep(s, line, i, syntax) : bareStep(s, line, i, syntax);
  flush(s);
  return s.out;
}

export function tokenize(line: string, dialect: Dialect = 'sh'): string[] {
  const syntax = SYNTAX[dialect];
  return lex(line, syntax).filter((t) => !syntax.separators.has(t));
}

/** A program as a command line names it: `/usr/bin/git`, `C:\Git\git.exe` and `GIT` all run git. */
export function program(word: string): string {
  return word
    .split(/[\\/]/)
    .at(-1)!
    .toLowerCase()
    .replace(/\.(?:exe|cmd|bat)$/, '');
}

// Throws on a missing word (startsWith), so no scan can quietly run past the end. A numbered
// redirection (`exec 3>file`) is not an option: it stays a word, so its target is still checked.
const optionish = (word: string) => word.startsWith('-') || /^\d[^<>]*$/.test(word);
const isWrapper = (word: string | undefined) => word !== undefined && WRAPPERS.has(program(word));

/** For each position, where a command starting there really starts: past env assignments and keywords. */
function commandFrom(words: string[]): number[] {
  return words.reduceRight(
    (next, word, i) => {
      next[i] = ASSIGNMENT.test(word) || KEYWORDS.has(word) ? next[i + 1]! : i;
      return next;
    },
    new Array<number>(words.length + 1).fill(words.length),
  );
}

/**
 * Where the command run by the wrapper at `at` may start. An option may take the next word as
 * its value (`sudo -u root git`, `timeout 10 git`, `xargs -I {} git`), so after an option the
 * scan goes one word further. It stops at the next wrapper, which is scanned in its own turn:
 * that finds nothing new, but keeps a long chain of wrappers linear.
 */
function* startsAfterWrapper(words: string[], at: number): Generator<number> {
  for (let k = at + 1; k < words.length; k++) {
    if (optionish(words[k]!)) continue;
    yield k;
    if (isWrapper(words[k]) || !optionish(words[k - 1]!)) break;
  }
}

/** The commands in one simple command's words, past assignments and wrappers. */
function commandsIn(words: string[]): string[][] {
  const from = commandFrom(words);
  const starts = new Set([from[0]!]);
  for (const s of starts) {
    if (isWrapper(words[s])) for (const k of startsAfterWrapper(words, s)) starts.add(from[k]!);
  }
  // A start past the end (only assignments, or a wrapper with nothing after it) is an empty command.
  return [...starts]
    .filter((s) => !isWrapper(words[s]))
    .map((s) => words.slice(s))
    .filter((c) => c.length > 0);
}

/** The script a shell or `eval` runs, if this command is one, and how it is quoted. */
function innerScript(words: string[]): { script: string; dialect: Dialect } | undefined {
  const name = program(words[0]!);
  const args = words.slice(1);
  const evaluated = EVALS.get(name);
  if (evaluated) return { script: args.join(' '), dialect: evaluated };
  const dialect = SHELLS.get(name);
  const flag = args.findIndex((a) => SCRIPT_FLAG.test(a) || ENCODED_FLAG.test(a));
  if (dialect === undefined || flag === -1) return undefined;
  const script = args.slice(flag + 1).join(' ');
  // An encoded script is read both ways: the flag may be bash's `-ec` rather than PowerShell's.
  return { script: ENCODED_FLAG.test(args[flag]!) ? `${script}\n${decoded(args[flag + 1] ?? '')}` : script, dialect };
}

function decoded(base64: string): string {
  return Buffer.from(base64, 'base64').toString('utf16le');
}

function split(tokens: string[], syntax: Syntax): string[][] {
  const commands: string[][] = [[]];
  for (const t of tokens) {
    if (syntax.separators.has(t)) commands.push([]);
    else commands.at(-1)!.push(t);
  }
  // Empty commands stay: they have no command start, so they yield nothing.
  return commands;
}

/** A line as read: the simple commands it runs, and every word it holds, assignments included. */
export interface ReadLine {
  commands: string[][];
  words: string[];
}

function parse(line: string, dialect: Dialect, depth: number): ReadLine {
  if (depth > MAX_NESTING) throw new Error(`the command nests scripts more than ${MAX_NESTING} deep`);
  const syntax = SYNTAX[dialect];
  const simple = split(lex(line, syntax), syntax);
  const expand = (words: string[]): ReadLine => {
    const inner = innerScript(words);
    return inner === undefined ? { commands: [words], words: [] } : parse(inner.script, inner.dialect, depth + 1);
  };
  const substituted = [...line.matchAll(syntax.substitution)].map((m) => parse(m.slice(1).join(''), dialect, depth + 1));
  const parts = [...simple.flatMap(commandsIn).map(expand), ...substituted];
  return { commands: parts.flatMap((p) => p.commands), words: [...simple.flat(), ...parts.flatMap((p) => p.words)] };
}

/**
 * The simple commands a line runs, each as its words as written; compare the first through
 * `program()`, which sees `/usr/bin/git` and `GIT.EXE` as git.
 * Throws when scripts nest too deep to read; the hook treats that as a command it cannot inspect.
 */
export function commandsOf(line: string, dialect: Dialect = 'sh'): string[][] {
  return parse(line, dialect, 0).commands;
}

/**
 * The commands a line runs and every word in it, at every depth: env assignments that commandsOf
 * steps past (`HUSKY=0 git commit`) are among the words. Throws as commandsOf does.
 */
export function readLine(line: string, dialect: Dialect = 'sh'): ReadLine {
  return parse(line, dialect, 0);
}
