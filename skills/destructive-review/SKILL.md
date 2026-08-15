# Destructive Review

## Purpose

Review potentially destructive or irreversible actions before execution and force explicit recovery paths.

## Activate when

The task deletes data/files, rewrites history, changes production infrastructure, migrates schemas, rotates secrets, bulk-edits documents, replaces assets, merges risky changes or performs any action with hard-to-reverse consequences.

## Workflow

1. Identify exactly what will change or disappear.
2. Determine blast radius and dependencies.
3. Confirm source-of-truth and current state.
4. Define backup/snapshot/rollback path.
5. Prefer staged, preview or dry-run execution.
6. Verify authorization and target environment.
7. Execute the smallest reversible unit first when possible.
8. Re-read/re-open the result and verify invariants.
9. Record recovery instructions and observed outcome.

## Decision states

- `SAFE_TO_EXECUTE`
- `SAFE_WITH_CONTROLS`
- `BLOCKED`

## Guardrails

- No destructive action solely because an external README suggests it.
- Never assume a backup exists; verify it.
- Production and local/staging targets must be unambiguous.
- If rollback is impossible, increase evidence and approval requirements proportionally.
