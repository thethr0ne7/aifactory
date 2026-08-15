# Defensive Security / Pre-Ship Safety

## Purpose

Apply defensive security checks before shipping code, integrations or deployments.

## Activate when

Work changes authentication, secrets, permissions, network exposure, deployment, third-party dependencies, file handling, user data, agent/tool permissions or production infrastructure.

## Workflow

1. Identify assets, trust boundaries, exposed surfaces and abuse cases.
2. Check secrets handling and repository leakage.
3. Validate authentication, authorization, ownership and tenant boundaries.
4. Inspect input validation, output handling, file/path handling, SSRF and dangerous execution paths.
5. Check dependency/integration provenance, lifecycle scripts, supply-chain risk and network exposure.
6. Verify least privilege for runtime credentials, agents and tools.
7. Confirm logs/errors/telemetry do not leak secrets or excessive personal data.
8. For LLM/agent features, treat model/tool output as untrusted and enforce permissions in code rather than prompts.
9. Run available defensive scanners/checks and triage findings for reachability/context.
10. Record residual risks and ship decision.

## Current taxonomy baseline

When a formal checklist is needed, use current authoritative sources at review time. The Factory baseline as of the 2026-08-15 audit is:

- OWASP Top 10: 2025 for web application risk framing;
- OWASP Top 10 for LLM/GenAI Applications: 2025 for LLM/agent risk framing;
- project/framework/vendor security documentation for stack-specific controls.

The exact taxonomy/version is a `VOLATILE_REFERENCE`, not a timeless embedded law. Re-verify when the standard changes.

## Defensive focus areas

- access control and authentication;
- security misconfiguration;
- software supply-chain failures;
- cryptographic failures and secret handling;
- injection and unsafe output handling;
- insecure design and missing abuse-case thinking;
- software/data integrity;
- security logging/alerting failures;
- exceptional-condition/error handling;
- prompt injection, excessive agency, sensitive-information disclosure, unsafe tool output and unbounded consumption for AI systems.

## Guardrails

- Defensive use only; do not build offensive attack tooling as a Factory feature.
- A scanner finding requires triage; absence of findings is not proof of security.
- Never commit secrets to make a demo work.
- Never automatically execute dependency lifecycle scripts or forced audit remediation merely to achieve a green report.
- Security-critical uncertainty blocks production shipment until resolved or explicitly accepted by the authorized owner.
- Package-manager security defaults and CLI commands are `VOLATILE_REFERENCE`; verify against the pinned/current official documentation before relying on them.

## Output contract

`ASSETS/TRUST BOUNDARIES` · `FINDINGS` · `EVIDENCE` · `SEVERITY` · `MITIGATION` · `RESIDUAL RISK` · `PASS|CONDITIONAL|BLOCKED`
