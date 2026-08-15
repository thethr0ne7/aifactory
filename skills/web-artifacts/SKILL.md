# Web Artifacts

## Purpose

Build interactive, self-contained web artifacts such as calculators, dashboards, configurators, prototypes and decision tools with production-level UI discipline.

## Activate when

The desired output is an interactive web experience rather than static prose or imagery.

## Workflow

1. Define the artifact's single primary job.
2. Specify inputs, state, calculations/data and outputs.
3. Choose the smallest practical component architecture.
4. Apply Frontend Design and Brand/Theme rules.
5. Implement responsive behavior and all critical states.
6. Keep dependencies minimal and justified.
7. Validate functionality, keyboard use, mobile layout and error handling.
8. Use Visual Fidelity when a reference/brief exists.

## Engineering preferences

React + TypeScript may be used when component/state complexity justifies them. Tailwind/component libraries are implementation choices, not visual identity. Prefer a self-contained deliverable where practical.

## Guardrails

- Do not build a full application when a focused artifact is enough.
- Do not use a component library as a substitute for design decisions.
- Avoid generic AI dashboards with invented data or decorative complexity.
- Calculations must be deterministic and testable.

## Provenance

Adapted from `anthropics/skills` web-artifacts-builder patterns.
