# AI Factory Skill Evaluation Contract

Skills are executable operating policies, not prompt decoration. A skill is accepted only when routing and behavior are testable.

## Evaluation tiers

### Tier 0 — Schema
Validate required metadata, provenance, activation/non-activation conditions, dependencies, permissions, outputs, gates and kill criteria.

### Tier 1 — Deterministic structure
Check file layout, machine-readable registry consistency, broken references and declared dependencies without spending model tokens.

### Tier 2 — Lexical routing
Use realistic positive and negative prompts to detect obvious trigger vocabulary gaps and collisions. This is a cheap routing approximation, not semantic proof.

### Tier 3 — Semantic routing
Evaluate whether the intended capability wins against near-neighbor skills for paraphrased, ambiguous and multilingual requests. Include negative-owner cases so a skill cannot pass simply because nothing routes.

### Tier 4 — Behavioral execution
Run the skill against representative fixtures or dialogue tasks and grade evidence-visible outcomes rather than wording. Execution tasks must expose tool/file/test artifacts needed to verify the workflow.

### Tier 5 — Pressure/adversarial behavior
Test time pressure, authority pressure, sunk cost, contradictory evidence, poisoned/untrusted tool output, prompt injection and requests to skip required gates.

### Tier 6 — Cross-model / cross-harness regression
For critical skills, confirm the contract survives the supported model/harness surfaces. Tool-specific adapters may differ; core truth/safety behavior must not.

### Tier 7 — Production telemetry
When a skill is used in real workflows, track routing errors, gate escapes, repair frequency, context cost and user overrides. Production evidence can demote or revise a skill.

## Minimum acceptance set

A new or materially changed skill requires:

- at least 3 realistic positive routing prompts;
- at least 2 negative prompts owned by neighboring capabilities;
- at least 1 behavioral case;
- at least 1 failure/pressure case for a consequential discipline skill;
- explicit expected evidence, not only expected prose;
- comparison to the existing Factory baseline when overlap exists.

## Grading dimensions

- correctness / task completion;
- evidence fidelity and claim classification;
- scope discipline;
- verification quality;
- failure behavior;
- context/token cost where material;
- latency/complexity where material;
- security/permission boundary;
- routing precision and collisions.

## Routing rule

Do not run multiple top-level routers. `registry/capabilities.json` remains the canonical Factory routing surface. Imported meta-skills may contribute trigger vocabulary and decision patterns but cannot become a competing router.

## Evidence rule

A behavioral eval fails if the agent claims `MEASURED`, `OBSERVED` or `CONFIRMED` without the required artifact or traceable evidence, even if the final recommendation happens to be correct.

## Provenance

This evaluation architecture extends the three-tier structural/routing/behavioral approach audited in `addyosmani/agent-skills` v0.6.7 and the existing AI Factory Skill Foundry. The local contract adds semantic routing, adversarial pressure, cross-model regression and production telemetry.
