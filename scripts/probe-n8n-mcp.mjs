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

let workflowSearch = null;
const searchTool = tools.find((tool) => tool.name === 'search_workflows');
if (searchTool) {
  const searchResponse = await request({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'search_workflows',
      arguments: { limit: 50, sortBy: 'updatedAt:desc' },
    },
  }, sessionId);
  workflowSearch = searchResponse.payload;
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
  authority_note: 'Read-only live probe. No create/edit/publish/execute tool is called.',
};

await fs.mkdir('artifacts', { recursive: true });
await fs.writeFile('artifacts/n8n-mcp-probe.json', JSON.stringify(result, null, 2) + '\n');

console.log(`N8N_MCP_AUTH_OK protocol=${protocolVersion} tools=${tools.length} session=${Boolean(sessionId)}`);
console.log('MCP tools:', tools.map((tool) => tool.name).join(', '));
if (workflowSearch) console.log('search_workflows call completed');
