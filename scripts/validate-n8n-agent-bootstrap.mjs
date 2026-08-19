import fs from 'node:fs';

const script = fs.readFileSync('scripts/bootstrap-n8n-nursery-agent.mjs', 'utf8');
const workflow = fs.readFileSync('.github/workflows/n8n-agent-nursery-bootstrap.yml', 'utf8');

const required = [
  "callTool('search_projects'",
  "callTool('search_agents'",
  "callTool('create_agent'",
  "callTool('get_agent'",
  "callTool('mutate_agent'",
  "callTool('validate_agent'",
  'Factory Nursery Governance',
  'Automatic production promotion is forbidden',
  'publication_attempted: false',
  'preview_execution_attempted: false',
];
for (const token of required) {
  if (!script.includes(token)) throw new Error(`Nursery bootstrap missing required boundary token: ${token}`);
}

const forbidden = [
  "callTool('publish_agent'",
  "callTool('call_agent'",
  "callTool('update_agent_integration'",
  "callTool('execute_workflow'",
  "callTool('publish_workflow'",
  "callTool('create_data_table'",
];
for (const token of forbidden) {
  if (script.includes(token)) throw new Error(`Nursery bootstrap must not perform live activation/execution: ${token}`);
}

const workflowRequired = [
  'ops/n8n/bootstrap-agent-request.json',
  'secrets.N8N_MCP_TOKEN',
  'node scripts/bootstrap-n8n-nursery-agent.mjs',
  'actions/upload-artifact@v4',
];
for (const token of workflowRequired) {
  if (!workflow.includes(token)) throw new Error(`Nursery bootstrap workflow missing: ${token}`);
}

if (/Bearer\s+[A-Za-z0-9._-]{20,}/.test(script) || /Bearer\s+[A-Za-z0-9._-]{20,}/.test(workflow)) {
  throw new Error('Potential hard-coded bearer credential detected');
}

console.log('N8N_NURSERY_AGENT_BOOTSTRAP_CONTRACT_OK');
