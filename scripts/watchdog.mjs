#!/usr/bin/env node

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const staleRunMinutes = Number(process.env.FACTORY_STALE_RUN_MINUTES || 20);
const staleTaskMinutes = Number(process.env.FACTORY_STALE_TASK_MINUTES || 30);

if (!url || !key) {
  console.log('AI Factory watchdog: BLOCKED (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured)');
  process.exit(0);
}

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation'
};

function cutoff(minutes) {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

async function request(path, options = {}) {
  const response = await fetch(`${url}/rest/v1/${path}`, { headers, ...options });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${text}`);
  return text ? JSON.parse(text) : null;
}

const active = ['QUALIFYING','ROUTED','WORKING','VALIDATING','REPAIRING','LEARNING'];
const runFilter = encodeURIComponent(`(${active.join(',')})`);
const staleRuns = await request(`factory_runs?status=in.${runFilter}&heartbeat_at=lt.${encodeURIComponent(cutoff(staleRunMinutes))}&select=id,status,heartbeat_at&limit=100`);

for (const run of staleRuns || []) {
  await request(`factory_runs?id=eq.${run.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: 'BLOCKED',
      blocker: {
        kind: 'WATCHDOG_STALE_HEARTBEAT',
        previous_status: run.status,
        last_heartbeat_at: run.heartbeat_at,
        detected_at: new Date().toISOString()
      },
      updated_at: new Date().toISOString()
    })
  });

  await request('factory_events', {
    method: 'POST',
    body: JSON.stringify({
      run_id: run.id,
      event_type: 'RUN_BLOCKED',
      source: 'watchdog',
      evidence_class: 'MEASURED',
      payload: { reason: 'stale_heartbeat', previous_status: run.status },
      provenance: { detector: 'scripts/watchdog.mjs' }
    })
  });
}

const staleTasks = await request(`factory_tasks?status=eq.WORKING&locked_at=lt.${encodeURIComponent(cutoff(staleTaskMinutes))}&select=id,run_id,attempts,max_attempts,locked_by,locked_at&limit=100`);

for (const task of staleTasks || []) {
  const canRetry = task.attempts < task.max_attempts;
  const patch = canRetry
    ? { status: 'QUEUED', locked_at: null, locked_by: null, available_at: new Date().toISOString(), updated_at: new Date().toISOString() }
    : { status: 'FAILED', locked_at: null, locked_by: null, last_error: { kind: 'WATCHDOG_RETRY_EXHAUSTED', detected_at: new Date().toISOString() }, updated_at: new Date().toISOString() };

  await request(`factory_tasks?id=eq.${task.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
  await request('factory_events', {
    method: 'POST',
    body: JSON.stringify({
      run_id: task.run_id,
      task_id: task.id,
      event_type: 'WATCHDOG_RECOVERY',
      source: 'watchdog',
      evidence_class: 'MEASURED',
      payload: { action: canRetry ? 'requeue' : 'fail', attempts: task.attempts, max_attempts: task.max_attempts, previous_worker: task.locked_by },
      provenance: { detector: 'scripts/watchdog.mjs' }
    })
  });
}

console.log(`AI Factory watchdog OK: blocked ${staleRuns?.length || 0} stale runs; processed ${staleTasks?.length || 0} stale task locks`);
