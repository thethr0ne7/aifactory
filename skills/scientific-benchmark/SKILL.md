# Scientific Benchmark Pattern

## Purpose

Evaluate models, prompts, retrieval strategies or agent skills with repeatable test sets instead of anecdotal success.

## Activate when

Comparing models/providers, validating a new skill, tuning retrieval, measuring extraction quality or deciding whether an AI change should become default.

## Workflow

1. Define the capability and metric before running tests.
2. Build a representative dataset with normal, difficult and failure cases.
3. Freeze inputs and scoring rubric for the comparison.
4. Run baseline and candidate under comparable conditions.
5. Measure correctness plus relevant secondary metrics such as evidence fidelity, latency, cost, context use and failure rate.
6. Inspect qualitative failures rather than relying only on an average score.
7. Adopt only when improvement is material and trade-offs are acceptable.

## Guardrails

- Do not tune exclusively to the benchmark set.
- Keep evaluation data separate from prompts/examples where leakage would invalidate the result.
- Small samples produce weak conclusions; state uncertainty.
- A model win on one capability does not imply global superiority.
