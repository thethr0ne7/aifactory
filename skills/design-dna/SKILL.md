# Design DNA

## Purpose

Reverse-engineer a visual reference into a structured design specification that can be reproduced consistently instead of imitated by vague aesthetic language.

## Activate when

A screenshot, website, image, brand reference or existing product should guide a new UI or visual system.

## Workflow

`REFERENCE → MEASURE → STRUCTURE → STYLE → EFFECTS → DNA SPEC → IMPLEMENTATION HANDOFF`

Extract:

- color roles and contrast hierarchy;
- typography families/roles, scale, weight and line-height;
- spacing rhythm, gutters, radii and density;
- layout grid, alignment and responsive behavior;
- component geometry and hierarchy;
- icon/illustration language;
- shadows, borders, textures, gradients and depth;
- motion/effects cues when visible;
- mobile behavior and likely breakpoint changes.

## Output contract

Produce a machine-readable or clearly structured `Design DNA` containing tokens, layout rules, component rules, visual language, motion cues, and explicit unknowns.

## Guardrails

- Do not copy protected logos/assets unless authorized.
- Distinguish measured observations from inferred behavior.
- Do not reduce a reference to colors alone.
- The DNA spec must be reusable across screens/components.

## Provenance

Adapted from design reverse-engineering patterns associated with `zanwei/design-dna`.
