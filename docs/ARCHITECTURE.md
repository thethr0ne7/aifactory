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
CAPABILITY ROUTER
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

Do not load the whole factory. Determine the task class, activate the smallest complementary capability set, and keep irrelevant skills out of context.

Typical routes:

- product strategy → executive-router + research-truth + marketing-growth when needed;
- engineering → context-governor + code-navigation + engineering-kernel;
- visual product → design-dna + frontend-design + brand-theme + visual-fidelity;
- complex motion → motion-director + web-animation;
- programmatic video → motion-director + media-video;
- high-stakes research → research-truth + research-toolbelt + claim-checker;
- new external skill → third-party-security + skill-foundry;
- spreadsheet automation → spreadsheet-adapter + validation gate.

## Executive lenses

CEO, CFO, COO, CIO, CMO and CRO are policy lenses. They are activated only when their decision dimension matters. They must not become six permanent personas debating every task.

## Context architecture

The Context Governor maintains a bounded working set. Durable state is saved as explicit artifacts: decisions, evidence, registries, specs, postmortems, snapshots and reusable patterns. Raw transient tool output is not memory.

## Truth architecture

Evidence-bearing work separates:

- signal;
- observation;
- verified fact;
- requirement;
- eligibility;
- forecast;
- recommendation.

Every consequential claim should carry one of: `CONFIRMED`, `OBSERVED`, `ASSUMPTION`, `UNKNOWN`, `BLOCKER`.

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

## Skill lifecycle

```text
DISCOVER
  ↓
INSPECT
  ↓
LICENSE + SECURITY
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
```

Third-party source code is not automatically vendored. The default adaptation mode is to extract useful operating patterns and implement local bounded instructions.

## Multi-agent boundary

Parallel work is justified only by independent tasks or genuinely diverse evidence gathering. Default multi-agent councils, recursive delegation and voting are rejected because they increase cost, context noise and failure surface without guaranteeing better decisions.

## Ship contract

A result is `PASS`, `CONDITIONAL`, or `BLOCKED`.

`PASS` requires all relevant truth, security, test/build, provenance, UX, visual, accessibility and performance gates to pass. `CONDITIONAL` must name missing evidence or repairs. `BLOCKED` must name the exact blocker and the next resolvable action.
