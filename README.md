# AI Factory

AI Factory is the operating system for building, researching, designing, validating and shipping AI products with strong agents and bounded execution.

The repository is intentionally separate from product repositories such as `ai-platform-core`. Product repos contain product runtime and domain code; this repository contains reusable agent skills, routing, quality gates, provenance and factory operating rules.

## Core loop

`INPUT → QUALIFY → SPEC LOCK → STRATEGY SEARCH → PRODUCE → EVIDENCE CHECK → CONTRADICTION SCAN → RISK MAP → VALIDATE → REPAIR → SAVE → SHIP → TRACEBACK`

## Principles

- One capable agent with the right routed skills is preferred to an artificial multi-agent council.
- Context is a budget, not storage.
- Evidence outranks confident prose.
- Third-party skills are pattern sources until audited.
- Every reusable capability has activation rules, workflow, outputs, gates and provenance.
- Design work must pass mobile, accessibility, performance and visual-fidelity checks.
- Engineering work must reproduce failures, find root causes and run regression checks.
- High-cost decisions must preserve evidence and uncertainty labels.

## Repository map

- `AGENTS.md` — global operating contract for every agent working in this repository.
- `factory.manifest.json` — machine-readable factory version and modules.
- `registry/capabilities.json` — capability registry and source provenance.
- `skills/*/SKILL.md` — executable operating instructions for routed capabilities.
- `docs/ARCHITECTURE.md` — factory architecture and routing model.
- `docs/SOURCE-PROVENANCE.md` — upstream inspirations and adoption boundaries.

## Capability families

### Direction and reasoning
- Executive Router
- Context Governor
- Research & Truth
- Claim Checker

### Engineering
- Engineering Kernel
- Code Navigation
- Skill Foundry
- Third-Party Security Gate

### Design and media
- Design DNA
- Frontend Design
- Brand & Theme
- Web Artifacts
- Motion Director
- Web Animation
- Media / Video
- Web 3D
- Visual Fidelity

### Product growth
- Marketing Growth
- SEO / GEO

### Knowledge and data
- Knowledge OS
- Spreadsheet Adapter

## Third-party policy

A GitHub repository being useful or popular does not make it trusted runtime code. External projects are recorded with provenance and an adoption mode such as `core-pattern`, `adapted`, `controlled`, or `pattern-only`.

No external installer, hook, MCP server, browser automation, filesystem bridge or remote script is executed without explicit audit and a concrete product need.
