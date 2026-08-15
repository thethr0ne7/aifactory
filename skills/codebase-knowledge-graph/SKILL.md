# Codebase Knowledge Graph

## Purpose

Build a lightweight map of important code relationships before large changes so agents reason over real dependencies instead of folder names.

## Activate when

A repository is large, cross-cutting changes are planned, ownership/dependency boundaries are unclear, or repeated repository work would benefit from durable structural knowledge.

## Workflow

1. Start from known entry points, routes, packages, schemas and services.
2. Map symbols/modules to callers, tests, data stores and external interfaces.
3. Record only relationships that affect change impact or navigation.
4. Link graph nodes to exact files/symbols rather than free-form descriptions.
5. Refresh affected subgraphs after major refactors.
6. Use the graph through Context Governor; do not dump the whole graph into context.

## Guardrails

- Use code search and static/runtime evidence before recording relationships.
- Do not build a graph for tiny repositories.
- Stale graph edges must be marked or regenerated after structural changes.
- The graph assists navigation; source code remains authoritative.
