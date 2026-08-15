# Honest Capability Ledger

## Purpose

Keep a truthful machine/human-readable record of what the factory can actually execute, what is only documented, what is connected, and what is blocked.

## Activate when

Capabilities, tools, connectors, deployment claims or agent permissions are being described or changed.

## States

- `AVAILABLE` — executable now and verified.
- `CONNECTED_UNVERIFIED` — integration exists but task-specific execution has not been proven.
- `PATTERN_ONLY` — knowledge/pattern available; no executable integration.
- `PLANNED` — intended but not implemented.
- `BLOCKED` — required dependency/permission unavailable.
- `DEPRECATED` — retained only for compatibility/reference.

## Workflow

1. Identify the claimed capability.
2. Link it to its actual tool/module/skill and last verification evidence.
3. Record permissions and scope.
4. Downgrade stale or failed capabilities instead of retaining optimistic status.
5. Update the ledger after meaningful capability changes.

## Guardrails

- Never say the factory can perform an action solely because a skill describes how.
- Documentation and runtime capability are distinct.
- A connector's existence does not imply every API action is supported.
