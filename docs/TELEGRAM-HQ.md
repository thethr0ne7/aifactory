# Telegram AI Factory HQ

AI Factory HQ turns one private Telegram forum group into a bounded control room for the existing Factory runtime.

## Model

- Telegram is the human interface, not the source of truth.
- Supabase stores workspace/topic routing and the durable inbound/outbound ledger.
- Every accepted owner message becomes an `af_runs` run through `af_enqueue_run`.
- The existing Executive Router chooses the smallest sufficient set of registered agents and skills.
- GitHub Actions workers process the run with existing memory, evidence, incident and autonomy contracts.
- A delivery sweep posts terminal results back to the same Telegram topic.
- A Telegram outage does not erase the Factory result: unsent posts remain in the durable ledger and resume from `delivered_post_count`.

## Truth boundary

Telegram output is subject to layered checks:

1. The hosted worker normalizes agent attribution against the real activated-agent set.
2. The terminal runtime Truth Gate (`af_apply_runtime_truth_gate`) sanitizes `output.telegram_posts` before the task, run and terminal event are persisted.
3. The `trg_af_runs_telegram_agent_truth` trigger repeats the author check on `af_runs` as defense in depth.

A Telegram post is deliverable only when its `agent` is present in the same run's `activated_agents`. Invalid posts are dropped; they are never relabeled as another agent. The runtime Truth Gate also prevents a run from remaining `COMPLETE` while unresolved `BLOCKER` evidence is present.

## Security

The public repository contains no Telegram owner ID, private group ID, topic IDs or bot token.

The bot token is stored only as the Supabase Edge Function secret `TELEGRAM_BOT_TOKEN`. The webhook secret is derived as base64url(SHA-256(bot token)); it is never committed. Incoming Telegram webhook calls must carry that value in `X-Telegram-Bot-Api-Secret-Token`.

Outbound delivery is not publicly callable. It requires GitHub Actions OIDC for `thethr0ne7/aifactory`, `refs/heads/main`, and the autonomous-worker workflow.

Only the registered owner in the registered private workspace may enqueue Factory work.

## Topic routing

`telegram_thread_id` is normalized to `1` for Telegram's General topic when the incoming update omits `message_thread_id`.

Recommended room intents:

- General: Executive Router chooses the appropriate team.
- Factory Board: strategy, architecture and cross-functional decisions.
- Projects: product planning, task decomposition and project decisions.
- Development: architecture, implementation, review and CI work.
- Repair Room: reliability, incidents, root cause, memory and regression repair.
- Research: evidence collection, contradiction scans and research synthesis.

## Runtime cadence

The hosted autonomous worker polls every five minutes for the initial HQ version. This avoids introducing a long-lived public worker or a privileged GitHub API token into the Telegram gateway. A dedicated event-driven worker can replace polling later without changing the Telegram/Supabase contract.

## Required deployment steps

1. Apply `20260818_280_telegram_factory_hq.sql`.
2. Apply `20260818_281_telegram_agent_truth_guard.sql` and `20260818_282_runtime_truth_gate.sql`.
3. Seed the private workspace and topic IDs directly in Supabase; do not commit those identifiers.
4. Set Supabase Edge Function secret `TELEGRAM_BOT_TOKEN`.
5. Deploy `ai-factory-telegram-hq` with platform JWT verification disabled because it implements two custom authentication paths: Telegram secret header inbound and GitHub OIDC outbound.
6. Register the Telegram webhook with the derived secret token.
7. Send a test message in each registered topic and verify the durable path: Telegram update -> `af_telegram_messages` -> `af_runs` -> terminal Truth Gate -> terminal result -> Telegram delivery.

Run `node scripts/validate-workflow-contract.mjs`, `node scripts/test-runtime-truth-gate.mjs`, `node scripts/validate-telegram-hq.mjs`, and `node scripts/validate-telegram-agent-truth.mjs` before merge.
