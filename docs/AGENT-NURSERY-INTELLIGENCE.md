# Agent Nursery + Intelligence Pack

## Goal

Extend AI Factory with a bounded agent-development lifecycle and a cheaper evidence intake/monitoring layer without replacing the existing router, Root of Trust, memory, incident system or production gates.

## Architecture

```text
Owner / Telegram HQ
        |
   AI Factory
        |
  +-----+------------------------------+
  |                                    |
Agent Nursery                      Intelligence Intake
  |                                    |
  |-- n8n orchestration                |-- PDF preflight/routing
  |-- candidate generations            |-- multi-source sweeps
  |-- training tasks                   |-- defensive OSINT gate
  |-- human approvals                  |-- runtime telemetry
  |                                    |
  +--> Opik traces/evals               +--> evidence/deltas
           |                                   |
           +--------------+--------------------+
                          |
                    Factory gates
                          |
              reject / repair / promote
```

## Authority model

n8n may coordinate workflows, candidate lifecycle steps, approvals and long-running waits. Opik may collect traces and evaluate experiments. Neither is allowed to become the authority for Factory policy or promotion.

The external boundary is intentionally asymmetric:

- external systems may produce execution results and evidence;
- Factory validates/normalizes that evidence;
- Factory owns agent registry, autonomy, memory and promotion state;
- Root of Trust remains outside the nursery.

## Agent candidate lifecycle

`DRAFT → SPAWNED → TRAINING → EVALUATING → CANDIDATE`

Then:

- `REPAIRING` when evidence is insufficient or regressions fail;
- `REJECTED` for a failed candidate that should not continue;
- `QUARANTINED` for security/authority violations;
- `PROMOTED` only after the Factory promotion gate and required human/owner authority.

`runtime/agent-nursery.mjs` normalizes candidates, generates bounded child candidates, builds experiment plans and assesses promotion eligibility. It never performs automatic promotion.

## n8n role

`runtime/external-eval-adapters.mjs` provides a transport-neutral n8n envelope. A live n8n instance URL/credential is intentionally not stored in the repository. When configured, n8n should expose bounded workflows for:

- spawn candidate;
- run training task;
- request evaluation;
- request human approval;
- resume after approval;
- quarantine candidate.

No workflow may change Root of Trust, raise its own autonomy ceiling or self-promote.

## Opik role

The same adapter module frames trace/evaluation envelopes and maps externally produced metrics into Factory evaluation dimensions while preserving evidence class.

Opik is an evaluation surface, not a promotion authority.

## PDF preflight

`runtime/intelligence-routing.mjs` adapts the Firecrawl PDF Inspector pattern:

- text PDFs → native extraction;
- scanned PDFs → OCR/vision;
- image PDFs → vision-first;
- mixed PDFs → per-page routing;
- unknown → inspect/fallback.

The classification decides extraction method only; it does not validate extracted claims.

## Intelligence sweeps

The Crucix pattern is adopted without copying AGPL implementation code:

`parallel sources → source health → normalization → temporal delta → reasoning only for changed evidence`

Every source keeps an identity, state, capture time and content fingerprint. Stale/failed sources must remain visible.

## Defensive OSINT

The Blackbird pattern is restricted to bounded defensive/authorized purposes. The current upstream audit found no root license file, so no source is vendored.

Private-person lookup without explicit authorization is blocked by the runtime gate except self-audit.

## Runtime telemetry

CyberMon contributes the dashboard/interaction pattern only. The Factory telemetry adapter normalizes measured metrics and flags public exposure of telemetry sources. The audited project depends on a LibreHardwareMonitor HTTP endpoint; the Factory does not assume that endpoint is safe to expose publicly.

## Provenance

Pinned upstream revisions and adoption decisions live in:

`registry/upstreams/agent-nursery-intelligence-pack.json`

## Validation

Run:

```bash
node scripts/validate-agent-nursery-intelligence.mjs
node --test evals/runtime/agent-nursery-intelligence.test.mjs
```

The normal Factory CI also runs the validator after this pack is merged.
