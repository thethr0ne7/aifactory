import fs from 'node:fs/promises';

const endpoint = process.env.N8N_MCP_URL || 'https://thethr0ne7.app.n8n.cloud/mcp-server/http';
const token = process.env.N8N_MCP_TOKEN;

if (!token) {
  throw new Error('N8N_MCP_TOKEN is required');
}

const protocolCandidates = [
  process.env.MCP_PROTOCOL_VERSION,
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
].filter(Boolean);

function parsePayload(text, contentType) {
  if (!text.trim()) return null;
  if (contentType.includes('text/event-stream')) {
    const payloads = [];
    let dataLines = [];
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
      if (line === '' && dataLines.length) {
        payloads.push(dataLines.join('\n'));
        dataLines = [];
      }
    }
    if (dataLines.length) payloads.push(dataLines.join('\n'));
    for (let i = payloads.length - 1; i >= 0; i -= 1) {
      try { return JSON.parse(payloads[i]); } catch {}
    }
    throw new Error('MCP returned SSE without a JSON data event');
  }
  return JSON.parse(text);
}

async function request(message, sessionId) {
  const headers = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(message),
  });
  const text = await response.text();
  const contentType = response.headers.get('content-type') || '';
  let payload = null;
  try { payload = parsePayload(text, contentType); } catch (error) {
    if (!response.ok) {
      throw new Error(`MCP HTTP ${response.status}: ${text.slice(0, 1000)}`);
    }
    throw error;
  }
  if (!response.ok) {
    throw new Error(`MCP HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 1000)}`);
  }
  return {
    payload,
    sessionId: response.headers.get('mcp-session-id') || sessionId || null,
    status: response.status,
  };
}

let initialized;
let protocolVersion;
let initError;
for (const candidate of [...new Set(protocolCandidates)]) {
  try {
    const response = await request({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: candidate,
        capabilities: {},
        clientInfo: { name: 'ai-factory-n8n-probe', version: '2.4.0' },
      },
    });
    if (response.payload?.error) {
      initError = new Error(`initialize(${candidate}) failed: ${JSON.stringify(response.payload.error)}`);
      continue;
    }
    initialized = response;
    protocolVersion = response.payload?.result?.protocolVersion || candidate;
    break;
  } catch (error) {
    initError = error;
  }
}
if (!initialized) throw initError || new Error('Unable to initialize MCP session');

const sessionId = initialized.sessionId;
await request({ jsonrpc: '2.0', method: 'notifications/initialized' }, sessionId);

const toolsResponse = await request({
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/list',
  params: {},
}, sessionId);
if (toolsResponse.payload?.error) {
  throw new Error(`tools/list failed: ${JSON.stringify(toolsResponse.payload.error)}`);
}

const tools = toolsResponse.payload?.result?.tools || [];
const toolSummary = tools.map((tool) => ({
  name: tool.name,
  description: tool.description || null,
  inputSchema: tool.inputSchema || null,
}));
const toolNames = new Set(tools.map((tool) => tool.name));

let nextId = 3;
async function callReadOnlyTool(name, args = {}) {
  if (!toolNames.has(name)) return null;
  const response = await request({
    jsonrpc: '2.0',
    id: nextId++,
    method: 'tools/call',
    params: { name, arguments: args },
  }, sessionId);
  if (response.payload?.error) {
    throw new Error(`${name} failed: ${JSON.stringify(response.payload.error)}`);
  }
  return response.payload;
}

const workflowSearch = await callReadOnlyTool('search_workflows', { limit: 50, sortBy: 'updatedAt:desc' });
const projectSearch = await callReadOnlyTool('search_projects', { limit: 50 });
const agentSearch = await callReadOnlyTool('search_agents', { limit: 50 });
const agentBuilderReference = await callReadOnlyTool('get_agent_builder_reference', {});

const projects = projectSearch?.result?.structuredContent?.data || [];
const projectId = projects.length === 1 ? projects[0].id : null;
let modelAssets = null;
let credentialSummary = null;
if (projectId) {
  modelAssets = await callReadOnlyTool('discover_agent_assets', { projectId, kind: 'models' });
  const credentials = await callReadOnlyTool('list_credentials', { projectId, limit: 200 });
  const rows = credentials?.result?.structuredContent?.data || [];
  credentialSummary = {
    count: rows.length,
    types: [...new Set(rows.map((row) => row.type).filter(Boolean))].sort(),
  };
}

const result = {
  checked_at: new Date().toISOString(),
  endpoint,
  authenticated: true,
  protocol_version: protocolVersion,
  server_info: initialized.payload?.result?.serverInfo || null,
  server_capabilities: initialized.payload?.result?.capabilities || null,
  session_established: Boolean(sessionId),
  tools: toolSummary,
  workflow_search: workflowSearch,
  project_search: projectSearch,
  agent_search: agentSearch,
  agent_builder_reference: agentBuilderReference,
  model_assets: modelAssets,
  credential_summary: credentialSummary,
  authority_note: 'Read-only live probe. No create/edit/publish/execute/delete tool is called.',
};

await fs.mkdir('artifacts', { recursive: true });
await fs.writeFile('artifacts/n8n-mcp-probe.json', JSON.stringify(result, null, 2) + '\n');

console.log(`N8N_MCP_AUTH_OK protocol=${protocolVersion} tools=${tools.length} session=${Boolean(sessionId)}`);
console.log('MCP tools:', tools.map((tool) => tool.name).join(', '));
console.log(`Read-only discovery completed: workflows, projects, agents, agent-builder reference, models; credential_count=${credentialSummary?.count ?? 'n/a'}`);
