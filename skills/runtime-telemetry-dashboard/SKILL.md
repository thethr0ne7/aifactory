# Runtime Telemetry Dashboard

## Purpose

Provide a human-readable operational view over measured runtime metrics without confusing dashboard presentation with source-of-truth telemetry.

Pattern source: `ZachJW34/cybermon`. The audited repository exposes a mobile dashboard over LibreHardwareMonitor HTTP data and has no root license file in the audit, so only the UI/interaction pattern is adopted.

## Factory adaptation

Potential telemetry:

- CPU/RAM/GPU/disk/network;
- worker health;
- queue depth;
- tool latency and failures;
- LLM latency/tokens/cost when actually measured;
- open incidents;
- run states and retry pressure.

Use `normalizeRuntimeTelemetry()` in `runtime/intelligence-routing.mjs`.

## Rules

- Only measured source metrics get `MEASURED` evidence class.
- Never infer performance numbers from static code or UI state.
- Do not expose local telemetry endpoints to the public Internet by default.
- Dashboard widgets are views, not authority.
- Every operational metric should answer a concrete operating/incident question.
