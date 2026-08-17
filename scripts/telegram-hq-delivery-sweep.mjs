#!/usr/bin/env node

const audience = 'aifactory-supabase-runtime';
const url = process.env.FACTORY_TELEGRAM_HQ_URL || 'https://hgivyjjethjwswjrvroy.supabase.co/functions/v1/ai-factory-telegram-hq';

try {
  const token = await getOidcToken(audience);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'deliver_pending', limit: 20 }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Telegram HQ delivery sweep failed: ${response.status} ${text.slice(0, 1000)}`);
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch {}
  console.log(`AI Factory Telegram HQ: delivery sweep scanned=${body.scanned ?? 0}`);
  for (const item of Array.isArray(body.results) ? body.results : []) {
    console.log(`AI Factory Telegram HQ: update=${item.update_id} state=${item.state}${item.posts != null ? ` posts=${item.posts}` : ''}`);
  }
} catch (error) {
  // Delivery is a side channel. The durable QUEUED ledger keeps messages retryable;
  // do not corrupt the already-terminal Factory run if Telegram itself is unavailable.
  console.error(`AI Factory Telegram HQ delivery warning: ${safeError(error)}`);
  process.exitCode = 1;
}

async function getOidcToken(aud) {
  const base = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const token = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!base || !token) throw new Error('GitHub OIDC environment unavailable; id-token: write is required');
  const oidcUrl = new URL(base);
  oidcUrl.searchParams.set('audience', aud);
  const response = await fetch(oidcUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`OIDC token request failed: ${response.status}`);
  const body = await response.json();
  if (!body.value) throw new Error('OIDC token response missing value');
  return body.value;
}

function safeError(error) {
  return error instanceof Error ? error.message : String(error ?? 'unknown_error');
}
