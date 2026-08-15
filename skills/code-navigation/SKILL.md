# Code Navigation

## Purpose

Find the smallest relevant slice of a codebase before editing it, using text and structural search instead of broad manual browsing.

## Activate when

The repository is unfamiliar, large, or the task references behavior without a known file path.

## Workflow

1. Identify concrete search anchors: route names, symbols, error strings, config keys, database tables, test names.
2. Use fast text search for exact/near-exact anchors.
3. Use structural/AST search when syntax relationships matter.
4. Read callers, implementations and tests around the matched symbol.
5. Build a minimal dependency map for the change.
6. Mark protected/generated/vendor paths and avoid unnecessary traversal.
7. Hand the verified scope to Engineering Kernel.

## Guardrails

- Search before recursive full-repo reading.
- Do not infer architecture from filenames alone.
- A code search hit is a navigation clue, not proof of runtime usage.
- Prefer read-only discovery until the change scope is understood.

## Provenance

Adopts useful file/structural-search patterns seen in `massgen/massgen`, without adopting its multi-agent voting architecture. Tools such as ripgrep or ast-grep are replaceable implementations.
