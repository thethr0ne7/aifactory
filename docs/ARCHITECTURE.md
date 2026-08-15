# AI Factory Architecture

## Objective

AI Factory is a reusable capability layer for building and operating products. It does not own product-specific business logic. It routes the minimum useful set of skills, executes bounded workflows, preserves evidence and applies quality gates before shipping.

## Runtime model

```text
INPUT
  ↓
QUALIFY
  ↓
CONTEXT GOVERNOR
  ↓
EXECUTIVE / INTENT ROUTER
  ↓
CAPABILITY ROUTER (single canonical routing surface)
  ↓
SPECIALIST SKILLS
  ↓
PRODUCE
  ↓
TRUTH / SECURITY / QUALITY GATES
  ↓
REPAIR
  ↓
SHIP
  ↓
TRACEBACK / LEARN
```

## Routing rule

Do not load the whole Factory. Determine the task class, activate the smallest complementary capability set, and keep irrelevant skills out of context.

There is one top-level routing authority: the Factory Executive/Intent Router plus `registry/capabilities.json`. Imported meta-skills may improve trigger vocabulary, but they must not create competing routers.

Typical routes:

- product strategy → executive-router + research-truth + marketing-growth when needed;
- engineering → context-governor + code-navigation + engineering-kernel;
- version-sensitive engineering → source-driven-development + engineering-kernel;
- debugging/regression → debugging-error-recovery + relevant verification gates;
- production operation → observability-discipline + quality-gates;
- visual product → design-dna + frontend-design + brand-theme + visual-fidelity;
- complex motion → motion-director + web-animation;
- programmatic video → motion-director + media-video;
- high-stakes research → research-truth + research-toolbelt + claim-checker;
- new external skill → third-party-security + skill-foundry;
- spreadsheet automation → spreadsheet-adapter + validation gate.

## Executive lenses

CEO, CFO, COO, CIO, CMO and CRO are bounded decision programs/lenses. Activate only the domains that materially affect the task. Do not create fictional councils or majority-vote decisions.

## Context architecture

The Context Governor maintains a bounded working set with separate layers for persistent policy, decision artifacts, primary evidence, derived working state, transient noise and untrusted external content.

Durable state is saved as explicit artifacts: decisions, evidence, registries, specs, postmortems, snapshots and reusable patterns. Raw transient tool output is not memory.

Progressive disclosure is preferred: keep routing metadata cheap and load full skills/references only when the current decision needs them.

## Evidence honesty architecture

`registry/evidence-contract.json` is the canonical claim-strength contract.

Consequential claims distinguish:

- `MEASURED` — instrument/test/query/benchmark result with method/artifact;
- `OBSERVED` — directly present in source/runtime/file/tool output;
- `CONFIRMED` — sufficiently supported for the decision scope;
- `DERIVED` — reproducibly computed from explicit inputs;
- `INFERRED` — reasoned but not directly observed;
- `ASSUMPTION` — temporary unverified premise;
- `UNKNOWN` — missing/unresolved evidence;
- `BLOCKER` — evidence gap/conflict prevents a safe decision.

Never upgrade a claim without new evidence. Static source inspection cannot become a runtime measurement by prose.

## Knowledge architecture

`registry/knowledge-classes.json` prevents imported advice from silently becoming hard policy.

Every imported rule can be classified as:

- `INVARIANT` — non-negotiable truth/safety/integrity rule;
- `POLICY` — chosen Factory/project operating rule;
- `HEURISTIC` — useful default/threshold that context may override;
- `VOLATILE_REFERENCE` — version-sensitive external fact/command/standard requiring current verification;
- `PATTERN` — technique to adapt to the actual system.

Numeric thresholds from third-party skills default to `HEURISTIC` unless tied to a current authoritative standard. Vendor/CLI setup guidance defaults to `VOLATILE_REFERENCE`.

## Current standards registry

`registry/standards.json` records the last verified baseline for external standards. The registry is a freshness pointer, not permission to assume standards never change.

Current audited baselines as of 2026-08-15 include WCAG 2.2 AA, OWASP Top 10 2025, OWASP LLM/GenAI Top 10 2025 and current Core Web Vitals thresholds.

## Truth architecture

Evidence-bearing work separates signal, observation, verified fact, requirement, eligibility, forecast and recommendation. Search snippets and model summaries cannot silently become primary evidence.

Version-sensitive technical work routes through Source-Driven Development: detect actual project version → verify current primary source → implement to repository reality → runtime/test verification → preserve traceback.

## Design architecture

```text
REFERENCE
  ↓
DESIGN DNA
  ↓
FRONTEND DESIGN
  ↓
BRAND / THEME
  ↓
IMPLEMENT
  ↓
MOTION (if needed)
  ↓
VISUAL FIDELITY
  ↓
MOBILE / ACCESSIBILITY / PERFORMANCE
  ↓
REPAIR
  ↓
SHIP
```

Accessibility and performance standards are verified through the standards registry/current authoritative sources; project-specific budgets remain policies/heuristics rather than universal facts.

## Skill lifecycle

```text
DISCOVER
  ↓
INSPECT
  ↓
LICENSE + SECURITY
  ↓
DECOMPOSE
  ↓
CLASSIFY
  ↓
EXTRACT PATTERNS
  ↓
NORMALIZE
  ↓
EVAL
  ↓
COMPARE
  ↓
APPROVE
  ↓
REGISTRY
  ↓
MONITOR
```

Third-party source code is not automatically vendored. The default adaptation mode is to pin an upstream snapshot, record an audit decision, extract useful operating patterns, normalize them against Factory contracts and implement local bounded instructions.

The audit of `addyosmani/agent-skills` v0.6.7 is recorded in `registry/upstreams/addyosmani-agent-skills.json`.

## Skill evaluation

`evals/README.md` defines the Factory evaluation ladder:

schema → deterministic structure → lexical routing → semantic routing → behavioral execution → pressure/adversarial → cross-model/harness → production telemetry.

A skill that produces fluent prose but escapes evidence/security/routing gates fails evaluation.

## Multi-agent boundary

Parallel work is justified only by independent tasks or genuinely diverse evidence gathering. Default multi-agent councils, recursive delegation and voting are rejected because they increase cost, context noise and failure surface without guaranteeing better decisions.

## Ship contract

A result is `PASS`, `CONDITIONAL`, or `BLOCKED`.

`PASS` requires all relevant truth, security, test/build, provenance, UX, visual, accessibility, performance and operational gates to pass. `CONDITIONAL` must name missing evidence or repairs. `BLOCKED` must name the exact blocker and the next resolvable action.
