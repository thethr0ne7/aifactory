# Agent Runtime Kernel

## Purpose

Use this capability when AI Factory needs a bounded interactive or autonomous agent turn with explicit session state, context budgeting, provider separation and controlled tool requests.

This skill is a **Factory-native clean-room implementation**. It does not vendor or reproduce code or prompt text from the upstream leak archive referenced in `registry/upstreams/austin1serb-anthropic-leaked-source-code.json`.

## Activate when

- building an agent/provider adapter;
- constructing a model turn from Factory policy + task + evidence + working context;
- coordinating tool-call candidates without granting the model execution authority;
- preserving explicit session/turn/tool outcome state;
- adding MCP/CLI/HTTP/provider transports behind existing Factory boundaries;
- reviewing whether an agent runtime is mixing policy, inference and side effects.

## Do not activate for

- ordinary one-shot research or writing tasks;
- UI design where no agent runtime is involved;
- direct tool execution without the controlled tool runtime;
- importing or reproducing vendor source code/system prompts;
- creating a second top-level capability router.

## Required contracts

Load and respect:

- `AGENTS.md`
- `registry/capabilities.json`
- `registry/autonomy-levels.json`
- `registry/tool-runtime.json`
- `registry/factory-constitution.json`
- `registry/negative-actions.json`
- `runtime/tool-runtime.mjs`
- `runtime/agent-runtime-kernel.mjs`

For third-party runtimes/protocols also use `third-party-security` and `root-of-trust`.

## Execution pattern

```text
QUALIFY TASK
→ CREATE/LOAD SESSION
→ SELECT MINIMUM CAPABILITIES
→ COMPILE BOUNDED CONTEXT
→ BUILD TURN
→ REQUEST PROVIDER INFERENCE
→ VALIDATE TOOL CANDIDATES
→ EXECUTE ONLY THROUGH CONTROLLED TOOL RUNTIME
→ RECORD TOOL OUTCOMES
→ VALIDATE RESULT
→ REPAIR OR COMPLETE
→ SAVE TRACE
```

## Context policy

Prefer this ordering:

1. policy/invariants;
2. durable decisions;
3. evidence;
4. current task/spec;
5. transient working material;
6. bounded tool results.

Do not let transient logs or giant tool payloads displace policy/evidence.

Character budgets in `agent-runtime-kernel.mjs` are deterministic runtime guards, not token-count claims. Provider adapters may add token-aware packing.

## Provider boundary

Provider adapters may:

- serialize context;
- call the selected model;
- parse model output/tool candidates;
- return inference metadata.

Provider adapters may not:

- directly mutate durable Factory state;
- grant tool permissions;
- bypass autonomy/risk gates;
- become the source of Factory policy;
- persist credentials in repository content.

## Tool boundary

All side effects must remain behind `runtime/tool-runtime.mjs` and the hosted controlled executor where applicable.

A tool candidate is only a request. Execution requires an existing registered tool, matching risk class, sufficient autonomy and any path/network/root-of-trust constraints.

## External protocols

MCP, CLI, HTTP, SSE, WebSocket and similar mechanisms are adapters. Treat them as transport/protocol surfaces, not trusted policy layers.

Before enabling a write-capable external protocol adapter:

- audit code/provenance/license;
- register exposed actions as controlled tools;
- bound filesystem/network/secrets access;
- define risk/autonomy requirements;
- cap result size;
- preserve audit trace;
- add conformance evals.

## Validation

Minimum deterministic eval:

```bash
node --test evals/runtime/agent-runtime-kernel.test.mjs
```

Ship only when relevant runtime/tool/security gates pass. If provider integration was not executed against a real provider, state that runtime-provider behavior is unverified rather than inferred.
