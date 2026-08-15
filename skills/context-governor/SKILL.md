# Context Governor

## Purpose

Keep agent context relevant, compact and traceable across long tasks. Context is treated as a budget, not as permanent storage.

## Activate when

- the task spans many files, tools or phases;
- prior decisions/evidence matter;
- tool output is large;
- the conversation or workspace is noisy;
- a handoff between phases or agents is required.

## Workflow

1. Define the current objective and decision horizon.
2. Retrieve only state that can affect the next action.
3. Separate durable facts from transient observations.
4. Preserve exact identifiers for sources, files, commits, requirements and decisions.
5. Compress repetition into a verified checkpoint.
6. Mask or drop irrelevant tool output from later phases.
7. Record unresolved uncertainty as `UNKNOWN` or `BLOCKER` rather than carrying speculative text.
8. At handoff, produce a concise state packet: goal, verified state, decisions, open risks, next action.

## Degradation signals

Trigger compression when context shows repeated facts, contradictory stale state, duplicate tool logs, references with unclear provenance, or growing prompt size without new decision value.

## Output contract

A context checkpoint contains:

- objective;
- verified facts;
- active constraints;
- decisions already made;
- source/file identifiers;
- unresolved items;
- next action.

## Guardrails

- Never summarize away exact legal wording, citations, IDs or values that are decision-critical.
- Never treat a summary as stronger evidence than its source.
- Durable project memory belongs in explicit files/records, not only chat history.

## Provenance

Adapted from context-engineering patterns associated with `muratcankoylan/Agent-Skills-for-Context-Engineering`. Third-party executable code remains unaudited unless separately approved.
