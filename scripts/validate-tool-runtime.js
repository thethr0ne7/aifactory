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
const policy = readJson('registry/tool-runtime.json');
const autonomy = readJson('registry/autonomy-levels.json');

for (const rel of [
  'runtime/tool-runtime.mjs',
  'scripts/tool-executor.mjs',
  'scripts/test-tool-runtime.mjs',
  '.github/workflows/factory-tool-executor.yml',
  'infra/supabase/migrations/20260815_260_controlled_tool_runtime.sql',
  'supabase/functions/ai-factory-broker/index.ts',
  'docs/TOOL-RUNTIME.md',
]) exists(rel);

if (manifest) {
  if (manifest.contracts?.toolRuntime !== 'registry/tool-runtime.json') errors.push('manifest toolRuntime contract mismatch');
  if (manifest.toolRuntime !== 'runtime/tool-runtime.mjs') errors.push('manifest toolRuntime mismatch');
  if (manifest.toolExecutor !== '.github/workflows/factory-tool-executor.yml') errors.push('manifest toolExecutor mismatch');
  if (manifest.toolExecutorScript !== 'scripts/tool-executor.mjs') errors.push('manifest toolExecutorScript mismatch');
  if (manifest.toolRuntimePersistence !== 'infra/supabase/migrations/20260815_260_controlled_tool_runtime.sql') errors.push('manifest toolRuntimePersistence mismatch');
}

if (policy) {
  if (policy.mode !== 'controlled-tool-runtime') errors.push('tool runtime mode mismatch');
  if (Number(policy.maxToolRequestsPerWorkerTurn) > 3) errors.push('worker turn must be capped at three tool requests');
  if (policy.executor?.directMerge !== false) errors.push('tool executor must never direct-merge');
  const ids = (policy.tools || []).map((x) => x.id);
  const expected = ['factory.repo.read_file','factory.repo.list_files','factory.repo.run_validation','factory.repo.candidate_write'];
  if (JSON.stringify(ids) !== JSON.stringify(expected)) errors.push('v1 tool allowlist mismatch');
  const candidate = (policy.tools || []).find((x) => x.id === 'factory.repo.candidate_write');
  if (!candidate || JSON.stringify(candidate.allowedPathPrefixes || []) !== JSON.stringify(['skills/','docs/','evals/'])) errors.push('candidate write path allowlist mismatch');
  if (!candidate || !(candidate.protectedPaths || []).includes('.github/')) errors.push('candidate write must protect workflows');
  if (!candidate || !(candidate.protectedPaths || []).includes('registry/factory-constitution.json')) errors.push('candidate write must protect Root of Trust');
  if (!(policy.hardDenials || []).includes('automatic merge')) errors.push('automatic merge must be explicitly denied');
  if (!(policy.hardDenials || []).includes('arbitrary shell command')) errors.push('arbitrary shell must be explicitly denied');
  if (!(policy.hardDenials || []).includes('arbitrary SQL')) errors.push('arbitrary SQL must be explicitly denied');
}

if (autonomy) {
  const a3 = (autonomy.levels || []).find((x) => x.id === 'A3');
  if (!a3 || !(a3.may || []).some((x) => String(x).includes('candidate branches'))) errors.push('A3 contract must permit candidate-branch repair');
  if (!a3 || !(a3.mayNot || []).some((x) => String(x).includes('Root of Trust'))) errors.push('A3 must forbid Root of Trust mutation');
}

const workflow = fs.existsSync(path.join(root,'.github/workflows/factory-tool-executor.yml')) ? fs.readFileSync(path.join(root,'.github/workflows/factory-tool-executor.yml'),'utf8') : '';
for (const token of ['contents: write','pull-requests: write','id-token: write','node scripts/validate-tool-runtime.js','node scripts/tool-executor.mjs']) {
  if (!workflow.includes(token)) errors.push(`tool executor workflow missing ${token}`);
}
if (workflow.includes('copilot-requests: write')) errors.push('deterministic tool executor must not require Copilot permission');

const executor = fs.existsSync(path.join(root,'scripts/tool-executor.mjs')) ? fs.readFileSync(path.join(root,'scripts/tool-executor.mjs'),'utf8') : '';
for (const token of ['candidatePathDecision','expected_blob_sha','git_blob_sha','direct_merge: false','factory/tool-','VALIDATION_FAILED']) {
  if (!executor.includes(token)) errors.push(`tool executor missing safety token ${token}`);
}
if (executor.includes("spawnSync('sh'" ) || executor.includes('shell: true')) errors.push('tool executor must not expose a general shell');

const broker = fs.existsSync(path.join(root,'supabase/functions/ai-factory-broker/index.ts')) ? fs.readFileSync(path.join(root,'supabase/functions/ai-factory-broker/index.ts'),'utf8') : '';
for (const token of ['tool_request','tool_context','await_tools','tool_recover','tool_claim','tool_finish','factory-tool-executor.yml@refs/heads/main']) {
  if (!broker.includes(token)) errors.push(`broker missing tool action/identity ${token}`);
}

const migration = fs.existsSync(path.join(root,'infra/supabase/migrations/20260815_260_controlled_tool_runtime.sql')) ? fs.readFileSync(path.join(root,'infra/supabase/migrations/20260815_260_controlled_tool_runtime.sql'),'utf8') : '';
for (const token of ['af_tool_requests','af_tool_results','WAITING_TOOLS','af_request_tool','af_wait_for_tools','af_claim_tool_request','af_finish_tool_request','af_recover_stale_tools']) {
  if (!migration.includes(token)) errors.push(`tool migration missing ${token}`);
}
for (const token of ["factory.repo.read_file","factory.repo.list_files","factory.repo.run_validation","factory.repo.candidate_write"]) {
  if (!migration.includes(token)) errors.push(`database allowlist missing ${token}`);
}

const test = spawnSync(process.execPath, ['scripts/test-tool-runtime.mjs'], { cwd: root, encoding: 'utf8' });
if (test.status !== 0) errors.push(`tool runtime tests failed: ${(test.stderr || test.stdout || '').trim()}`);

if (errors.length) {
  console.error('AI Factory controlled tool runtime validation FAILED');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log('AI Factory controlled tool runtime validation OK: durable tool requests, bounded executor, candidate-only writes and resume semantics are coherent');
