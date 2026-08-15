# Data Validation

## Purpose

Validate structured and extracted data before it becomes product state, analysis input or a user-facing claim.

## Activate when

Data is imported, extracted, transformed, joined, migrated, deduplicated or promoted from candidate to verified state.

## Workflow

1. Define schema, required fields, types, units and uniqueness constraints.
2. Validate source provenance and freshness.
3. Check ranges, dates, enum values, identifiers and referential integrity.
4. Detect duplicates, conflicting records and missing mandatory values.
5. Separate candidate/unverified records from verified records.
6. Reconcile only with explicit rules and record the reconciliation decision.
7. Run invariant checks after transformation/persistence.
8. Produce a validation report and quarantine invalid rows instead of silently coercing them.

## Guardrails

- Do not turn null/unknown into zero/false without domain justification.
- Preserve original raw values where auditability matters.
- A schema-valid record can still be semantically wrong; use domain checks where necessary.
