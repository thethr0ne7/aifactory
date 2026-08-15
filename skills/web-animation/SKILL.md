# Web Animation

## Purpose

Implement complex web motion reliably after Motion Director has defined the intended behavior.

## Activate when

The motion spec requires timelines, coordinated sequences, ScrollTrigger-like behavior, advanced transforms, text reveals, SVG choreography or interaction beyond simple CSS transitions.

## Workflow

1. Consume the motion specification; do not invent a different motion language during implementation.
2. Prefer CSS/Web Animations for simple cases; use GSAP when timeline/control complexity justifies it.
3. Scope selectors and animation ownership to the component.
4. Handle mount/unmount cleanup and repeated navigation.
5. Respect `prefers-reduced-motion`.
6. Test responsive layout, touch behavior, scroll restoration and animation interruption.
7. Profile long tasks, layout thrashing and excessive paint/compositing.

## Gates

- no animation memory leaks;
- cleanup on teardown;
- responsive behavior;
- reduced-motion path;
- no blocking of input/scroll;
- acceptable mobile performance.

## Guardrails

Avoid scroll hijacking, gratuitous parallax, excessive pinned sections and animations that move layout-critical elements unpredictably.

## Provenance

Adapted from implementation patterns in `greensock/gsap-skills`. GSAP is a selectable implementation dependency, not a mandatory factory dependency.
