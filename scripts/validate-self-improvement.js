#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = process.cwd();
const errors = [];

function readJson(rel) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) { errors.push(`missing file: ${rel}`); return null; }
  try { return JSON.parse(fs.readFileSync(full, 'utf8')); }
  catch (error) { errors.push(`invalid JSON ${rel}: ${error.message}`); return null; }
}
function exists(rel) { if (!fs.existsSync(path.join(root, rel))) errors.push(`missing artifact: ${rel}`); }

const manifest = readJson('factory.manifest.json');
const policy = readJson('registry/self-improvement.json');
const autonomy = readJson('registry/autonomy-levels.json');
const learning = readJson('registry/learning-policy.json');

for (const rel of [
  'runtime/self-improvement.mjs',
  'scripts/self-improvement-worker.mjs',
  'scripts/test-self-improvement.mjs',
  '.github/workflows/factory-self-improvement.yml',
  'infra/supabase/migrations/20260815_250_controlled_self_improvement.sql',
  'infra/supabase/migrations/20260815_251_incident_lesson_linkage.sql',
  'supabase/functions/ai-factory-broker/index.ts',
]) exists(rel);

if (manifest) {
  if (manifest.contracts?.controlledSelfImprovement !== 'registry/self-improvement.json') errors.push('manifest self-improvement contract mismatch');
  if (manifest.selfImprovementRuntime !== 'runtime/self-improvement.mjs') errors.push('manifest self-improvement runtime mismatch');
  if (manifest.selfImprovementWorkflow !== '.github/workflows/factory-self-improvement.yml') errors.push('manifest self-improvement workflow mismatch');
  if (manifest.selfImprovementWorker !== 'scripts/self-improvement-worker.mjs') errors.push('manifest self-improvement worker mismatch');
  if (manifest.selfImprovementPersistence !== 'infra/supabase/migrations/20260815_250_controlled_self_improvement.sql') errors.push('manifest self-improvement persistence mismatch');
  if (manifest.incidentLessonLinkagePersistence !== 'infra/supabase/migrations/20260815_251_incident_lesson_linkage.sql') errors.push('manifest incident/lesson linkage persistence mismatch');
  const expectedLoop = ['INCIDENT','REGRESSION_EVAL','PATCH_CANDIDATE','BASELINE_VS_CANDIDATE','A4_LOW_RISK_PROMOTION','OBSERVE','ROLLBACK_OR_RETAIN'];
  if (JSON.stringify(manifest.executionLoops?.controlledSelfImprovement || []) !== JSON.stringify(expectedLoop)) errors.push('controlled self-improvement execution loop mismatch');
}

if (policy) {
  if (policy.mode !== 'controlled-self-improvement') errors.push('self-improvement mode mismatch');
  if (policy.automaticPromotion?.maxAutonomyLevel !== 'A4') errors.push('auto-promotion must stop at A4');
  if (JSON.stringify(policy.automaticPromotion?.allowedTargetTypes || []) !== JSON.stringify(['MEMORY_GUIDANCE'])) errors.push('A4 automatic promotion target allowlist must be MEMORY_GUIDANCE only');
  if (policy.automaticPromotion?.requiredRiskClass !== 'LOW') errors.push('A4 automatic promotion must require LOW risk');
  if (policy.automaticPromotion?.requiresRollbackRef !== true) errors.push('promotion must require rollback ref');
  if ((policy.neverAutoPromote || []).length < 6) errors.push('protected self-improvement boundary is unexpectedly small');
  if (Number(policy.evaluation?.maxCandidatesPerRun) !== 1) errors.push('self-improvement must evaluate at most one candidate per run');
  if (Number(policy.evaluation?.maxModelEvaluationsPerRun) !== 1) errors.push('self-improvement must allow at most one model eval per run');
  if (Number(policy.observation?.minimumPassObservationsToRetain) < 2) errors.push('retention requires at least two pass observations');
}

if (autonomy) {
  const a4 = (autonomy.levels || []).find((x) => x.id === 'A4');
  if (!a4 || !(a4.may || []).some((x) => String(x).includes('low-risk'))) errors.push('A4 autonomy contract missing low-risk promotion permission');
  if (!a4 || !(a4.mayNot || []).some((x) => String(x).includes('security weakening'))) errors.push('A4 must forbid security weakening');
}
if (learning) {
  if (learning.promotion?.autoPromotionMaxAutonomyLevel !== 'A4') errors.push('learning policy must cap auto-promotion at A4');
  if (learning.promotion?.rootOfTrustAutoPromotion !== false) errors.push('Root of Trust auto-promotion must remain false');
}

const runtimePath = path.join(root, 'runtime/self-improvement.mjs');
if (fs.existsSync(runtimePath)) {
  const runtime = fs.readFileSync(runtimePath, 'utf8');
  for (const token of ['A[0-7]\\+\\s+autonomy','autonomy level','lower autonomy','higher autonomy']) {
    if (!runtime.includes(token)) errors.push(`risk classifier missing protected autonomy-routing pattern: ${token}`);
  }
}

const brokerPath = path.join(root, 'supabase/functions/ai-factory-broker/index.ts');
if (fs.existsSync(brokerPath)) {
  const broker = fs.readFileSync(brokerPath, 'utf8');
  for (const token of ['seed_regression_evals','improvement_claim','improvement_record','improvement_promote','promotion_context','promotion_observe','promotion_retain','promotion_rollback']) {
    if (!broker.includes(token)) errors.push(`broker missing action: ${token}`);
  }
  if (!broker.includes('factory-self-improvement.yml@refs/heads/main')) errors.push('broker must pin self-improvement workflow identity');
}

const migrationPath = path.join(root, 'infra/supabase/migrations/20260815_250_controlled_self_improvement.sql');
if (fs.existsSync(migrationPath)) {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  for (const token of ['af_regression_evals','af_patch_candidates','af_promotions','af_promotion_observations','af_promote_low_risk_memory','af_rollback_promotion','af_retain_promotion']) {
    if (!sql.includes(token)) errors.push(`self-improvement migration missing ${token}`);
  }
  if (!sql.includes("v_risk <> 'LOW'")) errors.push('database promotion gate must require LOW risk');
  if (!sql.includes("v_target <> 'MEMORY_GUIDANCE'")) errors.push('database promotion gate must require MEMORY_GUIDANCE target');
  if (!sql.includes('protected governance topic cannot be auto-promoted')) errors.push('database must block protected governance promotion');
}

const linkagePath = path.join(root, 'infra/supabase/migrations/20260815_251_incident_lesson_linkage.sql');
if (fs.existsSync(linkagePath)) {
  const sql = fs.readFileSync(linkagePath, 'utf8');
  for (const token of ['af_link_lesson_to_single_incident','af_lessons_link_single_incident','v_count = 1','l.incident_id is not null','e.status=\'CANDIDATE\'']) {
    if (!sql.includes(token)) errors.push(`incident/lesson linkage missing safety condition: ${token}`);
  }
  if (!sql.includes('join public.af_incidents')) errors.push('improvement claim must use a traceable incident join');
  if (!sql.includes('join public.af_regression_evals')) errors.push('improvement claim must use a traceable regression eval join');
  if (!sql.includes('a[0-7]\\+ autonomy')) errors.push('database promotion gate must protect A4+/autonomy routing statements');
  if (!sql.includes('autonomy level|lower autonomy|higher autonomy')) errors.push('database promotion gate must protect autonomy-level routing statements');
}

const workflowPath = path.join(root, '.github/workflows/factory-self-improvement.yml');
if (fs.existsSync(workflowPath)) {
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  if (!workflow.includes('id-token: write')) errors.push('self-improvement workflow requires GitHub OIDC');
  if (!workflow.includes('copilot-requests: write')) errors.push('self-improvement workflow requires Copilot request permission');
  if (!workflow.includes('contents: read')) errors.push('A4 workflow must remain read-only on repository contents');
  if (workflow.includes('contents: write')) errors.push('A4 workflow must not get repository write permission');
  if (!workflow.includes('node scripts/self-improvement-worker.mjs')) errors.push('workflow must execute A4 worker');
}

const test = spawnSync(process.execPath, ['scripts/test-self-improvement.mjs'], { cwd: root, encoding: 'utf8' });
if (test.status !== 0) errors.push(`self-improvement state-machine tests failed: ${(test.stderr || test.stdout || '').trim()}`);

if (errors.length) {
  console.error('AI Factory controlled self-improvement validation FAILED');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log('AI Factory controlled self-improvement validation OK: A4 promotion, incident linkage, autonomy boundary, observation and rollback are coherent');
