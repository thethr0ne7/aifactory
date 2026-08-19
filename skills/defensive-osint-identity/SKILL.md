# Defensive OSINT Identity

## Purpose

Use public-source identity discovery only for bounded, legitimate defensive/research purposes.

Pattern source: `p1ngul1n0/blackbird`. The audited repository had no root `LICENSE` file, so this capability is pattern-only and must not vendor upstream code until licensing is resolved.

## Allowed purposes

- self-audit of the user's own public footprint;
- owned-asset inventory;
- authorized investigation;
- organization due diligence;
- public-entity research.

Use `gateDefensiveOsintRequest()` from `runtime/intelligence-routing.mjs` before any external lookup adapter is enabled.

## Prohibited scope

- stalking or persistent tracking of a private person;
- credential discovery/harvesting;
- doxxing;
- intrusive targeting without authorization;
- hidden mass-enrichment of private people.

## Evidence rules

- A username match is a candidate identity link, not proof of identity.
- Preserve which public service produced each match.
- Require corroboration before merging identities.
- Report false-positive risk explicitly.
