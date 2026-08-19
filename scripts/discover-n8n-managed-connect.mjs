import fs from 'node:fs/promises';

const endpoint = process.env.N8N_MCP_URL || 'https://thethr0ne7.app.n8n.cloud/mcp-server/http';
const token = process.env.N8N_MCP_TOKEN;
if (!token) throw new Error('N8N_MCP_TOKEN is required');

function parsePayload(text, type = '') {
  if (!text.trim()) return null;
  if (type.includes('text/event-stream')) {
    const chunks = text.split(/\r?\n\r?\n/).map((b) => b.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n')).filter(Boolean);
    for (let i = chunks.length - 1; i >= 0; i--) { try { return JSON.parse(chunks[i]); } catch {} }
    throw new Error('No JSON SSE payload');
  }
  return JSON.parse(text);
}

async function request(message) {
  const r = await fetch(endpoint, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify(message) });
  const text = await r.text();
  const payload = parsePayload(text, r.headers.get('content-type') || '');
  if (!r.ok || payload?.error) throw new Error(`MCP failure ${r.status}: ${JSON.stringify(payload).slice(0, 1200)}`);
  return payload;
}

await request({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'ai-factory-managed-connect-discovery', version: '2.4.0' } } });
await request({ jsonrpc: '2.0', method: 'notifications/initialized' });
let id = 2;
async function tool(name, args = {}) {
  return request({ jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name, arguments: args } });
}
function data(p) { return p?.result?.structuredContent?.data ?? p?.result?.structuredContent ?? null; }

const projects = data(await tool('search_projects', { type: 'personal', limit: 20 })) || [];
if (projects.length !== 1) throw new Error(`Expected one personal project; found ${projects.length}`);
const projectId = projects[0].id;
const credsPayload = await tool('list_credentials', { projectId, limit: 200 });
const credentials = data(credsPayload) || [];
const connectServices = data(await tool('list_n8n_connect_services', {}));
const providerSummary = data(await tool('discover_agent_assets', { projectId, kind: 'models' }));
const providers = providerSummary?.providers || [];
const providerCatalogs = {};
for (const p of providers) {
  try {
    providerCatalogs[p.provider] = data(await tool('discover_agent_assets', { projectId, kind: 'models', provider: p.provider }));
  } catch (error) {
    providerCatalogs[p.provider] = { error: String(error?.message || error).slice(0, 500) };
  }
}
const result = {
  checked_at: new Date().toISOString(),
  project: { id: projectId, name: projects[0].name, type: projects[0].type },
  credentials: credentials.map((c) => ({ id: c.id, name: c.name, type: c.type, projectId: c.projectId || null })),
  connect_services: connectServices,
  providers,
  provider_catalogs: providerCatalogs,
  secret_values_included: false,
};
await fs.mkdir('artifacts', { recursive: true });
await fs.writeFile('artifacts/n8n-managed-connect-discovery.json', JSON.stringify(result, null, 2) + '\n');
console.log(`N8N_MANAGED_CONNECT_DISCOVERY_OK credentials=${credentials.length} providers=${providers.length}`);
console.log(`credential_types=${[...new Set(credentials.map((c) => c.type).filter(Boolean))].join(',') || 'none'}`);
