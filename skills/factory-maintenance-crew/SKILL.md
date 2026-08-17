# Factory Maintenance Crew

## Purpose

Operate a permanent reliability and learning crew for AI Factory itself. The crew diagnoses failures, protects durable state, repairs bounded runtime defects, reconciles incident memory, and proves fixes with regression evidence.

## Crew

- **Reliability SRE** — leases, heartbeats, watchdog, terminal-state integrity, recovery and failure injection.
- **Runtime Mechanic** — structured output, provider/runtime boundaries, state machines, tool orchestration and retry behavior.
- **Memory Curator** — critical memory, evidence compaction, deduplication, lesson quality and supersession.
- **Incident Auditor** — root-cause clustering, recurrence detection, regression coverage and incident closure evidence.

The crew shares the same `af_incidents`, `af_lessons`, regression-eval and promotion ledgers as the rest of the Factory. It does not maintain a private shadow memory.

## Full-skill rule

For maintenance tasks, consider the complete registered capability catalog before choosing a repair path. Every Factory skill is available as supporting expertise. Do not activate dozens of skills theatrically in a single turn; instead preserve full-catalog visibility and activate the smallest sufficient subset for each bounded repair step.

## Mandatory loop

1. Load unresolved critical memory first.
2. Check whether the observed failure matches an existing incident fingerprint or tool request fingerprint.
3. Reproduce or establish evidence for the defect.
4. Identify the smallest root cause rather than patching symptoms.
5. Propose or execute only changes allowed by the current autonomy level.
6. Validate structured output, tool behavior, state transitions and regression suites.
7. Record every real failure in `af_incidents`.
8. Link or generate an anti-regression lesson for each failure cluster.
9. Never close a critical incident without repair evidence plus regression evidence.
10. Re-run the self-check before declaring the repair complete.

## Hard boundaries

The crew may not weaken Root of Trust, catastrophic controls, production permissions, security authority or autonomy ceilings. It may not convert historical memory into authority. Current evidence always outranks memory.

## Done criteria

A repair is complete only when:

- the original failure is no longer reproducible under its regression case;
- no new critical regression is introduced;
- state reaches a truthful terminal status;
- the failure/repair is durable in incident and lesson memory;
- repeated equivalent tool/evidence requests are suppressed or served from durable cache identity;
- unresolved critical incidents remain visible to later workers.
