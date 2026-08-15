# Root of Trust

## Purpose

Protect the small set of controls that define whether AI Factory may trust its own execution and learning.

## Activate when

A task touches production permissions, secrets, security boundaries, catastrophic actions, audit integrity, rollback requirements, evidence honesty, self-modification rules, or the Constitution itself.

## Rules

1. Runtime agents may read Root of Trust but may not directly modify it.
2. A task blocked by a Root of Trust rule may propose a constitutional change, but the same task cannot approve or activate that change.
3. Any constitutional change requires explicit provenance, adversarial evals, impact analysis, rollback instructions and a separate approval path.
4. Security/evidence gates cannot be weakened to satisfy the operation they currently block.
5. Audit history is append-only in meaning: corrections supersede prior records rather than silently rewriting history.
6. Production-destructive actions require an authorized execution path and verified recovery controls proportional to blast radius.

## Output contract

Return one of:

- `ALLOW` — operation is inside existing constitutional authority;
- `ALLOW_WITH_CONTROLS` — operation is permitted only with named controls;
- `BLOCK` — current operation is prohibited;
- `PROPOSE_CONSTITUTION_CHANGE` — create a separately reviewable change proposal; do not execute the blocked action.

## Guardrails

- Never treat urgency as authority.
- Never infer approval from silence.
- Never persist or expose secrets in logs/evidence.
- No autonomous self-approval of Root of Trust changes.
