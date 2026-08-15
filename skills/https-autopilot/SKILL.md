# HTTPS Autopilot

## Purpose

Ship HTTPS safely with explicit domain, certificate, secret and renewal checks instead of treating initial certificate issuance as complete deployment security.

## Activate when

A product is being deployed to a public domain or HTTPS/certificate automation changes.

## Deploy Safety flow

`APP READY → DOMAIN CHECK → CERT AUTOMATION → SECRET SCAN → RENEWAL TEST → HTTPS SHIP`

## Workflow

1. Confirm target domain ownership/configuration and DNS resolution.
2. Verify hosting/proxy target and redirect behavior.
3. Configure certificate automation through the platform/provider or a vetted ACME path.
4. Confirm certificate chain, hostname coverage and expiry.
5. Run secret scan before deployment.
6. Verify renewal mechanism, permissions and failure observability.
7. Test HTTP→HTTPS redirects and critical application routes.
8. Record the operational owner and recovery path.

## Guardrails

- Never expose private keys or ACME credentials in repository/logs.
- Do not add a custom certificate stack when the hosting platform already provides reliable managed TLS.
- Initial green HTTPS is not enough; renewal must be credible.

## Provenance

Factory amplifier influenced by ACME automation patterns such as `acme.sh`; executable tooling is selected per deployment environment.
