# Claim Checker

## Purpose

Stress-test factual, scientific, causal and viral claims before they enter a product, decision or research brief.

## Activate when

A claim is surprising, consequential, viral, numerological, causal, health/science-related, politically sensitive, or likely to be repeated as fact without clear provenance.

## Workflow

`CLAIM → DEFINE → SOURCE → EVIDENCE → CAUSALITY CHECK → ALTERNATIVES → VERDICT`

1. Rewrite the claim into a testable statement.
2. Identify what evidence would confirm or falsify it.
3. Find the strongest available primary/authoritative sources.
4. Separate observation/correlation from mechanism and causation.
5. Check base rates, selection effects, arithmetic identities, cherry-picking and post-hoc explanations.
6. Generate at least one credible alternative explanation when causality is asserted.
7. Assign verdict: `SUPPORTED`, `PARTIALLY SUPPORTED`, `UNSUPPORTED`, `MISLEADING`, or `UNRESOLVED`.
8. State confidence and missing evidence.

## Guardrails

- Pattern recognition is not proof.
- Arithmetic coincidences do not imply physical or causal laws.
- Repetition across websites does not create independent evidence.
- Lack of evidence is not automatically evidence of absence; match verdict strength to available data.
- Preserve exact wording when a narrower claim is supported than the viral version.

## Output contract

Return: normalized claim, evidence for, evidence against, alternative explanations, verdict, confidence, and sources.
