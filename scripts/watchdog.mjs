#!/usr/bin/env node

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const staleRunMinutes = Math.max(5, Number(process.env.FACTORY_STALE_RUN_MINUTES || 5));
const staleToolMinutes = Math.max(5, Number(process.env.FACTORY_STALE_TOOL_MINUTES || 5));

if (!url || !key) {
  console.log('AI Factory watchdog: BLOCKED (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured)');
  process.exit(0);
}

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
};

async function rpc(name, body = {}) {
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${name} ${response.status} ${response.statusText}: ${text}`);
  return text ? JSON.parse(text) : null;
}

const runRecovery = await rpc('af_recover_stale', { p_stale_minutes: staleRunMinutes });
const toolRecovery = await rpc('af_recover_stale_tools', { p_stale_minutes: staleToolMinutes });
const memoryReconciliation = await rpc('af_reconcile_incident_memory', {});

console.log(`AI Factory watchdog OK: run_recovery=${JSON.stringify(runRecovery)} tool_recovery=${JSON.stringify(toolRecovery)} memory=${JSON.stringify(memoryReconciliation)}`);
