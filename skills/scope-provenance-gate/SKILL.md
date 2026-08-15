# Scope & Provenance Gate

## Purpose

Prevent agents from quietly using evidence, code, files or assumptions outside the authorized task scope.

## Activate when

Work combines multiple repositories, datasets, document versions, external sources or imported artifacts.

## Workflow

1. Define authorized scope: product, repository, branch, dataset, jurisdiction, time period and source set.
2. Tag each major input with provenance.
3. Detect evidence or artifacts from outside scope.
4. Either exclude them or explicitly reopen scope before use.
5. Preserve source lineage through transformations.
6. Fail the gate when a critical output cannot be traced to an authorized input.

## Guardrails

- Similar filenames/projects are not interchangeable.
- Legacy data cannot silently support current production claims.
- External examples remain examples unless adopted explicitly.
