#!/usr/bin/env node
import fs from 'node:fs';

const errors = [];
const policy = JSON.parse(fs.readFileSync('registry/tool-runtime.json','utf8'));
const workflow = fs.readFileSync('.github/workflows/factory-tool-executor.yml','utf8');
const executor = fs.readFileSync('scripts/tool-executor.mjs','utf8');

if (policy.executor?.claimOnePerRun !== false) errors.push('claimOnePerRun must be false for bounded batch execution');
if (Number(policy.executor?.maxClaimsPerExecutorRun) !== 6) errors.push('maxClaimsPerExecutorRun must be 6');
if (policy.executor?.stopBatchAfterCandidateWrite !== true) errors.push('candidate write must terminate the current batch');
if (Number(policy.executor?.scheduleCadenceMinutes) !== 5) errors.push('tool executor policy cadence must be 5 minutes');
if (policy.resumeSemantics?.toolContinuationConsumesRetryBudget !== false) errors.push('normal tool continuation must remain retry-budget neutral');

for (const token of ["cron: '*/5 * * * *'", "FACTORY_TOOL_BATCH_SIZE: '6'", 'Execute bounded allowlisted tool batch']) {
  if (!workflow.includes(token)) errors.push(`workflow missing ${token}`);
}
for (const token of [
  'const maxBatch',
  'while (processed < maxBatch',
  "request.tool_id === 'factory.repo.candidate_write'",
  'candidateWriteSeen',
  'controlled-tool-runtime-v4-provider-champions',
  'providerRoute',
  "routedProvider === 'native-fetch'",
  "return crawl4aiTool(args, context, routedProvider || 'crawl4ai')"
]) {
  if (!executor.includes(token)) errors.push(`executor missing bounded batch/provider invariant ${token}`);
}
if (executor.includes('controlled-tool-runtime-v3-providers')) errors.push('executor metadata must not regress to v3 provider-static routing');
for (const token of ['FACTORY_EPHEMERAL_CRAWL4AI', 'CRAWL4AI_BASE_URL', 'STIRLING_PDF_BASE_URL']) {
  if (!workflow.includes(token)) errors.push(`provider-enabled workflow missing ${token}`);
}
if (executor.includes("spawnSync('sh'") || executor.includes('shell: true')) errors.push('batch executor must not expose a general shell');

if (errors.length) {
  console.error('AI Factory tool executor batch validation FAILED');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log('AI Factory tool executor batch validation OK: max 6 claims/run, 5-minute cadence, candidate-write stop boundary, retry-neutral continuation and contextual provider routing');
