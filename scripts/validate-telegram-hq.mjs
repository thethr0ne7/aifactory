#!/usr/bin/env node

import fs from 'node:fs';

const requiredFiles = [
  'infra/supabase/migrations/20260818_280_telegram_factory_hq.sql',
  'supabase/functions/ai-factory-telegram-hq/index.ts',
  'scripts/telegram-hq-delivery-sweep.mjs',
];
for (const file of requiredFiles) {
  if (!fs.existsSync(file)) fail(`missing ${file}`);
}

const migration = fs.readFileSync(requiredFiles[0], 'utf8');
const gateway = fs.readFileSync(requiredFiles[1], 'utf8');
const sweep = fs.readFileSync(requiredFiles[2], 'utf8');

expect(migration.includes('af_telegram_workspaces'), 'workspace table missing');
expect(migration.includes('af_telegram_topics'), 'topic table missing');
expect(migration.includes('af_telegram_messages'), 'message ledger missing');
expect(migration.includes('delivered_post_count'), 'resumable delivery cursor missing');
expect(migration.includes('enable row level security'), 'RLS missing');

// Personal identifiers are runtime data and must not leak into the public repository.
expect(!migration.includes('8221984053'), 'owner Telegram ID leaked into migration');
expect(!migration.includes('-1004489517761'), 'private Telegram chat ID leaked into migration');

expect(gateway.includes('TELEGRAM_BOT_TOKEN'), 'bot token must come from Edge Function secret');
expect(gateway.includes('x-telegram-bot-api-secret-token'), 'Telegram webhook secret validation missing');
expect(gateway.includes('webhookSecret(BOT_TOKEN)'), 'deterministic webhook secret derivation missing');
expect(gateway.includes('owner_user_id'), 'owner allowlist enforcement missing');
expect(gateway.includes('af_enqueue_run'), 'Factory enqueue path missing');
expect(gateway.includes('23505'), 'idempotent Telegram update handling missing');
expect(gateway.includes('delivered_post_count'), 'partial-delivery resume missing');
expect(gateway.includes('authenticateGitHub'), 'outbound delivery GitHub OIDC authentication missing');
expect(gateway.includes('EXPECTED_REF = "refs/heads/main"'), 'main-only outbound authority missing');
expect(!/\d{8,}:AA[A-Za-z0-9_-]+/.test(gateway), 'Telegram bot token literal detected');

expect(sweep.includes("audience = 'aifactory-supabase-runtime'"), 'delivery sweep OIDC audience missing');
expect(sweep.includes("action: 'deliver_pending'"), 'delivery action missing');

console.log('Telegram HQ validation OK');

function expect(condition, message) {
  if (!condition) fail(message);
}
function fail(message) {
  console.error(`Telegram HQ validation failed: ${message}`);
  process.exit(1);
}
