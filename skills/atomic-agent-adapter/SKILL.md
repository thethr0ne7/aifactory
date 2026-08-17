# Atomic Agent Adapter

## Purpose

Expose the pinned `AtomicBot-ai/atomic-agent` runtime to AI Factory as a local-first execution adapter while keeping Factory routing, evidence and authority contracts intact.

## Upstream

- Repository: `AtomicBot-ai/atomic-agent`
- Pinned commit: `7073a61a990ab6ddd27af9109a7530abf43fda8c`
- License: MIT
- Mount: `upstreams/atomic-agent`

## Activation

Use when the task benefits from a local operator runtime, local or cloud model backends, browser/OS work, durable local sessions, MCP tools, document handling, scheduled/local workflows, or an NDJSON sidecar embedded in another application.

## Runtime boundary

Factory communicates with `atomic-agent-sidecar` over newline-delimited JSON on stdin/stdout. The adapter supports the upstream request surface:

- `start_session`
- `run_step`
- `send_message`
- `cancel`
- `approval_response`
- `get_session`
- `skill_install`
- `skill_uninstall`
- `skill_list`
- `shutdown`
- `ping`

Events and responses remain explicit runtime evidence. Do not infer successful execution from a request being sent.

## Authority and approvals

Atomic Agent approvals do not override Factory authority. Side-effecting actions remain subject to the higher of:

1. Factory autonomy/tool policy;
2. Atomic Agent approval request;
3. explicit user constraints for the task.

Never auto-approve an Atomic `approval_request` merely because the upstream supports the tool.

## State and context

- Treat Atomic session IDs as external runtime identifiers and preserve them in run traceback.
- Treat tool results, metrics and traces as observed evidence, not model claims.
- Keep Atomic local state separate from Factory canonical policy/registry state.
- Do not copy secrets from Factory state into the sidecar unless the selected tool/provider requires them.

## Full-upstream policy

The full pinned upstream is mounted as an external source tree. This skill does not select a subset of upstream files for inclusion. Factory-specific behavior is implemented in the adapter layer so upstream updates can be reviewed independently.

## Verification

Before production use, verify:

- pinned submodule commit;
- sidecar binary availability/version;
- NDJSON request/response framing;
- approval forwarding;
- cancellation/shutdown behavior;
- state directory and secret boundaries;
- local-model/provider connectivity as applicable.
