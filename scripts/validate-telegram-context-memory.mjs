#!/usr/bin/env node
import fs from 'node:fs';

const errors = [];
const migration = fs.readFileSync('infra/supabase/migrations/20260818_288_telegram_thread_context.sql','utf8');
const critical = fs.readFileSync('supabase/functions/ai-factory-critical-memory/index.ts','utf8');
const policy = JSON.parse(fs.readFileSync('registry/executable-memory.json','utf8'));

for (const token of [
  "m.telegram_chat_id=v_chat_id",
  "m.telegram_thread_id=v_thread_id",
  "m.update_id < v_update_id",
  "limit 4",
  "'{telegram,thread_context}'",
  "telegram_thread_context_turns",
]) {
  if (!migration.toLowerCase().includes(token.toLowerCase())) errors.push(`thread-context migration missing invariant: ${token}`);
}

for (const token of [
  'af_incident_clusters',
  'canonical_incident_id',
  'canonical_clusters: true',
  'unrelated_read_only_block: false',
]) {
  if (!critical.includes(token)) errors.push(`critical-memory function missing cluster/scope invariant: ${token}`);
}

if (policy.selection?.criticalIncidentsUseCanonicalClusters !== true) errors.push('executable-memory policy must require canonical critical incident clusters');
if (!policy.executionRules?.some((rule) => String(rule).includes('not a reason to BLOCK unrelated read-only conversation'))) {
  errors.push('executable-memory policy must scope critical incidents away from unrelated read-only conversation');
}

if (errors.length) {
  console.error('Telegram context / critical-memory validation FAILED');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log('Telegram context / critical-memory validation OK: bounded same-thread context + canonical critical clusters + read-only scope');
