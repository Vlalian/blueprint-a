// The adapter interface the test-strength gates read (ticket 20, Blueprint A decision 23): one
// adapter per language ecosystem measures, the gates in gate.ts judge. The gates never run a test
// runner, a coverage tool or a mutation tester themselves, so a new language needs a new adapter
// and no change here. adapters/js-ts implements it for JavaScript and TypeScript with Stryker and
// vitest, Jest or Karma; adapters/dotnet for .NET with coverlet and Stryker.NET (ticket 30).

/** Where a function sits: the same four fields in every measurement, so rows can be matched. */
export interface FunctionRef {
  file: string;
  name: string;
  startLine: number;
  endLine: number;
}

/** coverage(): how many of a function's own lines exist and how many the tests ran. */
export interface FunctionLines extends FunctionRef {
  lines: number;
  covered: number;
}

/** complexity(): a function's cyclomatic complexity. */
export interface FunctionScore extends FunctionRef {
  complexity: number;
}

/** mutate(): one mutant and its status, in Stryker's words (Killed, Survived, NoCoverage, Timeout, ...). */
export interface Mutant {
  file: string;
  line: number;
  mutator: string;
  status: string;
}

export interface TestStrengthAdapter {
  coverage(paths: string[]): FunctionLines[];
  complexity(paths: string[]): FunctionScore[];
  mutate(paths: string[]): Mutant[];
}
