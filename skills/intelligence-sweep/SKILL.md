# Intelligence Sweep

## Purpose

Run parallel, source-aware monitoring across many public/authorized sources, detect temporal deltas, and send only materially changed evidence into expensive reasoning.

Pattern source: `calesthio/Crucix`. Adoption is pattern-only because the audited upstream is AGPL-3.0.

## Flow

`source adapters → parallel sweep → source health → normalization → temporal delta → significance/research reasoning → alert/briefing`

Use `runtime/intelligence-routing.mjs` to normalize snapshots and compare sweeps.

## Rules

- A changed source is a signal, not a confirmed interpretation.
- Preserve source identity, captured time and content fingerprint.
- Surface stale, degraded and failed sources explicitly.
- Do not silently substitute stale fallback data.
- Corroborate consequential claims across independent evidence when possible.
- Keep polling/collection separate from policy decisions.
- Prefer cheap delta detection before expensive LLM analysis.

## Good fits

- government programs, grants and budgets;
- regulations and ministry guidance;
- product/provider changes;
- project dependency monitoring;
- other multi-source intelligence tasks with explicit scope.
