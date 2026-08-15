# Motion Director

## Purpose

Define why, when and how interface motion should behave before selecting animation technology.

## Activate when

The experience needs entrance/exit motion, hover/focus feedback, scroll choreography, loading/success/error states, ambient motion or narrative transitions.

## Workflow

1. Identify the user's attention/action that motion should support.
2. Classify motion: feedback, continuity, hierarchy, orientation, delight or narrative.
3. Specify duration, delay, easing, sequencing and interruption behavior.
4. Choose implementation only after behavior is defined: CSS, GSAP, Lottie, Rive, Web Animations or other suitable technology.
5. Provide reduced-motion behavior.
6. Test on mobile and lower-performance devices.
7. Remove motion that adds latency, obscures information or competes with the primary action.

## Output contract

A motion specification contains:

- trigger;
- affected elements;
- intent;
- timing/easing;
- sequence/stagger;
- interrupt/reverse behavior;
- reduced-motion alternative;
- performance risk.

## Guardrails

- Motion is not decoration by default.
- Do not animate every component independently.
- Avoid long entrance sequences that delay access to content.
- Preserve input responsiveness and scroll control.

## Provenance

Adapted from motion-design patterns associated with `LottieFiles/motion-design-skill`.
