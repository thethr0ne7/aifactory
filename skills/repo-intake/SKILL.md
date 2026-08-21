# Repo Intake / Runability Gate

## Purpose

Understand an existing repository before changing it, prove the execution path when code will run, and prevent external repositories from becoming trusted Factory dependencies merely because they look useful.

## Activate when

- the task modifies an existing codebase or claims a repository is ready/runnable;
- an external repository, skill pack, agent harness, plugin, MCP server or automation is proposed for Factory adoption;
- a repository is being evaluated as a capability donor.

## Mode A — Existing product repository

1. Confirm repository identity, default branch and intended product.
2. Inspect top-level structure, package/build files, runtime entry points and documentation.
3. Identify generated/vendor/archive areas and protected paths.
4. Read current CI/workflow/build commands and environment requirements.
5. Locate relevant tests and product routes.
6. Run or inspect the narrowest credible runability checks available.
7. Record baseline failures before making changes.
8. Produce verified scope for Engineering Kernel.

## Mode B — External donor intake

Use this pipeline before importing anything executable:

`DISCOVER -> QUALIFY -> LICENSE CHECK -> SECURITY SCAN -> CAPABILITY EXTRACTION -> CLASSIFY -> COMPATIBILITY TEST -> SANDBOX -> EVALUATION -> PROMOTE`

### 1. Discover and pin

Record:

- repository URL and stable repository identity where available;
- default branch;
- exact audited commit SHA/tag;
- audit date;
- upstream license from the actual license file when material;
- upstream claims separately from observed Factory evidence.

Do not base durable adoption on a floating `main` branch.

### 2. Qualify expected value

State the capability gap the repository may fill. Reject intake that is only novelty, agent-count inflation, duplicate tooling, or architecture tourism.

### 3. Security scan before execution

Use `third-party-security` and inspect at minimum:

- install/post-install scripts;
- hooks and lifecycle commands;
- shell/command execution;
- MCP/tool definitions;
- permissions and credential scope;
- secret handling;
- network endpoints and remote downloads;
- browser/session access;
- generated automation;
- agent/prompt files that consume untrusted content.

First-pass intake is static inspection. Do **not** run the donor's installer, hooks, MCP servers, package scripts or background agents merely to learn what they do.

### 4. Extract capabilities, not branding

For every useful component classify it as exactly one primary use mode:

- `SERVICE` — useful as an isolated provider behind a canonical Factory adapter;
- `SKILL` — reusable workflow suitable for normalization into the Factory skill registry;
- `PATTERN` — architecture/algorithm/process idea to reimplement locally;
- `REJECT` — insufficient value, unacceptable risk, excessive overlap or context cost.

Then assign an adoption decision such as `TAKE`, `ADAPT`, `REFERENCE`, `SELECTIVE`, `CONTROLLED`, or `REJECT`.

### 5. Compatibility test

Compare against the current Factory before adding anything:

- existing capability overlap;
- router conflict;
- memory/context conflict;
- tool authority conflict;
- hook/event conflict;
- MCP duplication;
- autonomy expansion;
- dependency/runtime cost;
- Windows/GitHub Actions/Supabase/n8n compatibility where relevant.

Prefer strengthening an existing Factory skill over creating a duplicate.

### 6. Sandbox executable candidates

Executable adoption must be commit-pinned and isolated. Give it the minimum filesystem, network, secret and tool scope required for the evaluation. Never give a donor direct `main`, production credentials or Root-of-Trust authority during evaluation.

### 7. Evaluate

Compare the candidate against the current baseline on task success, evidence quality, regression behavior, context cost, latency/cost where relevant, security and downstream value.

A README claim is not an evaluation result.

### 8. Promote deliberately

Promotion levels:

`PATTERN_ONLY -> PROJECT_LOCAL -> CROSS_PROJECT_PROVEN -> FACTORY_WIDE`

Project-local success is not Factory-wide proof. Cross-project promotion requires independent repeated success plus the Compound Skill / controlled self-improvement gates.

## Intake record

Persist at least:

- `repository`
- `snapshot_commit`
- `capabilities`
- `license`
- `use_mode`
- `components`
- `skills`
- `agents`
- `hooks`
- `mcp`
- `security_risk`
- `context_cost`
- `dependencies`
- `factory_overlap`
- `adaptation_cost`
- `evaluation`
- `decision`

Keep volatile counts and marketing claims as snapshot facts, not quality scores.

## Gate

Return:

- `READY` — repository identity and required execution path are verified, or a donor has passed the required adoption gates for its approved scope;
- `CONDITIONAL` — repository is understood but an execution/security/evaluation requirement remains;
- `PATTERN_ONLY` — useful concepts may be normalized but upstream executable code is not approved;
- `BLOCKED` — wrong repo/source, incompatible license, unacceptable security/authority risk, missing required dependency or no credible execution path.

## Guardrails

- Never create a greenfield replacement when the task is to modify an existing repository unless explicitly authorized.
- Do not claim runtime verification from static inspection alone.
- Separate environment failure from product-code failure.
- Never bulk-install a skill/agent marketplace because its catalog is large.
- Never let an external repository define its own trust level.
- Never allow a scanner to bootstrap its own security approval: security tooling is itself third-party executable code until audited.
- Preserve license/provenance for adapted material.

## Provenance

The donor-intake extension incorporates useful repository-selection, project-scoped learning and agent-infrastructure security ideas audited from `affaan-m/ECC` at commit `d8409a4b0813771235555e32e3d8046a73988bfa`. Factory authority, promotion and evidence rules remain local and stricter than the upstream harness.
