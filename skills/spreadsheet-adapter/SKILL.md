# Spreadsheet Adapter

## Purpose

Automate spreadsheet analysis and edits through a bounded, auditable workflow.

## Activate when

The task needs XLSX/CSV formulas, tables, validation, charts, pivots, formatting or structured spreadsheet transformations.

## Workflow

`READ → PROFILE → VALIDATE → PLAN → PREVIEW/DIFF → BACKUP → WRITE → REOPEN → VERIFY`

1. Inspect workbook sheets, ranges, formulas and named structures before editing.
2. Identify invariants: required columns, formula dependencies, data types and protected regions.
3. Produce a change plan and preview/diff when the edit is non-trivial.
4. Back up valuable files before destructive changes.
5. Write only inside an allowlisted workspace.
6. Reopen the output and verify formulas, values, sheet structure and expected calculations.

## Security gates

- no unrestricted filesystem access;
- no unauthenticated network transport;
- no hidden macros/scripts;
- explicit file scope;
- external MCP/server integration must pass Third-Party Security.

## Guardrails

- Never treat formatting success as data correctness.
- Preserve formulas unless the task explicitly replaces them.
- Do not silently coerce dates, currencies or identifiers.

## Provenance

Workflow informed by capabilities in `haris-musa/excel-mcp-server`; executable MCP adoption remains controlled rather than trusted by default.
