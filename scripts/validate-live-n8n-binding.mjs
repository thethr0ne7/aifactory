#!/usr/bin/env node

import fs from 'node:fs';

const errors = [];
const registry = JSON.parse(fs.readFileSync('registry/external-runtimes.json', 'utf8'));
const runtime = registry.runtimes?.find((item) => item.id === 'n8n-agent-nursery');
const workflow = JSON.parse(fs.readFileSync('integrations/n8n/workflows/ai-factory-agent-nursery.json', 'utf8'));
const deployScript = fs.readFileSync('scripts/deploy-n8n-agent-nursery.mjs', 'utf8');

if (!runtime) errors.push('missing n8n-agent-nursery runtime');
if (runtime && runtime.instanceUrl !== 'https://thethr0ne7.app.n8n.cloud') errors.push('unexpected n8n instance URL');
if (runtime && runtime.apiBasePath !== '/api/v1') errors.push('unexpected n8n API base path');
if (runtime && runtime.authority?.maxAutonomy !== 'A3') errors.push('n8n nursery autonomy ceiling must be A3');
if (runtime?.authority?.rootOfTrustMutation !== false) errors.push('n8n must not mutate Root of Trust');
if (runtime?.authority?.selfPromotion !== false) errors.push('n8n must not self-promote agents');
if (runtime?.deployment?.activateAutomatically !== false) errors.push('n8n nursery deployment must not auto-activate');
if (!runtime?.deployment?.requiredSecretNames?.includes('N8N_API_KEY')) errors.push('N8N_API_KEY secret requirement missing');

if (workflow.name !== 'AI Factory Agent Nursery Gateway') errors.push('unexpected n8n workflow name');
const nodeTypes = new Set((workflow.nodes || []).map((node) => node.type));
for (const required of ['n8n-nodes-base.webhook', 'n8n-nodes-base.code', 'n8n-nodes-base.respondToWebhook']) {
  if (!nodeTypes.has(required)) errors.push(`workflow missing ${required}`);
}
const code = workflow.nodes?.find((node) => node.type === 'n8n-nodes-base.code')?.parameters?.jsCode || '';
for (const requiredAction of ['spawn_candidate','start_training','submit_evaluation','request_repair','quarantine_candidate','request_promotion_review']) {
  if (!code.includes(requiredAction)) errors.push(`workflow missing bounded action: ${requiredAction}`);
}
for (const forbidden of ['rewrite_constitution','promote_to_production','raise_autonomy','read_secret','write_secret']) {
  if (code.includes(`'${forbidden}'`) || code.includes(`\"${forbidden}\"`)) errors.push(`workflow includes forbidden action: ${forbidden}`);
}
if (!code.includes("/^A[0-3]$/")) errors.push('workflow must enforce A0-A3 autonomy ceiling');
if (!code.includes('root_of_trust_mutation: false')) errors.push('workflow must emit Root of Trust denial');
if (!code.includes('self_promotion: false')) errors.push('workflow must emit self-promotion denial');

if (!deployScript.includes("'X-N8N-API-KEY': apiKey")) errors.push('deployment client must use n8n API-key header');
if (!deployScript.includes('N8N_API_KEY is required')) errors.push('deployment client must fail closed without API key');
if (/N8N_API_KEY\s*=\s*['\"][^'\"]+['\"]/.test(deployScript)) errors.push('deployment script appears to contain a literal API key');
if (deployScript.includes('/activate')) errors.push('deployment script must not auto-activate workflow');

if (errors.length) {
  console.error('Live n8n binding validation FAILED');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Live n8n binding validation OK: URL bound, auth secret external, workflow inactive by policy, A3/Root-of-Trust gates enforced');
