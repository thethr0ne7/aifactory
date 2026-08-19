import fs from 'node:fs';

const script = fs.readFileSync('scripts/probe-n8n-mcp.mjs', 'utf8');
const workflow = fs.readFileSync('.github/workflows/n8n-mcp-live-probe.yml', 'utf8');

const requiredScriptTokens = [
  'N8N_MCP_TOKEN',
  'https://thethr0ne7.app.n8n.cloud/mcp-server/http',
  "method: 'initialize'",
  "method: 'tools/list'",
  "callReadOnlyTool('search_workflows'",
  "callReadOnlyTool('search_projects'",
  "callReadOnlyTool('search_agents'",
  "callReadOnlyTool('get_agent_builder_reference'",
  'Read-only live probe',
];
for (const token of requiredScriptTokens) {
  if (!script.includes(token)) throw new Error(`MCP probe missing required token: ${token}`);
}

const forbiddenCalls = [
  "callReadOnlyTool('create_workflow",
  "callReadOnlyTool('update_workflow'",
  "callReadOnlyTool('publish_workflow'",
  "callReadOnlyTool('execute_workflow'",
  "callReadOnlyTool('delete_workflow'",
  "callReadOnlyTool('create_agent'",
  "callReadOnlyTool('mutate_agent'",
  "callReadOnlyTool('publish_agent'",
  "callReadOnlyTool('call_agent'",
];
for (const token of forbiddenCalls) {
  if (script.includes(token)) throw new Error(`Read-only MCP probe must not call mutating/execution tool: ${token}`);
}

const requiredWorkflowTokens = [
  'ops/n8n/mcp-probe-request.json',
  'secrets.N8N_MCP_TOKEN',
  'node scripts/probe-n8n-mcp.mjs',
  'actions/upload-artifact@v4',
];
for (const token of requiredWorkflowTokens) {
  if (!workflow.includes(token)) throw new Error(`MCP probe workflow missing required token: ${token}`);
}

if (/Bearer\s+[A-Za-z0-9._-]{20,}/.test(script) || /Bearer\s+[A-Za-z0-9._-]{20,}/.test(workflow)) {
  throw new Error('Potential hard-coded bearer credential detected');
}

console.log('N8N_MCP_LIVE_PROBE_CONTRACT_OK');
