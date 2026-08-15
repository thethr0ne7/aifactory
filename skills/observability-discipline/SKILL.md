# Observability Discipline

## Purpose

Make production behavior answerable from evidence instead of source-code archaeology.

## Activate when

- shipping a production feature, service, endpoint, job, queue or external integration;
- adding retries, asynchronous work or cross-service calls;
- incidents cannot be diagnosed from existing telemetry;
- reliability or operating thresholds matter.

## Workflow

`QUESTIONS → SIGNAL DESIGN → INSTRUMENT → VERIFY TELEMETRY → OPERATE → LEARN`

1. Write 2–4 concrete questions an operator must be able to answer about the feature.
2. Choose the minimum useful signal for each question:
   - metric: that/how often/how slow in aggregate;
   - trace: where time/failure propagated across boundaries;
   - structured log: why a specific event happened.
3. Use stable event names, bounded labels and correlation/trace IDs across relevant async boundaries.
4. Never log secrets, tokens, credentials or unrestricted request/response bodies. Minimize/redact PII.
5. Prefer RED for request/dependency paths (Rate, Errors, Duration) and USE for resources where applicable (Utilization, Saturation, Errors).
6. Alert on symptoms tied to user/SLO impact. Cause metrics belong on dashboards unless they require immediate action.
7. Verify telemetry itself in staging/test: induce a known failure, locate it by correlation ID, confirm metrics/spans and test any new alert path.
8. Feed repeated operational failures into Repair, Architecture Review or Skill Foundry rather than adding endless logs.

## Evidence rules

- Static instrumentation code is `OBSERVED`; actual emitted telemetry from a run may be `MEASURED`/`OBSERVED` depending on the claim.
- Never report latency percentiles, Core Web Vitals, error rates or throughput as measured without an actual measurement artifact and scope.
- A dashboard with no question it answers is not observability evidence.

## Cardinality guardrail

Metric labels must come from bounded sets. Raw user IDs, emails, request IDs, full URLs and arbitrary error text belong in appropriately protected logs/traces, not metric dimensions.

## Output contract

`OPERATING QUESTIONS` · `SIGNALS` · `PRIVACY/SECURITY` · `VERIFICATION` · `ALERT/RUNBOOK` · `OPEN GAPS`

## Provenance

Locally normalized from `addyosmani/agent-skills` v0.6.7 `observability-and-instrumentation`, retaining question-first telemetry and RED/USE patterns while making thresholds project/SLO specific.
