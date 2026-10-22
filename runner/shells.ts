// Process shells declare themselves (ticket 56): a file that only parses arguments and wires real
// I/O into a tested core carries the line `// @process-shell` in its own header, instead of a line
// in a shared list. Two tickets that each add a shell then touch only their own files, so their
// merges cannot conflict there (47 and 53 did on scripts/self-gate-shells.ts). That list stays as
// it is for the shells named before, and its entries count as declared.
// Pure: paths and a reader in, shells out.

/** The marker line, alone on its line. */
export const SHELL_MARK = '// @process-shell';

const MARK_LINE = /^\/\/ @process-shell\r?$/m;

export const declaresShell = (text: string | undefined) => MARK_LINE.test(String(text));

const isSource = (path: string) => path.endsWith('.ts') && !path.endsWith('.test.ts');

/** The listed shells, then each TypeScript source among `files` that declares itself, in path order; each once. */
export function processShells(listed: string[], files: string[], read: (path: string) => string | undefined): string[] {
  const declared = files
    .filter(isSource)
    .filter((p) => !listed.includes(p) && declaresShell(read(p)))
    .sort();
  return [...listed, ...declared];
}

/** git's listing of the repo's TypeScript files, committed or not (a shell being built counts). */
export const LS_SOURCES = ['ls-files', '--cached', '--others', '--exclude-standard', '--', '*.ts'];

/** processShells over LS_SOURCES' output. */
export const shellsIn = (listed: string[], listing: string, read: (path: string) => string | undefined) => processShells(listed, listing.split(/\r?\n/), read);
