import ts from 'typescript';

/**
 * Cyclomatic complexity per function, read off the TypeScript AST.
 *
 * Pure: text in, numbers out, no filesystem. Uses the compiler the repo
 * already depends on rather than adding a parser — `tsc` is a devDependency
 * and its AST is the same one the typechecker sees.
 *
 * Complexity is one plus the number of decisions. A decision is anywhere
 * control could go two ways: `if`, loops, each `case`, a ternary, `&&`, `||`,
 * `??`, `catch`, and an optional call or access. `else` is not a decision —
 * it is the other side of one already counted — and neither is `default`,
 * which is what happens when every case above said no.
 *
 * A nested function is scored **separately** and never charged to its parent.
 * Otherwise a function whose only sin is holding a callback reads as complex,
 * and hoisting the callback out would "fix" a score without changing anything
 * a reader cares about.
 */

/**
 * How any metric here points at a function: what to call it, and where it is.
 *
 * Shared rather than restated per metric. The two scores are printed against
 * the same function in one report, so a reader has to be able to match the
 * rows — and a second copy of these four fields is a second chance for them to
 * drift apart. `eachFunction` and `rangeOf` are what fill it in, once.
 */
export type FunctionRef = {
  /** The declared name, or a positional label where there is none. */
  name: string;
  file: string;
  startLine: number;
  endLine: number;
};

export type FunctionComplexity = FunctionRef & {
  complexity: number;
};

type FunctionNode =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration
  | ts.GetAccessorDeclaration
  | ts.SetAccessorDeclaration
  | ts.ConstructorDeclaration;

/** Every node kind that has its own body, and so its own score. */
const FUNCTION_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
  ts.SyntaxKind.Constructor,
]);

export function isFunctionNode(node: ts.Node): node is FunctionNode {
  return FUNCTION_KINDS.has(node.kind);
}

/**
 * Calls `visit` once per function in `tree`, nested ones included, in source
 * order.
 *
 * Discovery is separated from scoring so a second metric can reuse it rather
 * than grow its own copy of "what counts as a function and what is it called"
 * — two answers to that question drifting apart would make the two scores
 * describe different sets of functions while appearing side by side in one
 * report.
 *
 * The visitor is handed the node only. What it does about the functions
 * nested *inside* that node is its own business: both metrics here score them
 * separately and stop at the boundary, but that is a scoring rule, not a
 * discovery rule.
 */
export function eachFunction(tree: ts.SourceFile, visit: (fn: FunctionNode) => void): void {
  function descend(node: ts.Node) {
    if (isFunctionNode(node)) visit(node);
    ts.forEachChild(node, descend);
  }
  ts.forEachChild(tree, descend);
}

/** The 1-based line range of `node`, as both metrics report it. */
export function rangeOf(node: ts.Node, tree: ts.SourceFile): { startLine: number; endLine: number } {
  return {
    startLine: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1,
    endLine: tree.getLineAndCharacterOfPosition(node.getEnd()).line + 1,
  };
}

/**
 * Kinds that cost exactly one decision, as a lookup rather than a chain of
 * type guards — each guard is itself a branch, so writing this as `a || b ||
 * …` made the function that counts complexity one of the most complex in the
 * repo. `default:` is absent deliberately: it is what happens when every
 * `case` above said no, not a decision of its own. So is `else`.
 */
const DECISION_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.ConditionalExpression,
  ts.SyntaxKind.CatchClause,
  ts.SyntaxKind.CaseClause,
]);

/** Binary operators that branch. */
const DECISION_OPERATORS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
]);

/** Node kinds that carry an optional `?.`, which branches on nullish. */
const OPTIONAL_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.PropertyAccessExpression,
  ts.SyntaxKind.ElementAccessExpression,
  ts.SyntaxKind.CallExpression,
]);

/** One decision each; everything not listed is free. */
function decisionsAt(node: ts.Node): number {
  if (DECISION_KINDS.has(node.kind)) return 1;

  if (ts.isBinaryExpression(node)) {
    return DECISION_OPERATORS.has(node.operatorToken.kind) ? 1 : 0;
  }

  // `a?.b` and `a?.()` each branch on nullish, exactly like a ternary would.
  // Stryker disable next-line ConditionalExpression — equivalent: no other node kind carries a questionDotToken, so removing this guard reaches the same `undefined` and returns the same 0
  if (OPTIONAL_KINDS.has(node.kind)) {
    const optional = node as ts.PropertyAccessExpression | ts.ElementAccessExpression | ts.CallExpression;
    return optional.questionDotToken === undefined ? 0 : 1;
  }

  return 0;
}

/** A readable label for a function that has no name of its own. */
export function nameOf(node: FunctionNode, source: ts.SourceFile): string {
  if (ts.isConstructorDeclaration(node)) return 'constructor';
  if (node.name) return node.name.getText(source);

  // `const f = () => …` and `{ f: () => … }` name the function through their
  // parent, which is how a reader refers to it.
  const parent = node.parent;
  if (parent && (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent))) {
    return parent.name.getText(source);
  }

  const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
  return `(anonymous):${line + 1}`;
}

/**
 * Every function in `source`, with its complexity and line range.
 *
 * The range is what lets coverage be attributed back to a function without
 * matching on names, which v8-to-istanbul conversion does not preserve
 * reliably.
 */
export function measureComplexity(file: string, source: string): FunctionComplexity[] {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const found: FunctionComplexity[] = [];

  eachFunction(tree, (fn) => {
    let complexity = 1;

    // Walk this function's own body only: descending into a nested function
    // would charge its decisions here as well as to itself, and `eachFunction`
    // is already visiting it in its own right.
    function walk(node: ts.Node) {
      if (node !== fn && isFunctionNode(node)) return;
      complexity += decisionsAt(node);
      ts.forEachChild(node, walk);
    }
    walk(fn);

    found.push({ name: nameOf(fn, tree), file, ...rangeOf(fn, tree), complexity });
  });

  // Already in source order, so the sort this used to end with is gone. The
  // old walk recorded a nested function *before* its parent and needed sorting
  // to read right; `eachFunction` descends instead, reaching the parent first.
  // The mutation run is what showed the sort had become a no-op.
  return found;
}
