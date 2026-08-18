# AI Factory runtime audit — 2026-08-18

## Scope

Telegram HQ ingress/delivery, Supabase durable runtime, GitHub Actions workers/tool executor, routing/agent activation, and repository/database drift.

## Confirmed findings

1. Telegram ingress is healthy; webhook handling is not the dominant latency source.
2. Telegram HQ uses one `TELEGRAM_BOT_TOKEN`, so all visible messages are sent by one Telegram bot. Agent names are role prefixes, not independent Telegram identities.
3. The hosted runtime is single-inference selective routing, not concurrent independent agents. The worker creates one model result containing `activated_agents`.
4. The normal worker contract caps active executive agents at 3; maintenance caps them at 4. This is policy/runtime behavior, not an outage.
5. Broker terminal transport previously truncated `activated_agents` to 3 even for maintenance. Broker source now allows 6 and the database terminal boundary independently reconciles only allowlisted agent IDs.
6. Interactive Telegram work previously had the same queue priority as internal self-audits. Older maintenance work could therefore starve newer user messages. Telegram tasks now enqueue at priority 10; background/default tasks stay at 100.
7. Tool execution itself is fast; queueing is the bottleneck. Measured historical tool execution was generally seconds while request-to-claim delays reached many minutes.
8. The original tool executor claimed one request per workflow and ran on a ten-minute schedule. It now uses a bounded batch of up to 6 requests, stops after candidate-write, and uses a five-minute fallback cadence.
9. Normal `WAITING_TOOLS -> QUEUED` continuation previously consumed task attempt budget and could strand a task at `attempts=max_attempts`. Continuation is now retry-budget neutral and stranded continuations are reconciled with durable evidence.
10. Recent Telegram processing was observed on push-triggered GitHub Actions runs rather than prompt event-driven wakeups. The worker schedule is normalized to `*/5`, but true chat-like latency still requires an authenticated event-driven wake mechanism from Telegram/Supabase to the hosted worker.
11. Unresolved FORBIDDEN/CATASTROPHIC incidents are always injected into executable memory. This protects anti-regression behavior but currently adds substantial governance context even to casual Telegram messages; it is a relevance/latency-quality debt, not the main queue-delay cause.
12. Production Supabase had moved ahead of GitHub main. Migrations and orchestration contracts in this repair branch restore the repository as the intended source of truth.

## Latency evidence observed during audit

Historical completed controlled tools showed approximately:

- average queue wait: 774 s;
- p50 queue wait: 81 s;
- p95 queue wait: 3341 s;
- maximum queue wait: 4943 s;
- average execution time: 0.9 s;
- p95 execution time: 2.8 s;
- maximum execution time: 3.2 s.

Conclusion: the tools were not slow; the scheduled/serialized orchestration path was slow.

Recent Telegram runs also showed claim waits around 10–25 minutes before model work began.

## Production repairs applied

- terminal Telegram author truth guard;
- terminal runtime Truth Gate;
- trace-correlated tool observability;
- retry-neutral tool continuation;
- interactive Telegram priority;
- terminal agent reconciliation.

## Repository repairs in this branch

- repo-owned orchestration workflow contract;
- trace/tool normalization contracts and tests;
- bounded batch tool executor;
- five-minute canonical worker/tool schedules;
- broker active-agent terminal limit aligned to 6;
- CI coverage for workflow, truth, observability and batch execution invariants.

## Remaining architectural limits

### Real-time wake

A five-minute GitHub Actions schedule is still polling. For near-real-time Telegram interaction, inbound Telegram must trigger an authenticated worker dispatch or a dedicated continuously available queue consumer. Do not reintroduce repository “wake commits”.

### True multi-agent execution

Current `activated_agents` are bounded roles in one inference. If independent agents must genuinely work concurrently, add durable per-agent child tasks/sessions, scoped evidence snapshots, parallel claims and an aggregator. Merely increasing the `activated_agents` array would be multi-agent theater and must not be represented as real parallel execution.

### Multiple Telegram sender identities

One bot token means one visible Telegram sender. Separate visible agent identities require separate Telegram bots/tokens; otherwise keep one Factory bot and render verified agent contributions inside its messages.
