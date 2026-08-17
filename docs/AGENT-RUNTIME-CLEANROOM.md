# Clean-room agent runtime patterns

## Status

AI Factory does **not** vendor code or prompt text from `Austin1serb/Anthropic-Leaked-Source-Code`.

The upstream repository publicly describes itself as an archive of leaked/reverse-engineered Claude Code source and does not expose a repository license. The Factory therefore treats it as a **pattern-only architecture reference**. The audit decision is recorded in `registry/upstreams/austin1serb-anthropic-leaked-source-code.json`.

## What was extracted

Only generic architectural ideas that are independently useful for an agent runtime:

1. **Query/session coordinator** — one bounded object owns the current goal, lifecycle and turn state.
2. **Explicit task/session history** — important state transitions and tool outcomes are durable artifacts rather than implicit model memory.
3. **Context assembly as a separate subsystem** — policy, decisions, evidence, task state, working material and tool results are layered and budgeted.
4. **Tool abstraction behind a gate** — a model may request tools, but execution authority remains in the Factory tool runtime and autonomy policy.
5. **Provider boundary** — provider/model/transport adapters perform inference or transport; they are not policy authorities and cannot directly mutate Factory state.
6. **External protocol adapters** — MCP-style or other remote/local tool protocols belong behind the same tool/runtime boundary.
7. **Transport separation** — CLI, HTTP, SSE, WebSocket or another transport is an adapter detail, not core agent policy.

No upstream implementation details, source text, private prompts or internal identifiers are required for these patterns.

## Local implementation

`runtime/agent-runtime-kernel.mjs` implements the Factory-native version.

### Session lifecycle

```text
READY
  → QUALIFYING
  → ROUTED
  → WORKING
      ↔ WAITING_TOOLS
      ↔ REPAIRING
  → VALIDATING
  → COMPLETE

Any active state may end in BLOCKED or FAILED where explicitly allowed.
```

The lifecycle is intentionally aligned with the existing durable autonomous runtime instead of creating a competing state machine.

### Context layers

The kernel compiles context in this priority order:

```text
POLICY
DECISIONS
EVIDENCE
TASK
WORKING
TOOL RESULTS
```

The compiler applies a character budget and drops lower-priority excess instead of silently displacing policy/evidence with transient working context.

This is not a claim that character count equals model tokens. It is a deterministic guardrail for the runtime layer; provider adapters may apply their own token-aware packing later.

### Tool requests

The kernel does not execute tools.

It passes requested calls through `runtime/tool-runtime.mjs`, which remains the single authority for:

- allowlisted tools;
- minimum autonomy level;
- risk-class agreement;
- protected paths;
- bounded arguments/context;
- side-effect execution by controlled workers.

A model/provider can propose a tool call but cannot grant itself permission.

### Provider envelope

`providerRequestEnvelope()` produces a transport-neutral inference envelope with four invariants:

- provider cannot directly mutate Factory state;
- side effects require the tool runtime;
- credentials remain runtime secrets;
- transport cannot become policy authority.

This keeps OpenAI, Anthropic, local models, Copilot or future providers replaceable without rewriting the Factory core.

## Adapter architecture

```text
Factory policy + durable state
        ↓
Agent Runtime Kernel
        ↓
Provider Adapter ───────────────→ model/inference
        ↓
Tool request candidates
        ↓
Controlled Tool Runtime
        ↓
Protocol adapter (GitHub/MCP/HTTP/CLI/etc.)
        ↓
External system
        ↓
Bounded tool result
        └──────────────→ Agent Runtime Kernel
```

## MCP and external tool protocols

MCP is treated as one possible protocol adapter, not as a trusted execution layer.

Before an MCP server can be used by a write-capable Factory run, its exposed actions still require:

- provenance/security review;
- explicit tool registration;
- autonomy/risk classification;
- path/network/secrets boundaries;
- result-size bounding;
- audit/traceback records.

An MCP server does not bypass `third-party-security`, `root-of-trust`, `negative-actions` or the controlled tool runtime.

## Prompt construction

AI Factory should build provider input from explicit local contracts rather than copying vendor system prompts.

Recommended composition:

```text
Factory invariants/policy
→ task/spec lock
→ selected capability instructions
→ evidence and decisions
→ bounded working context
→ bounded tool outcomes
→ current user/task request
```

Provider-specific formatting belongs in adapters.

## Evaluation

The clean-room runtime has deterministic Node tests in:

`evals/runtime/agent-runtime-kernel.test.mjs`

The tests cover:

- lifecycle transition enforcement;
- context-priority preservation under budget pressure;
- tool-policy enforcement through the existing Factory runtime;
- provider/transport authority boundaries;
- explicit tool-outcome history.

Run with:

```bash
node --test evals/runtime/agent-runtime-kernel.test.mjs
```

## Non-goals

This integration deliberately does not add:

- copied Claude Code source;
- copied system prompts;
- a second top-level router;
- unrestricted shell execution;
- a second permission system competing with `tool-runtime.mjs`;
- a mandatory MCP dependency;
- recursive agent swarms;
- provider-specific business logic in the Factory core.

## Future extensions

Safe next extensions, if needed:

1. provider adapters implementing the envelope contract;
2. token-aware context packing on top of the deterministic character budget;
3. durable persistence of session events into existing Factory run/event stores;
4. protocol adapters registered as controlled tools;
5. provider conformance evals ensuring no adapter bypasses policy or side-effect gates.
