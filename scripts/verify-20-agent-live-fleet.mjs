import fs from 'node:fs/promises';

const endpoint = process.env.N8N_MCP_URL || 'https://thethr0ne7.app.n8n.cloud/mcp-server/http';
const token = process.env.N8N_MCP_TOKEN;
const projectId = 'FP3HOvN6NpEDN0PB';
const network = JSON.parse(await fs.readFile('registry/agent-network.json', 'utf8'));
const blueprints = [
  ...(Array.isArray(network.seedBlueprints) ? network.seedBlueprints : []),
  ...(Array.isArray(network.generation2Blueprints) ? network.generation2Blueprints : []),
];

if (!token) throw new Error('N8N_MCP_TOKEN is required');
if (blueprints.length < 20) throw new Error(`Expected at least 20 operational blueprints; found ${blueprints.length}`);

function parsePayload(text, type = '') {
  if (!text.trim()) return null;
  if (type.includes('text/event-stream')) {
    const chunks = text.split(/\r?\n\r?\n/)
      .map((block) => block.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n'))
      .filter(Boolean);
    for (let i = chunks.length - 1; i >= 0; i -= 1) {
      try { return JSON.parse(chunks[i]); } catch {}
    }
    throw new Error('No JSON SSE payload');
  }
  return JSON.parse(text);
}

async function request(message) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(message),
  });
  const text = await response.text();
  const payload = parsePayload(text, response.headers.get('content-type') || '');
  if (!response.ok || payload?.error) throw new Error(`MCP failure ${response.status}: ${JSON.stringify(payload).slice(0, 1600)}`);
  return payload;
}

function structured(payload) {
  if (payload?.result?.structuredContent) return payload.result.structuredContent;
  const text = payload?.result?.content?.find?.((item) => item?.type === 'text')?.text;
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { text }; }
}

await request({
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'ai-factory-live-fleet-verifier', version: '2.4.0' } },
});
await request({ jsonrpc: '2.0', method: 'notifications/initialized' });
let rpcId = 2;
async function tool(name, args = {}) {
  return structured(await request({ jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name, arguments: args } }));
}

const results = [];
for (const blueprint of blueprints) {
  const search = await tool('search_agents', { projectId, query: blueprint.name, limit: 50 });
  const rows = Array.isArray(search?.data) ? search.data : (Array.isArray(search?.agents) ? search.agents : []);
  const exact = rows.filter((row) => row?.name === blueprint.name);
  if (exact.length !== 1) {
    results.push({ candidate_id: blueprint.candidateId, name: blueprint.name, present: false, matches: exact.length, valid: false });
    continue;
  }
  const agentId = exact[0]?.id || exact[0]?.agentId;
  const validation = agentId ? await tool('validate_agent', { agentId }) : null;
  results.push({
    candidate_id: blueprint.candidateId,
    name: blueprint.name,
    generation: blueprint.generation,
    runtime_agent_id: agentId || null,
    present: Boolean(agentId),
    matches: 1,
    valid: validation?.valid === true,
    missing: validation?.missing || [],
  });
}

const present = results.filter((x) => x.present).length;
const valid = results.filter((x) => x.valid).length;
const evidence = {
  checked_at: new Date().toISOString(),
  required_operational_agents: 20,
  blueprint_count: blueprints.length,
  present,
  valid,
  maintenance_automations_counted: false,
  maintenance_agents_counted: false,
  root_supervisor_counted: false,
  results,
};

await fs.mkdir('artifacts', { recursive: true });
await fs.writeFile('artifacts/live-agent-fleet.json', JSON.stringify(evidence, null, 2) + '\n');
console.log(`LIVE_AGENT_FLEET present=${present} valid=${valid} required=20 automations_counted=false`);
if (present < 20 || valid < 20) process.exitCode = 1;
