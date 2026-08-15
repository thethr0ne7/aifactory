# Skill Foundry

## Purpose

Create, adapt, evaluate and approve reusable agent skills without turning the Factory into an uncontrolled prompt collection or a stack of competing routers.

## Activate when

- a new external skill/repository is proposed;
- a repeated workflow should become reusable;
- an existing skill triggers poorly or produces inconsistent output;
- two skills overlap and need consolidation;
- an upstream skill pack or agent framework is being evaluated for Factory adoption.

## Lifecycle

`DISCOVER → INSPECT → LICENSE/SECURITY → DECOMPOSE → CLASSIFY → EXTRACT → NORMALIZE → EVAL → COMPARE → APPROVE → REGISTRY → MONITOR`

## Required skill contract

Every accepted skill must define:

1. purpose;
2. activation conditions;
3. non-activation conditions where ambiguity is likely;
4. inputs;
5. workflow;
6. outputs;
7. quality/evidence gates;
8. failure/kill criteria;
9. permissions/external dependencies;
10. provenance and upstream snapshot/version when derived;
11. neighboring capabilities/routing collision risks;
12. knowledge classification for imported rules.

## Knowledge normalization

Classify imported guidance using `registry/knowledge-classes.json` before it becomes Factory policy:

- `INVARIANT` — non-negotiable truth/safety/integrity rule;
- `POLICY` — chosen Factory/project operating rule;
- `HEURISTIC` — useful default or warning threshold, overridable by context/evidence;
- `VOLATILE_REFERENCE` — version-sensitive external fact/command/product surface requiring current authoritative verification;
- `PATTERN` — reusable technique to adapt to the actual stack.

Numeric limits from third parties default to `HEURISTIC` unless they are explicitly anchored to a current external standard. Vendor/tool setup instructions default to `VOLATILE_REFERENCE`.

## Router rule

AI Factory has one canonical capability routing surface: `registry/capabilities.json` plus the Executive/Intent Router. Imported meta-skills may contribute trigger vocabulary and decision patterns but must not become a second top-level router.

## Evaluation

Follow `evals/README.md`.

At minimum, create representative positive, negative-owner and behavioral tasks. For consequential discipline skills include a pressure/failure case. Compare the candidate against the current Factory baseline on:

- correctness/task completion;
- evidence fidelity;
- routing precision/collisions;
- scope discipline;
- verification quality;
- context cost and unnecessary ceremony;
- latency/complexity where material;
- security/permission boundary;
- failure behavior.

Approve only if the skill adds measurable capability or materially improves reliability. Merge or reject duplicate skills that merely restate existing instructions.

## External package intake

For an upstream collection:

1. pin repository + version/commit + license + audit date;
2. classify every candidate capability as `ADOPT`, `ADAPT`, `REFERENCE`, `UPDATE`, `REJECT` or equivalent;
3. keep an upstream audit registry so future updates can be diffed rather than re-reviewed from zero;
4. vendor executable code only when there is a concrete need and security approval;
5. prefer local normalized skills/policies over blind prompt copying.

## Security handoff

Any skill that requests installers, hooks, shell commands, network listeners, browser automation, MCP servers, secrets or broad filesystem access must pass `third-party-security` before executable adoption.

A documentation-only pattern audit does not grant executable trust.

## Registry states

- `core` — first-party canonical capability;
- `core-adapted` — local capability derived from audited upstream patterns;
- `core-selective` — trusted but only loaded for matching tasks;
- `controlled` — useful, but executable integration requires strict boundaries;
- `pattern-only` — conceptual donor; no executable trust;
- `idea-extract` — architecture idea only.

## Kill criteria

Reject or consolidate when a candidate:

- creates a competing global router;
- duplicates an existing capability without measurable improvement;
- turns heuristics into hard gates without evidence;
- embeds volatile vendor facts as timeless policy;
- requires broad permissions disproportionate to its benefit;
- cannot be behaviorally evaluated;
- encourages unbounded multi-agent recursion or autonomous self-rewriting.

## Provenance

Adapted from skill-creation/evaluation patterns in `anthropics/skills` skill-creator and extended with findings from the audit of `addyosmani/agent-skills` v0.6.7, with Factory-specific routing, evidence, security, volatility and governance constraints.
