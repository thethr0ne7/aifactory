#!/usr/bin/env node

import fs from 'node:fs';

const errors = [];
const registryPath = 'registry/external-runtimes.json';
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
const runtime = (registry.runtimes || []).find((item) => item.id === 'n8n-agent-nursery');

if (!runtime) errors.push('missing n8n-agent-nursery runtime');

const expectedInstance = 'https://thethr0ne7.app.n8n.cloud';
const expectedMcp = `${expectedInstance}/mcp-server/http`;

if (runtime) {
  if (runtime.instanceUrl !== expectedInstance) errors.push(`unexpected n8n instanceUrl: ${runtime.instanceUrl}`);
  if (runtime.mcpServerUrl !== expectedMcp) errors.push(`unexpected n8n mcpServerUrl: ${runtime.mcpServerUrl}`);
  if (runtime.transports?.mcp?.serverUrl !== expectedMcp) errors.push('MCP transport URL does not match canonical endpoint');
  if (runtime.transports?.mcp?.type !== 'streamable-http') errors.push('MCP transport must be streamable-http');
  if (runtime.transports?.mcp?.authentication?.recommended !== 'oauth') errors.push('OAuth must remain recommended for interactive MCP clients');
  if (!(runtime.transports?.mcp?.authentication?.requiredSecretNames || []).includes('N8N_MCP_TOKEN')) {
    errors.push('N8N_MCP_TOKEN secret contract is missing');
  }
  if (runtime.authority?.maxAutonomy !== 'A3') errors.push('n8n nursery autonomy ceiling must remain A3');
  for (const key of ['rootOfTrustMutation', 'selfPromotion', 'productionWriteAuthority', 'secretScopeExpansion']) {
    if (runtime.authority?.[key] !== false) errors.push(`n8n authority boundary must deny ${key}`);
  }
  if (runtime.deployment?.activateAutomatically !== false) errors.push('n8n deployment must not auto-activate workflows');
}

const serialized = JSON.stringify(registry);
for (const forbidden of ['Authorization: Bearer ', 'X-N8N-API-KEY: ', 'n8n_api_', 'eyJhbGciOi']) {
  if (serialized.includes(forbidden)) errors.push(`possible secret material committed: ${forbidden}`);
}

if (!fs.existsSync('docs/N8N-MCP-BINDING.md')) errors.push('missing docs/N8N-MCP-BINDING.md');

if (errors.length) {
  console.error('n8n MCP binding validation FAILED');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('n8n MCP binding validation OK');
