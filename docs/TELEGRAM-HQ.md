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
2. Seed the private workspace and topic IDs directly in Supabase; do not commit those identifiers.
3. Set Supabase Edge Function secret `TELEGRAM_BOT_TOKEN`.
4. Deploy `ai-factory-telegram-hq` with platform JWT verification disabled because it implements two custom authentication paths: Telegram secret header inbound and GitHub OIDC outbound.
5. Register the Telegram webhook with the derived secret token.
6. Send a test message in each registered topic and verify the durable path: Telegram update -> `af_telegram_messages` -> `af_runs` -> terminal result -> Telegram delivery.

Run `node scripts/validate-telegram-hq.mjs` before merge.
