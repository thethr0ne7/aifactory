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

## Windows bootstrap

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

After review, explicitly allow system changes:

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

## Runtime health check

If `agent-reach` is already on `PATH`:

```powershell
node .\scripts\agent-reach-doctor.mjs
```

If it lives in the dedicated venv:

```powershell
$env:AGENT_REACH_BIN = "$env:USERPROFILE\.agent-reach-venv\Scripts\agent-reach.exe"
node .\scripts\agent-reach-doctor.mjs
```

The wrapper redacts fields whose names look like tokens, cookies, secrets, passwords, proxies or authorization data before emitting the doctor payload.

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
- the dedicated venv;
- exported cookies;
- browser sessions;
- API keys or tokens.

Credential/session-backed channels remain local and opt-in.
