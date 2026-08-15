# Incident Learning

## Purpose

Convert consequential failures and recurring weak patterns into durable lessons, negative-action rules and regression evals without allowing unbounded self-rewrite.

## Activate when

A run fails a gate, violates an invariant, repeats a known defect, causes an avoidable incident, or produces a success/failure pattern likely to recur.

## Loop

`OBSERVE -> CLASSIFY -> ROOT_CAUSE -> LESSON_CANDIDATE -> GENERALIZE -> REGRESSION_EVAL -> PATCH_CANDIDATE -> COMPARE -> PROMOTE | REJECT`

## Incident severity

- `UNDESIRABLE` — weak practice; avoid when practical.
- `FORBIDDEN` — action is blocked by policy except through an explicitly defined exception path.
- `CATASTROPHIC` — hard block because blast radius includes irreversible loss, security boundary failure, fabricated evidence, or compromise of Root of Trust.

## Required incident record

- run/task identity;
- exact observed failure;
- evidence class and provenance;
- root cause;
- affected invariant/contract;
- blast radius;
- repair performed;
- recurrence likelihood;
- proposed negative action, if any;
- regression eval reference;
- candidate skill/policy change;
- baseline-versus-candidate result.

## Promotion rules

A learning change may be promoted automatically only when:

1. it is within the configured autonomy level;
2. it does not weaken Root of Trust, security, production permissions, evidence honesty or catastrophic controls;
3. the regression eval reproduces the original failure;
4. the candidate passes the original failure and the broader required eval suite;
5. measured quality is not worse than baseline beyond declared tolerance;
6. the change and provenance are persisted.

Otherwise create a reviewable proposal/PR and keep the current policy active.

## Guardrails

- Never rewrite the eval solely to make a candidate pass.
- Never convert one unusual event into a universal rule without generalization evidence.
- Never erase the incident that motivated a superseding rule.
- Store concise evidence and decision traces, never private chain-of-thought.
