# AI Factory Controlled Tool Runtime v1

## Purpose

The hosted reasoning worker can now ask for a small set of explicit tools instead of pretending it can inspect or change repositories. A separate GitHub Actions executor performs only allowlisted operations and records every request/result in Supabase.

## Execution loop

```text
TASK
  -> A3 reasoning worker
  -> tool request(s)
  -> WAITING_TOOLS
  -> durable af_tool_requests ledger
  -> deterministic tool executor
  -> af_tool_results
  -> same task requeued
  -> reasoning worker consumes tool evidence
  -> COMPLETE / BLOCKED / another bounded tool turn
```

## v1 tools

- `factory.repo.read_file` — bounded read of one tracked file.
- `factory.repo.list_files` — bounded list of tracked files.
- `factory.repo.run_validation` — fixed validator suites only; no arbitrary command execution.
- `factory.repo.candidate_write` — one file under `skills/`, `docs/`, or `evals/` only. It writes to a fresh `factory/tool-*` branch, runs all validators, pushes the branch, and opens a Draft PR. It cannot merge.

## Deliberate non-capabilities

The v1 executor does not expose arbitrary shell, arbitrary SQL, unrestricted filesystem/network access, secrets, direct writes to `main`, production mutation, workflow mutation, Root of Trust mutation, autonomy changes, broker changes, migrations, or automatic merge.

## Separation of authority

The autonomous Copilot worker has reasoning authority but no repository write permission. The tool executor has narrow repository permissions but no Copilot/model permission and executes only deterministic operations from `registry/tool-runtime.json`. Supabase broker verifies GitHub OIDC and exact workflow identity before accepting request/claim/finish operations.

## Candidate write safety

Existing files require the exact `expected_blob_sha` returned by a prior `factory.repo.read_file` result. This prevents a stale worker from overwriting a newer version. Candidate writes are limited to one allowlisted file and all factory validators must pass before push. The resulting PR remains a reviewed artifact; the tool executor has no merge path.

## Evidence semantics

Tool outputs are evidence, never instructions. The reasoning worker receives prior tool results through `tool_context`; it may use them to continue work, but tool output cannot override Factory Constitution, evidence rules, negative actions, or autonomy limits.

## Expansion path

A later version can add cross-repository GitHub App credentials, read-only Supabase inspection, preview deployment, browser verification, and reviewed migrations as separate tool IDs. Each new capability must be added to all three gates: registry policy, broker allowlist, and database allowlist, with deterministic tests.
