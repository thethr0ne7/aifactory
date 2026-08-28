# Agent Reach integration

This directory documents the bounded AI Factory integration for
[`Panniantong/Agent-Reach`](https://github.com/Panniantong/Agent-Reach).

## Factory role

Agent Reach is registered as a **read-only internet research adapter**. It does not replace the Factory router and it is not a truth authority.

Factory routing:

`task → evidence gap → agent-reach-internet (optional) → external evidence → provenance/truth gates → synthesis`

The upstream package is currently pinned to:

- version: `1.5.0`
- commit: `06c202b03400a7d31886bf4399213706da1a0324`
- license: MIT

See `registry/upstreams/agent-reach.json` for the audit record.

## Default runtime: GitHub Actions

The Factory default is a hosted Linux runtime, not a Windows workstation.

Workflow:

`.github/workflows/agent-reach-hosted-runtime.yml`

The hosted probe:

1. runs on `ubuntu-latest`;
2. has `contents: read` only;
3. installs the audited Agent Reach commit;
4. verifies version `1.5.0`;
5. runs `agent-reach install --env=server --safe`;
6. executes `node scripts/agent-reach-doctor.mjs`;
7. validates the sanitized doctor evidence;
8. uploads the sanitized doctor report as a short-lived GitHub Actions artifact.

No credentials are required for the base hosted probe. Credential/session-backed channels remain opt-in and are not enabled by this workflow.

This workflow proves that the audited CLI can be installed and health-checked on an ephemeral hosted runner. It does not grant production write authority and it does not make external platform content trusted evidence.

## Runtime health check

On any host where `agent-reach` is already on `PATH`:

```bash
node scripts/agent-reach-doctor.mjs
```

The wrapper redacts fields whose names look like tokens, cookies, secrets, passwords, proxies or authorization data before emitting the doctor payload.

## Optional Windows bootstrap

Windows is an optional developer runtime only. It is useful when a channel genuinely needs a desktop browser/session or when local debugging is desired.

From the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\agent-reach-bootstrap.ps1
```

Default behavior:

1. creates `~/.agent-reach-venv`;
2. installs the audited Agent Reach commit into that venv;
3. runs Agent Reach in safe/check-only mode;
4. runs `doctor --json`.

It does **not** approve system/global dependency installation.

After explicit review, system changes can be allowed with:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\agent-reach-bootstrap.ps1 -AllowSystemChanges
```

Optional channels can be selected explicitly:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\agent-reach-bootstrap.ps1 `
  -AllowSystemChanges `
  -Channels "twitter,reddit,bilibili"
```

Do not use `all` unless the additional channels are actually needed.

## Default permissions

Allowed:

- public web search/read;
- public GitHub discovery;
- RSS/Atom read;
- YouTube/Bilibili subtitle/transcript discovery;
- read-only platform/community search;
- read-only market/community signal gathering.

Denied by Factory default:

- posting/publishing;
- comments/replies;
- likes/reactions/follows;
- direct messages;
- account mutation;
- purchases/transactions;
- automated login;
- silent browser-cookie extraction;
- system package installation without explicit user approval.

## Evidence rules

Platform output is `untrusted-external-evidence`.

For material claims record the platform, backend, query/URL, retrieval time and source URL/stable identifier when available. Prefer the original/primary source and pass consequential claims through the Factory research/provenance gates.

## Secrets

Never commit:

- `~/.agent-reach/`;
- dedicated virtual environments;
- exported cookies;
- browser sessions;
- API keys or tokens.

Credential/session-backed channels remain explicit and opt-in.
