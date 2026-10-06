import ts from 'typescript';
import { eachFunction, isFunctionNode, nameOf, rangeOf, type FunctionRef } from './complexity.ts';

/**
 * Cognitive complexity per function (Campbell, SonarSource, 2018), read off
 * the same AST as cyclomatic complexity beside it.
 *
 * **This is a diagnostic. It does not gate.** `policy.ts` never sees it; the
 * verdict is CRAP and mutation, exactly as before. It prints under the gate
 * for the same reason `.scratch/onkel/PLAN.md` prints coupling that way: an
 * agent told to lower a number invents structure to lower it, and the cheapest
 * way to flatten nesting is to hoist a body into a helper called once, which
 * moves the score without helping a reader. Whether this earns a ceiling is a
 * question for the numbers it produces, not one to answer in advance.
 *
 * It exists because cyclomatic complexity is blind to *shape*. It counts
 * decisions and does not care how they are arranged, so
 *
 *     switch (k) { case 'a': ... case 'e': }  // cyclomatic 6 — at the ceiling
 *     if (a) { if (b) { if (c) { ... } } }    // cyclomatic 4 — comfortably under
 *
 * grades the flat switch worse than the triple nest, which is backwards for
 * anything a human or an agent has to read. Cognitive complexity is built to
 * invert exactly that: a `switch` costs one however many arms it has, and
 * every structure costs one *plus how deeply it is nested*.
 *
 * Pure: text in, numbers out, no filesystem.
 *
 * ## Two deliberate departures from the published rules
 *
 * **A nested function is scored separately** rather than raising the nesting
 * level of its parent. Campbell nests them; this repo already decided the
 * other way for cyclomatic, with the reason that a function whose only sin is
 * holding a callback should not read as complex. Two metrics printed side by
 * side disagreeing about which function they are describing is worse than
 * either convention.
 *
 * **`?.` costs nothing**, where cyclomatic charges it one. The published rules
 * predate optional chaining, so this is a judgement rather than a deviation:
 * `a?.b` is a break in control flow, but it is not a break a reader has to
 * hold anything in their head for — which is the thing this metric is trying
 * to measure. That is the sharpest difference between the two scores, and it
 * is intended.
 */

/**
 * Deliberately the *same* `FunctionRef` cyclomatic uses, not a matching copy.
 * The two scores are printed against one function, so a reader has to be able
 * to match the rows — sharing the type makes that structural instead of a
 * coincidence two files have to keep up.
 */
export type FunctionCognitive = FunctionRef & {
  cognitive: number;
};

/**
 * The two things every walker below needs: somewhere to add, and a way onward
 * that carries the nesting level.
 *
 * Bundled rather than passed as a pair, because they travel together through
 * every function here and would otherwise be a data clump.
 */
type Walker = {
  charge: (amount: number) => void;
  walk: (node: ts.Node, nesting: number) => void;
};

/** Operators whose *runs* cost one each. */
const LOGICAL_OPERATORS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
]);

/**
 * Whether this operator node is the tail of a run of the same operator.
 *
 * `parent` is not guarded: the tree is built with `setParentNodes`, and the
 * only node without one is the `SourceFile`, which is never a binary
 * expression. A guard here was dead, and the mutation run is what said so.
 */
function continuesSequence(node: ts.BinaryExpression): boolean {
  const parent = node.parent;
  if (!ts.isBinaryExpression(parent)) return false;
  return parent.operatorToken.kind === node.operatorToken.kind;
}

/**
 * One per *sequence* of like operators, not one per operator.
 *
 * `a && b && c` is one thing to understand and costs one. `a && b || c` is two
 * — the mixture is the difficulty — and `a && (b && c)` is also two, because
 * the parentheses break the run. Charging the outermost node of each run is
 * what produces all three.
 */
function logicalSequenceCost(node: ts.Node): number {
  if (!ts.isBinaryExpression(node)) return 0;
  if (!LOGICAL_OPERATORS.has(node.operatorToken.kind)) return 0;
  return continuesSequence(node) ? 0 : 1;
}

/** A labelled `break`/`continue` is a jump, and costs one. A bare one does not. */
function jumpCost(node: ts.Node): number {
  if (!ts.isBreakOrContinueStatement(node)) return 0;
  return node.label === undefined ? 0 : 1;
}

/** Costs that apply wherever they appear, with no penalty for depth. */
function flatCost(node: ts.Node): number {
  return logicalSequenceCost(node) + jumpCost(node);
}

/**
 * The child that sits *inside* a nesting structure, or undefined if this node
 * is not one.
 *
 * A `try` block is absent on purpose: entering a `try` is not a decision, so
 * only the `catch` costs anything.
 *
 * The order is not arbitrary. With the catch last, forcing its condition true
 * returned `node.block` — undefined on every other node kind, so exactly what
 * the line below returns anyway, and no test could ever tell. Reading the
 * narrowest property first makes each arm observable: forced true, the catch
 * line now hands a switch `undefined` and breaks its nesting, which a test
 * does see.
 */
function bodyOf(node: ts.Node): ts.Node | undefined {
  if (ts.isCatchClause(node)) return node.block;
  if (ts.isSwitchStatement(node)) return node.caseBlock;
  if (ts.isIterationStatement(node, false)) return node.statement;
  return undefined;
}

/**
 * A loop, switch or catch: one plus its depth, and everything inside it is a
 * level deeper.
 *
 * The whole `switch` is charged once here — its arms are not decisions under
 * these rules, because a reader takes in one dispatch rather than five. That
 * is the single largest disagreement with the cyclomatic score.
 */
function walkNesting(node: ts.Node, body: ts.Node, nesting: number, w: Walker): void {
  w.charge(1 + nesting);
  ts.forEachChild(node, (child) => w.walk(child, child === body ? nesting + 1 : nesting));
}

/** A ternary costs like an `if`: one plus depth, with both arms a level deeper. */
function walkTernary(node: ts.ConditionalExpression, nesting: number, w: Walker): void {
  w.charge(1 + nesting);
  w.walk(node.condition, nesting);
  w.walk(node.whenTrue, nesting + 1);
  w.walk(node.whenFalse, nesting + 1);
}

/**
 * An `if`, and the whole `else if ... else` chain hanging off it.
 *
 * The head costs one plus its depth. Every `else` and `else if` after it costs
 * a flat one with **no depth penalty** — the chain is one construct a reader
 * takes in together, and charging its tail for the depth of its head would
 * make a five-branch chain read as deeply nested when it is flat.
 *
 * The chain is consumed here rather than left to the generic walk, so no
 * `else if` is ever reached as though it were the head of its own.
 */
function walkIf(node: ts.IfStatement, nesting: number, w: Walker, isElseIf: boolean): void {
  w.charge(isElseIf ? 1 : 1 + nesting);
  w.walk(node.expression, nesting);
  w.walk(node.thenStatement, nesting + 1);

  const alt = node.elseStatement;
  if (alt === undefined) return;
  if (ts.isIfStatement(alt)) return walkIf(alt, nesting, w, true);

  w.charge(1);
  w.walk(alt, nesting + 1);
}

/** One node: what it costs, and at what depth its children are read. */
function step(node: ts.Node, nesting: number, w: Walker): void {
  // Scored on its own visit, per the departure documented at the top.
  if (isFunctionNode(node)) return;

  if (ts.isIfStatement(node)) return walkIf(node, nesting, w, false);
  if (ts.isConditionalExpression(node)) return walkTernary(node, nesting, w);

  const body = bodyOf(node);
  if (body !== undefined) return walkNesting(node, body, nesting, w);

  w.charge(flatCost(node));
  ts.forEachChild(node, (child) => w.walk(child, nesting));
}

/**
 * Every function in `source`, with its cognitive score and line range.
 *
 * A branchless function scores 0, not 1 — unlike cyclomatic, which starts at
 * one path. There is nothing to hold in your head, so there is nothing to
 * charge for.
 */
export function measureCognitive(file: string, source: string): FunctionCognitive[] {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const found: FunctionCognitive[] = [];

  eachFunction(tree, (fn) => {
    let cognitive = 0;
    const walker: Walker = {
      charge: (amount) => {
        cognitive += amount;
      },
      walk: (node, nesting) => step(node, nesting, walker),
    };

    ts.forEachChild(fn, (child) => walker.walk(child, 0));

    found.push({ name: nameOf(fn, tree), file, ...rangeOf(fn, tree), cognitive });
  });

  // Already in source order — `eachFunction` descends the tree, so a parent is
  // reached before anything nested in it and siblings come in the order they
  // are written. A sort here was a no-op, and the mutation run is what said so.
  return found;
}
