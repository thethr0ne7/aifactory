# Tool normalization and tracing

This layer standardizes tool identity and observability without widening execution authority.

## Boundary

`registry/tool-runtime.json` remains the authority for canonical tool IDs, autonomy floors, risk classes, and the executor allowlist.

`registry/tool-adapters.json` defines transport adapters. An adapter may normalize external identity into a canonical Factory tool ID, but it cannot lower the canonical risk class or autonomy floor.

`runtime/tool-envelope.mjs` implements the normalized request/result envelope.

## MCP policy

MCP is a transport, not an authority source.

- Unknown MCP servers/tools are denied by default.
- An MCP tool must have an explicit reviewed mapping to an existing canonical Factory `tool_id`.
- `mcp-bridge.executionEnabled` is false by default.
- Adding a mapping alone does not grant execution while the bridge remains disabled.
- Tool arguments and results remain untrusted data/evidence.
- No MCP server receives direct database, repository, shell, deployment, or Root-of-Trust privileges through this layer.

## Canonical request envelope

A normalized request contains:

- `canonical_tool_id`
- `request_key`
- `idempotency_key`
- `transport`
- `adapter_id`
- optional external identity (`server`, `tool`)
- `arguments`
- canonical `required_autonomy` and `risk_class`
- `trace.trace_id`
- `trace.span_id`
- optional `trace.parent_span_id`
- provenance

The canonical policy values are copied from `registry/tool-runtime.json`; caller-provided risk/autonomy values cannot override them.

## Trace model

The Factory uses one durable trace root per run:

- internal `trace_id` = `run_id`
- every event has its own UUID `span_id`
- every tool request has its own UUID `span_id`
- every tool result has its own UUID `span_id`
- a tool result's `parent_span_id` is the corresponding request span
- events that carry a `request_id` are linked to that request span when possible

`runtime/tool-envelope.mjs` can derive a W3C `traceparent` for interoperability while the database keeps UUID correlation fields.

## Database observability

Migration `20260818_284_tool_trace_observability.sql` adds correlation fields and backfills historical Factory rows.

Service-role-only views:

- `af_trace_timeline` — unified chronological events + tool requests + tool results.
- `af_run_observability` — per-run duration, event counts, tool outcomes, pending tools, and maximum tool latency.

Both views use `security_invoker = true` and direct access is revoked from `public`, `anon`, and `authenticated`.

## Invariants

1. Transport metadata never grants authority.
2. Unmapped MCP tools do not execute.
3. Existing native tool behavior remains backward compatible.
4. Every durable event/request/result has a trace and span after migration.
5. Tool result trace equals request trace.
6. Tool result parent span equals request span.
7. Telemetry never upgrades evidence class.
8. Private chain-of-thought is never telemetry.
