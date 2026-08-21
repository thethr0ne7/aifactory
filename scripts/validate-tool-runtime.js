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
function expect(condition, message) { if (!condition) errors.push(message); }

const manifest = readJson('factory.manifest.json');
const policy = readJson('registry/tool-runtime.json');
const autonomy = readJson('registry/autonomy-levels.json');

for (const rel of [
  'runtime/tool-runtime.mjs',
  'runtime/capability-providers.mjs',
  'registry/capability-providers.json',
  'scripts/tool-executor.mjs',
  'scripts/test-tool-runtime.mjs',
  '.github/workflows/factory-tool-executor.yml',
  'infra/supabase/migrations/20260815_260_controlled_tool_runtime.sql',
  'infra/supabase/migrations/20260815_261_terminal_tool_repeat_guard.sql',
  'infra/supabase/migrations/20260821_350_capability_provider_tools.sql',
  'supabase/functions/ai-factory-broker/index.ts',
  'docs/TOOL-RUNTIME.md',
]) exists(rel);

if (manifest) {
  expect(manifest.contracts?.toolRuntime === 'registry/tool-runtime.json', 'manifest toolRuntime contract mismatch');
  expect(manifest.toolRuntime === 'runtime/tool-runtime.mjs', 'manifest toolRuntime mismatch');
  expect(manifest.toolExecutor === '.github/workflows/factory-tool-executor.yml', 'manifest toolExecutor mismatch');
  expect(manifest.toolExecutorScript === 'scripts/tool-executor.mjs', 'manifest toolExecutorScript mismatch');
}

if (policy) {
  expect(policy.mode === 'controlled-tool-runtime', 'tool runtime mode mismatch');
  expect(Number(policy.maxToolRequestsPerWorkerTurn) <= 3, 'worker turn must be capped at three tool requests');
  expect(policy.executor?.directMerge === false, 'tool executor must never direct-merge');
  expect(policy.executor?.candidateBranchIsPrimaryArtifact === true, 'candidate branch must remain the primary durable review artifact');
  expect(String(policy.executor?.pullRequestCreation || '').includes('best-effort'), 'PR creation must be explicitly best-effort');
  const ids = (policy.tools || []).map((x) => x.id);
  const required = [
    'factory.repo.read_file','factory.repo.list_files','factory.repo.run_validation','factory.repo.candidate_write',
    'factory.web.crawl','factory.document.ocr','factory.document.compare','factory.browser.operate','factory.dev.workspace'
  ];
  for (const id of required) expect(ids.includes(id), `tool allowlist missing ${id}`);
  expect(new Set(ids).size === ids.length, 'tool IDs must be unique');
  const candidate = (policy.tools || []).find((x) => x.id === 'factory.repo.candidate_write');
  expect(candidate && JSON.stringify(candidate.allowedPathPrefixes || []) === JSON.stringify(['skills/','docs/','evals/']), 'candidate write path allowlist mismatch');
  expect(candidate && (candidate.protectedPaths || []).includes('.github/'), 'candidate write must protect workflows');
  expect(candidate && (candidate.protectedPaths || []).includes('registry/factory-constitution.json'), 'candidate write must protect Root of Trust');
  for (const id of ['factory.web.crawl','factory.document.ocr']) {
    const spec = (policy.tools || []).find((x) => x.id === id);
    expect(spec?.autoExecute === true && spec?.riskClass === 'LOW' && spec?.minimumAutonomy === 'A3', `${id} must remain LOW/A3 auto-execution only`);
  }
  for (const id of ['factory.document.compare','factory.browser.operate','factory.dev.workspace']) {
    const spec = (policy.tools || []).find((x) => x.id === id);
    expect(spec?.autoExecute === false, `${id} must not auto-execute`);
  }
  for (const id of ['factory.browser.operate','factory.dev.workspace']) {
    const spec = (policy.tools || []).find((x) => x.id === id);
    expect(spec?.ownerApprovalRequired === true && spec?.riskClass === 'HIGH', `${id} must be HIGH and owner-gated`);
  }
  for (const denial of ['automatic merge','arbitrary shell command','arbitrary SQL','private-network web crawling','browser side effects without owner approval']) {
    expect((policy.hardDenials || []).includes(denial), `hard denial missing: ${denial}`);
  }
  expect(policy.evidencePolicy?.pullRequestBlockedMustBeReported === true, 'blocked PR creation must be reported');
  expect(policy.evidencePolicy?.providerSecretsMustNeverBePersisted === true, 'provider secrets must never be persisted');
}

if (autonomy) {
  const a3 = (autonomy.levels || []).find((x) => x.id === 'A3');
  expect(a3 && (a3.may || []).some((x) => String(x).includes('candidate branches')), 'A3 contract must permit candidate-branch repair');
  expect(a3 && (a3.mayNot || []).some((x) => String(x).includes('Root of Trust')), 'A3 must forbid Root of Trust mutation');
}

const workflow = safeRead('.github/workflows/factory-tool-executor.yml');
for (const token of ['contents: write','pull-requests: write','id-token: write','node scripts/validate-tool-runtime.js','node scripts/tool-executor.mjs']) expect(workflow.includes(token), `tool executor workflow missing ${token}`);
expect(!workflow.includes('copilot-requests: write'), 'deterministic tool executor must not require Copilot permission');

const executor = safeRead('scripts/tool-executor.mjs');
for (const token of [
  'candidatePathDecision','expected_blob_sha','git_blob_sha','direct_merge: false','factory/tool-','VALIDATION_FAILED','candidate_branch_ready','BLOCKED_BY_REPOSITORY_POLICY','openPullRequestBestEffort',
  'factory.web.crawl','factory.document.ocr','CRAWL4AI_HOOKS_ENABLED=false','CRAWL4AI_EXECUTE_JS_ENABLED=false','127.0.0.1:11235','/api/v1/misc/ocr-pdf','X-API-KEY'
]) expect(executor.includes(token), `tool executor missing safety/provider token ${token}`);
expect(!executor.includes("spawnSync('sh'") && !executor.includes('shell: true'), 'tool executor must not expose a general shell');

const broker = safeRead('supabase/functions/ai-factory-broker/index.ts');
for (const token of ['tool_request','tool_context','await_tools','tool_recover','tool_claim','tool_finish','factory-tool-executor.yml@refs/heads/main']) expect(broker.includes(token), `broker missing tool action/identity ${token}`);

const migration = safeRead('infra/supabase/migrations/20260815_260_controlled_tool_runtime.sql');
for (const token of ['af_tool_requests','af_tool_results','WAITING_TOOLS','af_request_tool','af_wait_for_tools','af_claim_tool_request','af_finish_tool_request','af_recover_stale_tools']) expect(migration.includes(token), `tool migration missing ${token}`);
for (const token of ['factory.repo.read_file','factory.repo.list_files','factory.repo.run_validation','factory.repo.candidate_write']) expect(migration.includes(token), `v1 database allowlist missing ${token}`);

const providerMigration = safeRead('infra/supabase/migrations/20260821_350_capability_provider_tools.sql');
for (const token of ['factory.web.crawl','factory.document.ocr','tool is not auto-execution allowlisted']) expect(providerMigration.includes(token), `provider database allowlist missing ${token}`);
expect(!providerMigration.includes('factory.browser.operate') && !providerMigration.includes('factory.dev.workspace'), 'owner-gated tools must not enter SQL auto-execution allowlist');

const repeatGuard = safeRead('infra/supabase/migrations/20260815_261_terminal_tool_repeat_guard.sql');
for (const token of ['TERMINAL_TOOL_REQUEST_REPEATED','TOOL_WAIT_NO_PENDING_BLOCKED',"status='BLOCKED'","v_pending = 0"]) expect(repeatGuard.includes(token), `terminal tool repeat guard missing ${token}`);

const test = spawnSync(process.execPath, ['scripts/test-tool-runtime.mjs'], { cwd: root, encoding: 'utf8' });
if (test.status !== 0) errors.push(`tool runtime tests failed: ${(test.stderr || test.stdout || '').trim()}`);

if (errors.length) {
  console.error('AI Factory controlled tool runtime validation FAILED');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log('AI Factory controlled tool runtime validation OK: durable requests, provider-backed LOW tools, owner-gated high-risk capabilities and branch-first repository writes are coherent');

function safeRead(rel) { const full = path.join(root, rel); return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : ''; }
