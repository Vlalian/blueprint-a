// A path glob as a regular expression: `**` across folders (and `**/` for no folder at all), `*`
// and `?` within one name, every other character literal, case ignored as on Windows. Shared by
// the gates that match project paths. The same matcher as the pre-tool hook's
// (adapters/claude-code/pre-tool-core.ts), which keeps its own copy so it still runs, and blocks,
// from its folder alone; this one lets the gates travel without the hook (ticket 20, the
// Blueprint A export).

export function globToRegExp(glob: string): RegExp {
  const source = glob
    .split('**')
    .map((part) => part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]'))
    .join('.*')
    // `**/` may stand for no folder at all: `**/x.md` matches `x.md`.
    .replaceAll('.*/', '(?:.*/)?');
  // Case-insensitive: on Windows `context.md` is CONTEXT.md.
  return new RegExp(`^${source}$`, 'i');
}
