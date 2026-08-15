# Defensive Security / Pre-Ship Safety

## Purpose

Apply defensive security checks before shipping code, integrations or deployments.

## Activate when

Work changes authentication, secrets, permissions, network exposure, deployment, third-party dependencies, file handling, user data or production infrastructure.

## Workflow

1. Identify assets, trust boundaries and exposed surfaces.
2. Check secrets handling and repository leakage.
3. Validate authn/authz and ownership boundaries.
4. Inspect input validation, file/path handling and dangerous execution paths.
5. Check dependency/integration risk and network exposure.
6. Verify least privilege for runtime credentials.
7. Confirm logs/errors do not leak sensitive data.
8. Run available defensive scanners/checks.
9. Record residual risks and ship decision.

## Guardrails

- Defensive use only; do not build offensive attack tooling as a factory feature.
- A scanner finding requires triage; absence of findings is not proof of security.
- Never commit secrets to make a demo work.
- Security-critical uncertainty blocks production shipment until resolved or explicitly accepted by authorized owner.
