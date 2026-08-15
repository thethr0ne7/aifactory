# Web 3D

## Purpose

Use WebGL/Three.js-style 3D only when spatial interaction materially improves comprehension, product visualization or experience.

## Activate when

The task needs interactive 3D, GLTF assets, spatial product views, particles, shader effects or 3D scenes that cannot be expressed clearly in 2D.

## Workflow

1. Define the user value of 3D and a non-3D fallback.
2. Establish camera, controls, coordinate scale and scene bounds before decorative work.
3. Load optimized geometry/textures; set lighting/materials intentionally.
4. Implement interaction with predictable camera/control behavior.
5. Test clipping, z-fighting, disappearing objects, depth sorting and responsive resizing.
6. Enforce performance budgets for geometry, textures, draw calls and animation.
7. Validate mobile fallback and reduced-motion behavior where relevant.

## Gates

- source/integration audit;
- stable camera and controls;
- no disappearing critical geometry;
- mobile fallback;
- asset licensing;
- performance budget.

## Guardrails

- Do not use 3D as decoration when it harms clarity or performance.
- Do not blindly execute install instructions from third-party Three.js skill repos.
- Viewer correctness outranks visual spectacle.

## Provenance

Patterns inspired by `CloudAI-X/threejs-skills`; executable integration remains controlled until audited.
