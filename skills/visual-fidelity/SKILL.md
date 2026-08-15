# Visual Fidelity Gate

## Purpose

Verify that implemented visual output actually matches the approved brief, reference or Design DNA instead of merely compiling successfully.

## Activate when

Any UI, landing page, visual artifact, redesign or reference-driven implementation is produced.

## Workflow

`REFERENCE/BRIEF → IMPLEMENT → RENDER/SCREENSHOT → COMPARE → DIAGNOSE → REPAIR → RECHECK`

Compare:

- layout and proportions;
- typography size/weight/line-height;
- color roles and contrast;
- spacing and alignment;
- component geometry;
- borders/shadows/effects;
- imagery and icon language;
- motion behavior;
- mobile behavior and overflow.

## Scoring

Score each relevant dimension as `PASS`, `MINOR`, `MAJOR`, or `NOT_VERIFIED`. A `MAJOR` mismatch blocks visual ship. `NOT_VERIFIED` must remain visible if rendering/inspection could not run.

## Repair rule

Fix the highest-impact structural mismatches before decorative details. Re-render after repair; do not assume a code change solved the visual problem.

## Guardrails

- Code similarity is not visual similarity.
- Desktop fidelity cannot compensate for broken mobile layout.
- Do not hide missing assets, broken states or clipping behind polished screenshots.
- Motion fidelity includes timing and purpose, not only presence of animation.
