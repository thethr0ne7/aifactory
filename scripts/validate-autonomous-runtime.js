#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = process.cwd();
const errors = [];

function readJson(rel) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) {
    errors.push(`missing file: ${rel}`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (error) {
    errors.push(`invalid JSON: ${rel}: ${error.message}`);
    return null;
  }
}

function exists(rel) {
  if (!fs.existsSync(path.join(root, rel))) errors.push(`missing required runtime artifact: ${rel}`);
}

const manifest = readJson('factory.manifest.json');
const capabilities = readJson('registry/capabilities.json');
const runtime = readJson('runtime/autonomous-runtime.json');
const constitution = readJson('registry/factory-constitution.json');
const autonomy = readJson('registry/autonomy-levels.json');
const negatives = readJson('registry/negative-actions.json');
const learning = readJson('registry/learning-policy.json');
const telemetry = readJson('registry/telemetry-policy.json');
const executableMemory = readJson('registry/executable-memory.json');
const providerEval = readJson('evals/runtime/provider-availability.json');

const expectedVersion = '2.4.0';
for (const [name, obj] of Object.entries({manifest, capabilities, runtime, constitution, autonomy, negatives, learning, telemetry, executableMemory})) {
  if (!obj) continue;
  const version = name === 'manifest' ? obj.version : obj.factoryVersion;
  if (version && version !== expectedVersion) errors.push(`${name} version mismatch: ${version} != ${expectedVersion}`);
}

exists('skills/autonomous-runtime/SKILL.md');
exists('skills/incident-learning/SKILL.md');
exists('skills/root-of-trust/SKILL.md');
exists('infra/supabase/migrations/20260815_240_autonomous_runtime.sql');
exists('infra/supabase/migrations/20260815_241_autonomous_runtime_hosted.sql');
exists('supabase/functions/ai-factory-broker/index.ts');
exists('runtime/executable-memory.mjs');
exists('scripts/test-executable-memory.mjs');
exists('registry/executable-memory.json');
exists('.github/workflows/factory-autonomous-worker.yml');
exists('evals/runtime/provider-availability.json');
exists('docs/AUTONOMOUS-RUNTIME.md');
exists('docs/EXECUTABLE-MEMORY.md');
if (manifest?.hostedWorkerScript) exists(manifest.hostedWorkerScript);

if (manifest) {
  if (manifest.hostedWorker !== '.github/workflows/factory-autonomous-worker.yml') errors.push('manifest hostedWorker mismatch');
  if (!manifest.hostedWorkerScript) errors.push('manifest hostedWorkerScript is required');
  if (manifest.hostedBroker !== 'supabase/functions/ai-factory-broker/index.ts') errors.push('manifest hostedBroker mismatch');
  if (manifest.hostedRuntimePersistence !== 'infra/supabase/migrations/20260815_241_autonomous_runtime_hosted.sql') errors.push('manifest hostedRuntimePersistence mismatch');
  if (manifest.hostedBrokerAudience !== 'aifactory-supabase-runtime') errors.push('manifest hostedBrokerAudience mismatch');
  if (!String(manifest.hostedInference || '').includes('Copilot CLI')) errors.push('hosted inference must use current Copilot CLI path');
  if (String(manifest.hostedInference || '').includes('GitHub Models')) errors.push('retired GitHub Models provider must not remain configured');
  if (manifest.contracts?.executableMemory !== 'registry/executable-memory.json') errors.push('manifest executable memory contract mismatch');
  if (manifest.executableMemoryRuntime !== 'runtime/executable-memory.mjs') errors.push('manifest executable memory runtime mismatch');
  if (!(manifest.executionLoops?.autonomous || []).includes('LOAD_MEMORY')) errors.push('autonomous execution loop must load memory before validation');
}

if (runtime) {
  const requiredStates = ['QUEUED','QUALIFYING','ROUTED','WORKING','VALIDATING','REPAIRING','LEARNING','COMPLETE','BLOCKED','FAILED'];
  const states = new Set([runtime.stateMachine?.initial,...(runtime.stateMachine?.active || []),...(runtime.stateMachine?.terminal || [])]);
  for (const state of requiredStates) if (!states.has(state)) errors.push(`runtime missing state: ${state}`);
  if (runtime.infrastructure?.workerDeploymentRequired !== true) errors.push('runtime must declare hosted worker deployment required');
  if (runtime.autonomy?.rootOfTrustDirectMutation !== false) errors.push('runtime must forbid direct Root of Trust mutation');
}

if (constitution) {
  const ids = new Set();
  for (const rule of constitution.rules || []) {
    if (!rule.id) errors.push('constitution rule missing id');
    if (ids.has(rule.id)) errors.push(`duplicate constitution rule: ${rule.id}`);
    ids.add(rule.id);
    if (rule.runtimeMutable !== false) errors.push(`constitution rule must not be runtime mutable: ${rule.id}`);
  }
  if (ids.size < 8) errors.push('constitution is unexpectedly small');
  if (constitution.changePath?.runtimeSelfApproval !== false) errors.push('constitution must forbid runtime self-approval');
}

if (autonomy) {
  const ids = new Set((autonomy.levels || []).map((level) => level.id));
  for (let i = 0; i <= 7; i += 1) if (!ids.has(`A${i}`)) errors.push(`autonomy level missing: A${i}`);
  if (autonomy.defaultLevel !== 'A3') errors.push('default autonomy level must be A3 for 2.4.0');
}

if (negatives) {
  const ids = new Set();
  const severities = new Set(['UNDESIRABLE','FORBIDDEN','CATASTROPHIC']);
  for (const rule of negatives.rules || []) {
    if (ids.has(rule.id)) errors.push(`duplicate negative action id: ${rule.id}`);
    ids.add(rule.id);
    if (!severities.has(rule.severity)) errors.push(`invalid negative action severity: ${rule.id}`);
    if (!rule.detector) errors.push(`negative action missing detector: ${rule.id}`);
  }
  if (!(negatives.rules || []).some((rule) => rule.severity === 'CATASTROPHIC')) errors.push('negative action registry must contain catastrophic controls');
  if (!ids.has('NA-009')) errors.push('negative action registry must include provider lifecycle/smoke control NA-009');
}

if (providerEval) {
  if (providerEval.negativeAction !== 'NA-009') errors.push('provider availability eval must bind NA-009');
  if (providerEval.acceptance?.mustRunLiveInferenceSmokeBeforeAutonomyClaim !== true) errors.push('provider eval must require live inference smoke');
  if (providerEval.acceptance?.mustNotClaimAutonomousCompleteWhenInferenceFails !== true) errors.push('provider eval must prevent false autonomous completion');
  if ((providerEval.cases || []).length < 5) errors.push('provider availability eval requires at least five cases');
}

if (learning) {
  if (learning.promotion?.rootOfTrustAutoPromotion !== false) errors.push('learning policy must forbid Root of Trust auto-promotion');
  if (learning.promotion?.requiresBaselineComparison !== true) errors.push('learning policy must require baseline comparison');
  if (learning.promotion?.requiresRegressionSuite !== true) errors.push('learning policy must require regression suite');
  if (learning.errorMemory?.recordEveryRealFailure !== true) errors.push('learning policy must record every real failure');
  if (learning.errorMemory?.criticalMemoryMayBeDroppedByRelevance !== false) errors.push('critical memory must not be relevance-droppable');
}

if (executableMemory) {
  if (executableMemory.mode !== 'executable-read-only') errors.push('executable memory must remain read-only at A3');
  if (executableMemory.sources?.lessons !== 'public.af_lessons') errors.push('executable memory lessons source mismatch');
  if (executableMemory.sources?.incidents !== 'public.af_incidents') errors.push('executable memory incidents source mismatch');
  if (executableMemory.promotionBoundary?.runtimeMayPromoteAtA3 !== false) errors.push('A3 executable memory must not self-promote lessons');
  if (executableMemory.promotionBoundary?.rootOfTrustAutoPromotion !== false) errors.push('memory must not auto-promote Root of Trust changes');
  if (executableMemory.telemetry?.loadEvent !== 'LEARNING_CONTEXT_LOADED') errors.push('memory load telemetry event mismatch');
  if (executableMemory.telemetry?.applyEvent !== 'LEARNING_CONTEXT_APPLIED') errors.push('memory apply telemetry event mismatch');
  if (!String(executableMemory.authority?.CANDIDATE || '').includes('hypothesis')) errors.push('candidate memory must be explicitly non-binding hypothesis');
}

if (telemetry) {
  const required = ['INCIDENT_OPENED','LESSON_CANDIDATE_CREATED','REGRESSION_EVAL_CREATED','RUN_COMPLETED','RUN_FAILED','RUN_BLOCKED'];
  const events = new Set(telemetry.eventTypes || []);
  for (const event of required) if (!events.has(event)) errors.push(`telemetry event missing: ${event}`);
  if (telemetry.rules?.secretRedactionRequired !== true) errors.push('telemetry must require secret redaction');
}

if (capabilities) {
  const ids = new Set((capabilities.capabilities || []).map((capability) => capability.id));
  for (const id of ['autonomous-runtime','incident-learning','root-of-trust']) if (!ids.has(id)) errors.push(`capabilities missing runtime capability: ${id}`);
}

const workflowPath = path.join(root, '.github/workflows/factory-autonomous-worker.yml');
if (fs.existsSync(workflowPath)) {
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  if (!workflow.includes('copilot-requests: write')) errors.push('autonomous worker must grant copilot-requests: write');
  if (!workflow.includes('npm install -g @github/copilot')) errors.push('autonomous worker must install current Copilot CLI');
  const selectedWorker = manifest?.hostedWorkerScript || '';
  if (!selectedWorker || !workflow.includes(`node ${selectedWorker}`)) errors.push('workflow must execute manifest-selected Copilot CLI worker');
  if (workflow.includes('models: read')) errors.push('retired GitHub Models permission must be removed');
}

const brokerPath = path.join(root, 'supabase/functions/ai-factory-broker/index.ts');
if (fs.existsSync(brokerPath)) {
  const broker = fs.readFileSync(brokerPath, 'utf8');
  if (!broker.includes('"learning_context"')) errors.push('broker must expose learning_context action');
  if (!broker.includes('af_lessons')) errors.push('broker learning context must read af_lessons');
  if (!broker.includes('af_incidents')) errors.push('broker learning context must read af_incidents');
}

const workerPath = manifest?.hostedWorkerScript ? path.join(root, manifest.hostedWorkerScript) : null;
if (workerPath && fs.existsSync(workerPath)) {
  const worker = fs.readFileSync(workerPath, 'utf8');
  if (!worker.includes('copilot-autonomous-worker-v2.mjs') && !worker.includes("broker('learning_context'")) errors.push('selected worker must retrieve or delegate durable learning context');
}
const coreWorker = path.join(root, 'scripts/copilot-autonomous-worker-v2.mjs');
if (fs.existsSync(coreWorker)) {
  const worker = fs.readFileSync(coreWorker, 'utf8');
  if (!worker.includes("broker('learning_context'")) errors.push('core worker must retrieve durable learning context');
  if (!worker.includes('LEARNING_CONTEXT_LOADED')) errors.push('core worker must trace loaded memory');
  if (!worker.includes('LEARNING_CONTEXT_APPLIED')) errors.push('core worker must trace applied memory');
  if (!worker.includes('selectExecutableMemory')) errors.push('core worker must use deterministic memory selector');
  if (!worker.includes('memory_refs')) errors.push('core worker result contract must expose used memory refs');
}

const memoryTest = spawnSync(process.execPath, ['scripts/test-executable-memory.mjs'], { cwd: root, encoding: 'utf8' });
if (memoryTest.status !== 0) errors.push(`executable memory deterministic test failed: ${(memoryTest.stderr || memoryTest.stdout || '').trim()}`);

if (errors.length) {
  console.error('AI Factory autonomous runtime validation FAILED');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('AI Factory autonomous runtime validation OK: hosted runtime, provider lifecycle and executable memory are structurally coherent');
