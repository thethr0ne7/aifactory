# Clean-room agent runtime compatibility

## Status

AI Factory records the **full requested scope** of `Austin1serb/Anthropic-Leaked-Source-Code` by immutable repository, commit and tree in `registry/upstreams/austin1serb-anthropic-leaked-source-code.json`.

The upstream repository describes itself as leaked/reverse-engineered Claude Code source and does not expose a repository license. Its source and prompt text therefore are not reproduced inside AI Factory. This is an objective copying constraint, **not a judgment that only selected parts are useful**.

The local runtime below is an independent compatibility implementation. The listed interfaces describe what AI Factory implements locally; they do not narrow the recorded upstream scope.

## Local compatibility surfaces

1. **Query/session coordinator** — one bounded object owns the current goal, lifecycle and turn state.
2. **Explicit task/session history** — important state transitions and tool outcomes are durable artifacts rather than implicit model memory.
3. **Context assembly as a separate subsystem** — policy, decisions, evidence, task state, working material and tool results are layered and budgeted.
4. **Tool abstraction behind a gate** — a model may request tools, but execution authority remains in the Factory tool runtime and autonomy policy.
5. **Provider boundary** — provider/model/transport adapters perform inference or transport; they are not policy authorities and cannot directly mutate Factory state.
6. **External protocol adapters** — MCP-style or other remote/local tool protocols belong behind the same tool/runtime boundary.
7. **Transport separation** — CLI, HTTP, SSE, WebSocket or another transport is an adapter detail, not core agent policy.

No upstream implementation text or prompt text is required for the independent local implementation.

## Local implementation

`runtime/agent-runtime-kernel.mjs` implements the Factory-native compatibility layer.

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

The lifecycle is aligned with the existing durable autonomous runtime instead of creating a competing state machine.

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

This is not a claim that character count equals model tokens. It is a deterministic guardrail for the runtime layer; provider adapters may apply token-aware packing later.

### Tool requests

The kernel does not execute tools directly.

It passes requested calls through `runtime/tool-runtime.mjs`, which remains the authority for:

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

This keeps provider adapters replaceable without rewriting the Factory core.

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

MCP is one possible protocol adapter, not a trusted execution layer.

Before an MCP server can be used by a write-capable Factory run, its exposed actions still require:

- provenance/security review;
- explicit tool registration;
- autonomy/risk classification;
- path/network/secrets boundaries;
- result-size bounding;
- audit/traceback records.

An MCP server does not bypass `third-party-security`, `root-of-trust`, `negative-actions` or the controlled tool runtime.

## Prompt construction

AI Factory builds provider input from explicit local contracts rather than copying vendor system prompts.

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

Deterministic Node tests live in:

`evals/runtime/agent-runtime-kernel.test.mjs`

They cover:

- lifecycle transition enforcement;
- context-priority preservation under budget pressure;
- tool-policy enforcement through the existing Factory runtime;
- provider/transport authority boundaries;
- explicit tool-outcome history.

Run with:

```bash
node --test evals/runtime/agent-runtime-kernel.test.mjs
```

## Scope authority

When the user explicitly requests `all`, `everything`, a complete repository, an explicit file set, or an explicit destination, Factory agents must preserve that scope. They may identify blockers, risks and constraints, but may not silently reduce the scope based on their own usefulness ranking.

If part of the requested scope cannot be copied, executed or accessed, the task record must retain the original full scope and identify the blocked part separately.
