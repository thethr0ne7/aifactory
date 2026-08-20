#!/usr/bin/env node

import fs from 'node:fs/promises';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const policy = JSON.parse(await fs.readFile('registry/maintenance-automations.json', 'utf8'));

if (!url || !key) {
  console.log('QUEUE_GUARDIAN_BLOCKED missing SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY');
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
  if (!response.ok) throw new Error(`${name} ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function countRows(table, filter) {
  const response = await fetch(`${url}/rest/v1/${table}?select=id&${filter}&limit=1`, {
    headers: { ...headers, Prefer: 'count=exact' },
  });
  if (!response.ok) throw new Error(`${table} count ${response.status}: ${await response.text()}`);
  const range = response.headers.get('content-range') || '';
  const total = Number(range.split('/')[1]);
  return Number.isFinite(total) ? total : 0;
}

async function oldestRow(table, filter, columns, orderColumn) {
  const response = await fetch(`${url}/rest/v1/${table}?select=${columns}&${filter}&order=${orderColumn}.asc&limit=1`, { headers });
  const text = await response.text();
  if (!response.ok) throw new Error(`${table} oldest ${response.status}: ${text}`);
  const rows = text ? JSON.parse(text) : [];
  return rows[0] || null;
}

function ageMinutes(timestamp) {
  if (!timestamp) return null;
  const ms = Date.now() - Date.parse(timestamp);
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 60000)) : null;
}

function level(backlog, age, thresholds) {
  if (backlog >= thresholds.criticalBacklog || (age != null && age >= thresholds.criticalOldestReadyMinutes)) return 'CRITICAL';
  if (backlog >= thresholds.warnBacklog || (age != null && age >= thresholds.warnOldestReadyMinutes)) return 'WARN';
  return 'OK';
}

const staleRunMinutes = Math.max(5, Number(process.env.FACTORY_STALE_RUN_MINUTES || 5));
const staleToolMinutes = Math.max(5, Number(process.env.FACTORY_STALE_TOOL_MINUTES || 5));

const [runRecovery, toolRecovery] = await Promise.all([
  rpc('af_recover_stale', { p_stale_minutes: staleRunMinutes }),
  rpc('af_recover_stale_tools', { p_stale_minutes: staleToolMinutes }),
]);

const [factoryCount, factoryOldest, ingestionCount, ingestionOldest, jobsCount, jobsOldest, deadLetterCount] = await Promise.all([
  countRows('af_tasks', 'status=eq.QUEUED'),
  oldestRow('af_tasks', 'status=eq.QUEUED', 'id,created_at', 'created_at'),
  countRows('ingestion_queue', 'status=eq.pending'),
  oldestRow('ingestion_queue', 'status=eq.pending', 'id,updated_at', 'updated_at'),
  countRows('ingestion_jobs', 'status=eq.queued'),
  oldestRow('ingestion_jobs', 'status=eq.queued', 'id,created_at', 'created_at'),
  countRows('gi_crawl_jobs', 'status=eq.dead_letter'),
]);

const factoryAge = ageMinutes(factoryOldest?.created_at);
const ingestionAge = ageMinutes(ingestionOldest?.updated_at);
const jobsAge = ageMinutes(jobsOldest?.created_at);

const snapshot = {
  checked_at: new Date().toISOString(),
  recovery: { stale_runs: runRecovery, stale_tools: toolRecovery },
  queues: {
    factory_tasks: {
      backlog: factoryCount,
      oldest_ready_minutes: factoryAge,
      level: level(factoryCount, factoryAge, policy.queueSloPolicy.factoryTasks),
    },
    ingestion_queue: {
      backlog: ingestionCount,
      oldest_ready_minutes: ingestionAge,
      level: level(ingestionCount, ingestionAge, policy.queueSloPolicy.ingestionQueue),
    },
    ingestion_jobs: {
      backlog: jobsCount,
      oldest_ready_minutes: jobsAge,
      level: level(jobsCount, jobsAge, policy.queueSloPolicy.ingestionJobs),
    },
    crawl_dead_letter: {
      backlog: deadLetterCount,
      level: deadLetterCount >= policy.queueSloPolicy.crawlJobs.criticalDeadLetter ? 'CRITICAL' : deadLetterCount >= policy.queueSloPolicy.crawlJobs.warnDeadLetter ? 'WARN' : 'OK',
    },
  },
  bounded_actions: {
    stale_work_reaped: true,
    queue_rows_deleted: false,
    automatic_agent_promotion: false,
    production_authority_expanded: false,
  },
};

for (const [name, q] of Object.entries(snapshot.queues)) {
  if (q.level === 'CRITICAL') console.log(`::warning title=Queue critical::${name} backlog=${q.backlog} oldest_ready_minutes=${q.oldest_ready_minutes ?? 'n/a'}`);
  else if (q.level === 'WARN') console.log(`::notice title=Queue warning::${name} backlog=${q.backlog} oldest_ready_minutes=${q.oldest_ready_minutes ?? 'n/a'}`);
}

console.log(`QUEUE_GUARDIAN_OK ${JSON.stringify(snapshot)}`);
