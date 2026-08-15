# Verified Provenance Gate

## Purpose

Require high-impact facts, decisions and generated records to carry verifiable lineage rather than a vague statement that they came from a source.

## Activate when

An output supports legal, funding, eligibility, financial, audit, policy or production decisions.

## Workflow

1. Identify all claims that materially affect the decision.
2. Trace each claim to its source/version/locator or authoritative system record.
3. Verify that quoted/extracted content exists in that exact source version.
4. Confirm transformations did not change units, dates, legal meaning or scope.
5. Mark machine-generated interpretations separately from verified source facts.
6. Fail closed for claims with missing or broken lineage.

## Gate states

- `VERIFIED`
- `PARTIAL`
- `UNVERIFIED`
- `BROKEN_LINEAGE`

## Guardrails

A URL alone is not sufficient provenance for mutable content. A machine candidate or summary cannot upgrade itself to verified evidence.
