# Evidence-Locked Extraction

## Purpose

Extract structured facts from documents, pages or datasets while preserving an auditable link back to the source.

## Activate when

The factory converts unstructured evidence into facts, requirements, entities, deadlines, amounts, eligibility rules or machine-readable records.

## Workflow

1. Snapshot/identify the exact source version.
2. Define the extraction schema before extraction.
3. Extract candidate values with source locators.
4. Preserve exact quotes for legally/decision-critical fields when appropriate.
5. Validate type, units, dates, ranges and cross-field consistency.
6. Separate machine candidates from human-verified facts.
7. Reject or flag values whose source cannot be located.
8. Store provenance with the structured record.

## Required provenance

At minimum: source identifier, version/date if available, locator, extraction method, confidence/verification status and timestamp.

## Guardrails

- A model inference is not a source fact.
- Never fabricate a quote or locator.
- Preserve source context where a value changes meaning outside its clause/table.
- When the source is ambiguous, keep the field `UNKNOWN` or candidate-only.
