#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const required = [
  'runtime/structured-output.mjs',
  'runtime/tool-runtime.mjs',
  'runtime/executable-memory.mjs',
  'scripts/copilot-autonomous-worker-v2.mjs',
  'scripts/copilot-autonomous-worker-v3.mjs',
  'registry/maintenance-agents.json',
  'skills/factory-maintenance-crew/SKILL.md',
  'supabase/functions/ai-factory-critical-memory/index.ts',
  'infra/supabase/migrations/20260817_270_reliability_memory_repairs.sql',
  'infra/supabase/migrations/20260817_271_tool_failure_memory.sql',
];

for (const rel of required) {
  if (!fs.existsSync(path.join(root, rel))) throw new Error(`Reliability Kernel missing required file: ${rel}`);
}

const maintainers = JSON.parse(fs.readFileSync(path.join(root, 'registry/maintenance-agents.json'), 'utf8'));
if (maintainers.allRegisteredSkillsAvailable !== true) throw new Error('Maintenance crew must have full registered skill catalog visibility');
if (!Array.isArray(maintainers.maintainers) || maintainers.maintainers.length < 4) throw new Error('Maintenance crew requires four specialist maintainers');
const ids = new Set(maintainers.maintainers.map((x) => x.id));
for (const id of ['reliability-sre','runtime-mechanic','memory-curator','incident-auditor']) {
  if (!ids.has(id)) throw new Error(`Missing maintenance role: ${id}`);
}

const workflow = fs.readFileSync(path.join(root, '.github/workflows/factory-autonomous-worker.yml'), 'utf8');
if (!workflow.includes('copilot-autonomous-worker-v3.mjs')) throw new Error('Autonomous workflow is not using critical-memory preload worker v3');
if (!workflow.includes('FACTORY_CRITICAL_MEMORY_URL')) throw new Error('Autonomous workflow has no critical-memory endpoint');
if (!workflow.includes('validate-reliability-kernel.js')) throw new Error('Autonomous workflow does not validate Reliability Kernel');

const worker = fs.readFileSync(path.join(root, 'scripts/copilot-autonomous-worker-v2.mjs'), 'utf8');
for (const marker of ['STRUCTURED_OUTPUT_REPAIRED','known_request_fingerprints','critical_incident_ids','TERMINAL_FALLBACK_PENDING_WATCHDOG','startHeartbeat']) {
  if (!worker.includes(marker)) throw new Error(`Worker missing reliability marker: ${marker}`);
}

const preload = fs.readFileSync(path.join(root, 'scripts/copilot-autonomous-worker-v3.mjs'), 'utf8');
for (const marker of ['ai-factory-critical-memory','FACTORY_CRITICAL_MEMORY_FILE','critical_incidents']) {
  if (!preload.includes(marker)) throw new Error(`Critical memory preload missing marker: ${marker}`);
}

const memory = fs.readFileSync(path.join(root, 'runtime/executable-memory.mjs'), 'utf8');
for (const marker of ['critical_incidents','FACTORY_CRITICAL_MEMORY_FILE','MANDATORY_ANTI_REGRESSION_EVIDENCE']) {
  if (!memory.includes(marker)) throw new Error(`Executable memory missing critical-memory marker: ${marker}`);
}

const migration = fs.readFileSync(path.join(root, 'infra/supabase/migrations/20260817_270_reliability_memory_repairs.sql'), 'utf8');
for (const marker of ['af_incident_clusters','af_record_incident_memory','af_reconcile_incident_memory','af_recover_stale']) {
  if (!migration.includes(marker)) throw new Error(`Reliability migration missing ${marker}`);
}

console.log('AI Factory Reliability Kernel validation OK');
