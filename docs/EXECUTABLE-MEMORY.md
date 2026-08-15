# Executable Memory

AI Factory memory becomes executable when durable lessons and incidents are not only stored, but are deterministically selected, injected into the next relevant run, and traced as part of that run's evidence.

## Runtime path

```text
SUPABASE af_lessons + af_incidents
        ↓
OIDC broker learning_context
        ↓
deterministic relevance selector
        ↓
LEARNING_CONTEXT_LOADED
        ↓
Copilot worker prompt
        ↓
decision / routing / evidence
        ↓
LEARNING_CONTEXT_APPLIED
        ↓
run output stores loaded + used memory refs
```

## Authority model

Memory does not have one trust level.

- `PROMOTED` lesson: active learned guidance, still subordinate to Root of Trust, negative actions, security boundaries and stronger current evidence.
- `CANDIDATE` lesson: hypothesis only. It may suggest a check, experiment or regression case, but is not policy or fact.
- `SUPERSEDED` lesson: inactive history. It can warn against reintroducing an old behavior but cannot reactivate itself.
- incident: historical failure evidence. Severity may increase caution, but an incident is not a policy by itself.

Current task evidence outranks historical memory when they conflict. The worker must surface the contradiction instead of silently choosing memory.

## Selection and context budget

The Supabase broker exposes only bounded recent memory to the authenticated `main` worker. The worker then applies deterministic relevance selection using task/objective token overlap, lesson status, incident severity and recency.

Default worker budget:

- at most 8 lessons;
- at most 6 incidents;
- at most 18,000 serialized characters;
- duplicate lesson statements removed;
- irrelevant non-promoted candidates excluded.

This prevents the memory layer from becoming an unbounded prompt dump.

## Traceability

Every run records two distinct events:

1. `LEARNING_CONTEXT_LOADED` — which durable lesson/incident IDs were injected.
2. `LEARNING_CONTEXT_APPLIED` — which injected IDs the model reported as materially influencing the result.

The terminal result also stores `memory.loaded_lessons`, `memory.loaded_incidents`, and `memory.used_refs`.

A model cannot invent a valid memory reference: returned `memory_refs` are filtered against the IDs actually injected into that run.

## Safety boundary

Executable memory is read-only at A3. It may influence reasoning, routing, evidence checks, incident creation and lesson generation. It may not by itself authorize:

- repository mutation;
- production writes;
- security weakening;
- Root of Trust changes;
- CATASTROPHIC control changes;
- autonomy-level escalation;
- promotion of its own lesson candidates.

Promotion remains a separate A4+ Controlled Self-Improvement concern with baseline comparison, regression evaluation and rollback.

## Failure semantics

If memory retrieval fails, the hosted run fails visibly rather than silently pretending to have learned context. The incident trace includes the memory references that had already been loaded, if any.

If no relevant memory exists, execution continues normally and records an empty memory selection.

## Acceptance proof

Executable memory is considered operational only when a hosted run demonstrates all of the following:

- a prior durable lesson/incident is selected for a later relevant task;
- `LEARNING_CONTEXT_LOADED` contains the selected source IDs;
- the model returns at least one valid `memory_refs` ID when the memory materially affects the decision;
- `LEARNING_CONTEXT_APPLIED` records that use;
- the terminal run result preserves loaded and used refs;
- candidate memory remains non-binding and does not override Constitution/evidence.
