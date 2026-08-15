# Repair / Self-Healing Engineering

## Purpose

Turn failed checks and observed defects into bounded repair work rather than hiding failures or restarting blindly.

## Activate when

Any quality gate, test, build, visual comparison, data validation or runtime observation fails.

## Workflow

`FAILURE → CLASSIFY → REPRODUCE → ROOT CAUSE → REPAIR PLAN → MINIMAL FIX → RECHECK → SAVE LESSON`

1. Preserve the exact failure evidence.
2. Classify whether the failure is code, data, environment, specification, source/evidence, design or integration.
3. Reproduce deterministically when possible.
4. Find root cause and affected invariants.
5. Make the smallest coherent repair.
6. Re-run the original failing check plus nearby regression checks.
7. Save a reusable rule/postmortem when the failure pattern is likely to recur.

## Guardrails

- No unbounded retries.
- Do not broaden scope until the direct repair path is exhausted or disproven.
- Never change acceptance criteria merely to turn a failure green.
- Environment failures remain distinct from product failures.
