# Knowledge OS

## Purpose

Store durable project knowledge in portable, inspectable records rather than relying on chat history.

## Activate when

A project needs persistent decisions, evidence, specs, postmortems, reusable patterns, tasks or brand knowledge.

## Canonical storage

Prefer Markdown, JSON and source snapshots. Obsidian-compatible structure may be used as a human interface, but the data must remain portable.

## Suggested structure

```text
knowledge/
  projects/
  decisions/
  evidence/
  research/
  patterns/
  postmortems/
  brand-dna/
  skills/
```

## Workflow

1. Decide whether the information is durable enough to save.
2. Save facts separately from interpretations.
3. Include provenance and dates for evidence-bearing records.
4. Link decisions to the evidence/spec that produced them.
5. Update or supersede stale records explicitly rather than silently overwriting history.
6. Keep ephemeral logs out of durable memory unless they explain a failure.

## Guardrails

- Chat transcript is not canonical memory.
- Do not store secrets in plain Markdown/JSON.
- Do not promote inferred user/project state to fact without approval/evidence.
- Search/index tools are interfaces; source records remain inspectable.

## Provenance

Adapted from portable knowledge-management patterns in `kepano/obsidian-skills` and the factory memory contour.
