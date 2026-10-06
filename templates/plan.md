Plan for: <path to the ticket>
Created: YYYY-MM-DD
Status: draft

# NN - <title>

## What this is
One paragraph: why it exists, from the ticket.

## What I verified in the code
What was grepped and what was found, including anything the ticket got wrong.

## Approach
Files, seams, interfaces. Each file the build creates is on a line that says "Create" or "new".

## Patterns to mirror
| Category | Copy from | Pattern |
|---|---|---|
| Naming | `path:line` | |
| Errors / refusals | `path:line` | |
| Tests | `path:line` | |

Write "none: new pattern" in a row where nothing comparable exists.

## Behavior list
In vertical-slice order; the build adds them one at a time: test, red, green, next.

### 1. <behavior>
```ts
it('<what it guarantees>', () => {
  // the real assertions
});
```
Fails before implementation with: <the error or wrong value>

Tests are the default. A claim no test can show (how a page looks, a manual flow) may instead be
marked as needing named non-test evidence: in place of the ts block and the "Fails before" line,
write these four lines, with plain paths (no backticks; the evidence is made during the build):

    Evidence: non-test
    Evidence by: coder
    Evidence file: docs/evidence/<ticket NN>-<evidence name>.png
    Evidence report: docs/evidence/<ticket NN>-<evidence name>.json

"Evidence by" names the build role that makes it (coder, cleaner or hardener); its brief lists the
behaviour with both paths, and it can run the project's commands to make them (an e2e run, a
snapshot update). The file is a saved screenshot (.png, .jpg, .jpeg, .webp) or recording (.mp4, .webm, .mov, .gif).
The evidence gate (gates/evidence) checks the report against its schema (claim, evidence, kind:
screenshot or recording, capturedAt, observed, verdict), that the file was saved, and the verdict.

## Acceptance criteria -> behaviors
- <criterion, word for word from the ticket> -> behaviors 1

## Out of scope
None.

## Risks for an unattended build
None.

## Needs the owner's own eyes
None.

Or one item per question only the owner can answer, each with the answer you would pick and why it
matters, so he can accept it in one word ("I don't know" is a valid reply):

    - Should slugs keep accented letters?
      Recommended: no, ASCII only.
      Why it matters: it fixes every URL the app will ever print.
