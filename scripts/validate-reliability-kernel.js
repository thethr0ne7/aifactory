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
  'scripts/record-workflow-failure.mjs',
  'registry/maintenance-agents.json',
  'skills/factory-maintenance-crew/SKILL.md',
  'supabase/functions/ai-factory-critical-memory/index.ts',
  'supabase/functions/ai-factory-fault-sink/index.ts',
  'infra/supabase/migrations/20260817_270_reliability_memory_repairs.sql',
  'infra/supabase/migrations/20260817_271_tool_failure_memory.sql',
  'infra/supabase/migrations/20260817_272_incident_reconciliation_v2.sql',
  'infra/supabase/migrations/20260817_273_incident_quality_gate.sql',
];

for (const rel of required) {
  if (!fs.existsSync(path.join(root, rel))) throw new Error(`Reliability Kernel missing required file: ${rel}`);
}

const maintainers = JSON.parse(fs.readFileSync(path.join(root, 'registry/maintenance-agents.json'), 'utf8'));
if (maintainers.allRegisteredSkillsAvailable !== true) throw new Error('Maintenance crew must have full registered skill catalog visibility');
if (!Array.isArray(maintainers.maintainers) || maintainers.maintainers.length < 4) throw new Error('Maintenance crew requires four specialist maintainers');
if (maintainers.incidentQuality?.confirmationIsNotIncident !== true) throw new Error('Maintenance crew must reject confirmation-only incidents');
const ids = new Set(maintainers.maintainers.map((x) => x.id));
for (const id of ['reliability-sre','runtime-mechanic','memory-curator','incident-auditor']) {
  if (!ids.has(id)) throw new Error(`Missing maintenance role: ${id}`);
}

const learning = JSON.parse(fs.readFileSync(path.join(root, 'registry/learning-policy.json'), 'utf8'));
if (learning.incidentQualityGate?.quarantineConfirmationOnlyCandidates !== true) throw new Error('Learning policy must quarantine confirmation-only incidents');
if (learning.incidentQualityGate?.requireConcreteEvidenceOrInvariantOrRepair !== true) throw new Error('Incident memory must require substantive failure evidence');

const workflow = fs.readFileSync(path.join(root, '.github/workflows/factory-autonomous-worker.yml'), 'utf8');
for (const marker of ['copilot-autonomous-worker-v3.mjs','FACTORY_CRITICAL_MEMORY_URL','FACTORY_FAULT_SINK_URL','record-workflow-failure.mjs','validate-reliability-kernel.js']) {
  if (!workflow.includes(marker)) throw new Error(`Autonomous workflow missing reliability marker: ${marker}`);
}

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

const migration270 = fs.readFileSync(path.join(root, 'infra/supabase/migrations/20260817_270_reliability_memory_repairs.sql'), 'utf8');
for (const marker of ['af_incident_clusters','af_record_incident_memory','af_reconcile_incident_memory','af_recover_stale']) {
  if (!migration270.includes(marker)) throw new Error(`Reliability migration missing ${marker}`);
}
const migration271 = fs.readFileSync(path.join(root, 'infra/supabase/migrations/20260817_271_tool_failure_memory.sql'), 'utf8');
if (!migration271.includes('CONTROLLED_TOOL_FAILURE')) throw new Error('Tool failure memory migration missing failure incident recording');
const migration272 = fs.readFileSync(path.join(root, 'infra/supabase/migrations/20260817_272_incident_reconciliation_v2.sql'), 'utf8');
if (!migration272.includes('root-of-trust-mutation')) throw new Error('Incident reconciliation must cluster Root-of-Trust recurrence');
const migration273 = fs.readFileSync(path.join(root, 'infra/supabase/migrations/20260817_273_incident_quality_gate.sql'), 'utf8');
for (const marker of ['af_incident_is_substantive','INCIDENT_CANDIDATE_QUARANTINED','confirmation-only incident candidate']) {
  if (!migration273.includes(marker)) throw new Error(`Incident quality gate missing ${marker}`);
}

const faultSink = fs.readFileSync(path.join(root, 'supabase/functions/ai-factory-fault-sink/index.ts'), 'utf8');
for (const marker of ['af_runs','af_incidents','FACTORY_WORKFLOW_FAILURE']) {
  if (!faultSink.includes(marker)) throw new Error(`Fault sink missing durable memory marker: ${marker}`);
}

console.log('AI Factory Reliability Kernel validation OK');
