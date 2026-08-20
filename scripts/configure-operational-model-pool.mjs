import fs from 'node:fs/promises';

const endpoint = process.env.N8N_MCP_URL || 'https://thethr0ne7.app.n8n.cloud/mcp-server/http';
const token = process.env.N8N_MCP_TOKEN;
const projectId = 'FP3HOvN6NpEDN0PB';
const targetModel = 'groq/openai/gpt-oss-20b';
if (!token) throw new Error('N8N_MCP_TOKEN required');
const routing = JSON.parse(await fs.readFile('registry/agent-routing.json', 'utf8'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parse(text, type = '') {
  if (!text.trim()) return null;
  if (!type.includes('text/event-stream')) return JSON.parse(text);
  const chunks = text.split(/\r?\n\r?\n/)
    .map((block) => block.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n'))
    .filter(Boolean);
  for (let i = chunks.length - 1; i >= 0; i -= 1) {
    try { return JSON.parse(chunks[i]); } catch {}
  }
  throw new Error('No JSON SSE payload');
}

async function request(message, attempt = 0) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify(message),
  });
  const text = await response.text();
  let payload = null;
  try { payload = parse(text, response.headers.get('content-type') || ''); } catch { payload = { raw: text.slice(0, 1200) }; }
  if (response.status === 429 && attempt < 8) {
    const retryAfter = Number(response.headers.get('retry-after'));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(30000, retryAfter * 1000 + 500)
      : Math.min(30000, 2000 * (attempt + 1));
    console.log(`N8N_MCP_BACKOFF status=429 attempt=${attempt + 1} wait_ms=${waitMs}`);
    await sleep(waitMs);
    return request(message, attempt + 1);
  }
  if (!response.ok || payload?.error) throw new Error(`MCP ${response.status}: ${JSON.stringify(payload).slice(0, 1200)}`);
  await sleep(650);
  return payload;
}

function structured(payload) {
  if (payload?.result?.structuredContent) return payload.result.structuredContent;
  const text = payload?.result?.content?.find?.((item) => item?.type === 'text')?.text;
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { text }; }
}

await request({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'ai-factory-operational-model-pool', version: '1.1.0' } } });
await request({ jsonrpc: '2.0', method: 'notifications/initialized' });
let id = 2;
async function tool(name, args = {}) {
  return structured(await request({ jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name, arguments: args } }));
}

const members = Object.values(routing.cells).flatMap((cell) => [cell.lead, ...cell.specialists]);
if (members.length !== 20 || new Set(members.map((x) => x.candidateId)).size !== 20) {
  throw new Error(`Expected 20 unique operational members; got ${members.length}`);
}

// Resolve the fleet in one search to avoid a burst of 20 search requests against n8n MCP.
const fleet = await tool('search_agents', { projectId, limit: 100 });
const rows = Array.isArray(fleet?.data) ? fleet.data : (Array.isArray(fleet?.agents) ? fleet.agents : []);
const byName = new Map(rows.map((row) => [row?.name, row]));
const results = [];

for (const member of members) {
  const match = byName.get(member.name);
  if (!match) throw new Error(`Operational agent missing: ${member.name}`);
  const agentId = match.id || match.agentId;
  if (!agentId) throw new Error(`Agent id missing: ${member.name}`);

  const before = await tool('get_agent', { agentId });
  if (!before?.configHash || !before?.config) throw new Error(`Missing config for ${member.name}`);
  const current = before.config.model || '';
  let changed = false;

  if (current !== targetModel) {
    await tool('mutate_agent', {
      agentId,
      baseConfigHash: before.configHash,
      operation: { type: 'config.patch', patch: [{ op: current ? 'replace' : 'add', path: '/model', value: targetModel }] },
    });
    changed = true;
  }

  const validation = await tool('validate_agent', { agentId });
  if (validation?.valid !== true) throw new Error(`Model pool validation failed ${member.name}: ${JSON.stringify(validation).slice(0, 800)}`);
  results.push({ candidate_id: member.candidateId, agent_id: agentId, previous_model: current || null, model: targetModel, changed, valid: true });
  console.log(`OPERATIONAL_MODEL_MEMBER_OK candidate=${member.candidateId} changed=${changed}`);
}

await fs.mkdir('artifacts', { recursive: true });
await fs.writeFile('artifacts/operational-model-pool.json', JSON.stringify({
  checked_at: new Date().toISOString(),
  target_model: targetModel,
  count: results.length,
  results,
  publication_attempted: false,
  note: 'Draft configs only. Existing credentials are preserved. No agent was published.',
}, null, 2) + '\n');
console.log(`OPERATIONAL_MODEL_POOL_OK count=${results.length} model=${targetModel} valid=${results.every((x) => x.valid)} publication_attempted=false`);
