#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

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

const expectedVersion = '2.4.0';
for (const [name, obj] of Object.entries({manifest, capabilities, runtime, constitution, autonomy, negatives, learning, telemetry})) {
  if (!obj) continue;
  const version = name === 'manifest' ? obj.version : obj.factoryVersion;
  if (version && version !== expectedVersion) errors.push(`${name} version mismatch: ${version} != ${expectedVersion}`);
}

exists('skills/autonomous-runtime/SKILL.md');
exists('skills/incident-learning/SKILL.md');
exists('skills/root-of-trust/SKILL.md');
exists('infra/supabase/migrations/20260815_240_autonomous_runtime.sql');
exists('docs/AUTONOMOUS-RUNTIME.md');

if (runtime) {
  const requiredStates = ['QUEUED','QUALIFYING','ROUTED','WORKING','VALIDATING','REPAIRING','LEARNING','COMPLETE','BLOCKED','FAILED'];
  const states = new Set([
    runtime.stateMachine?.initial,
    ...(runtime.stateMachine?.active || []),
    ...(runtime.stateMachine?.terminal || [])
  ]);
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
}

if (learning) {
  if (learning.promotion?.rootOfTrustAutoPromotion !== false) errors.push('learning policy must forbid Root of Trust auto-promotion');
  if (learning.promotion?.requiresBaselineComparison !== true) errors.push('learning policy must require baseline comparison');
  if (learning.promotion?.requiresRegressionSuite !== true) errors.push('learning policy must require regression suite');
}

if (telemetry) {
  const required = ['INCIDENT_OPENED','LESSON_CANDIDATE_CREATED','REGRESSION_EVAL_CREATED','RUN_COMPLETED','RUN_FAILED','RUN_BLOCKED'];
  const events = new Set(telemetry.eventTypes || []);
  for (const event of required) if (!events.has(event)) errors.push(`telemetry event missing: ${event}`);
  if (telemetry.rules?.secretRedactionRequired !== true) errors.push('telemetry must require secret redaction');
}

if (capabilities) {
  const ids = new Set((capabilities.capabilities || []).map((capability) => capability.id));
  for (const id of ['autonomous-runtime','incident-learning','root-of-trust']) {
    if (!ids.has(id)) errors.push(`capabilities missing runtime capability: ${id}`);
  }
}

if (errors.length) {
  console.error('AI Factory autonomous runtime validation FAILED');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('AI Factory autonomous runtime validation OK: 2.4.0 contracts are structurally coherent');
