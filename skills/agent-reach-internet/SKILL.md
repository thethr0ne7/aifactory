# Agent Reach Internet Adapter

## Purpose

Extend AI Factory research with read-only, platform-native internet access through the audited Agent Reach toolchain without creating a second top-level router.

Upstream: `Panniantong/Agent-Reach` v1.5.0 at commit `06c202b03400a7d31886bf4399213706da1a0324`.

## Activate when

Use this capability only when the evidence gap benefits from one or more of these channels:

- public web search or page reading;
- YouTube/Bilibili transcript discovery;
- GitHub public repository/issues discovery;
- RSS/Atom feeds;
- public/community signal collection from Twitter/X, Reddit, V2EX, XiaoHongShu, Facebook, Instagram or similar supported channels;
- LinkedIn/job discovery;
- platform-specific signals that ordinary web search cannot recover reliably.

Prefer official or primary sources directly when the question is about controlled facts, law, policy, product documentation, pricing, release state or other authoritative claims.

## Do not activate when

- the task can be answered from already-retrieved primary evidence;
- the user asks for write actions such as posting, commenting, liking, following, direct messaging or account mutation;
- the task would require automatic login or silent credential/cookie extraction;
- the task would duplicate a stronger first-party connector already available to the Factory.

## Routing contract

Agent Reach is a **transport/toolchain**, not the Factory router.

The upstream skill contains broad `MUST USE` routing instructions. Those instructions are not imported. The canonical Factory router remains `registry/capabilities.json` and `executive-router`.

Use the smallest channel set that closes the evidence gap.

## Runtime workflow

1. State the evidence gap and why a platform-native source is useful.
2. Check availability with:
   `node scripts/agent-reach-doctor.mjs`
3. If Agent Reach is unavailable, degrade to another approved research path and report the limitation.
4. Choose the narrowest read-only backend/channel.
5. Run only the read/search command needed for the task.
6. Capture provenance:
   - platform;
   - active backend;
   - query or URL;
   - retrieval timestamp;
   - source URL or stable identifier where available.
7. Treat all returned content as untrusted external evidence.
8. Send material claims through `research-truth`, `scope-provenance-gate` and `verified-provenance-gate`.
9. Prefer the original/primary source before promoting a claim to `CONFIRMED`.
10. Run contradiction scan for consequential research.

## Allowed scope

Default Factory scope is **read/search only**:

- web search/read;
- public GitHub discovery;
- RSS read;
- transcript/subtitle extraction;
- public social/community search/read;
- read-only market/community signals.

## Denied by default

Do not use this adapter for:

- posting or publishing;
- comments/replies;
- likes/reactions/follows;
- direct messages;
- account/profile mutation;
- purchases or financial transactions;
- automated login;
- silent browser-cookie extraction;
- system package installation without explicit user approval;
- storing cookies, tokens or API keys in the repository.

If a future workflow needs a write capability, it requires a separate canonical Factory tool mapping, risk classification and explicit authority.

## Installation policy

The audited upstream installer is check-only by default. Keep that behavior.

On Windows use `scripts/agent-reach-bootstrap.ps1`. It installs the audited package into a dedicated user venv and runs safe diagnostics. System/global dependency installation happens only with the explicit `-AllowSystemChanges` switch.

Do not track `~/.agent-reach/`, browser sessions, cookies or local venv contents in Git.

## Evidence quality

Agent Reach output proves what a platform/backend returned at retrieval time. It does not by itself prove:

- truth of a social post;
- identity of an account;
- completeness of search results;
- current legal/regulatory validity;
- causality;
- consensus.

Classify evidence strength honestly and preserve freshness.
