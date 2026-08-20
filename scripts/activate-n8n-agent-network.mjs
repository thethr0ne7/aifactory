import fs from 'node:fs/promises';

const endpoint = process.env.N8N_MCP_URL || 'https://thethr0ne7.app.n8n.cloud/mcp-server/http';
const token = process.env.N8N_MCP_TOKEN;
const projectId = 'FP3HOvN6NpEDN0PB';
const supervisorId = 'tjPdLV47rjFQFHOV';
if (!token) throw new Error('N8N_MCP_TOKEN is required');

const supervisorName = 'AI Factory Nursery Supervisor';
const topology = {
  [supervisorName]: [
    ['AI Factory Evidence Apprentice G1', 'Delegate evidence classification, provenance, truthfulness and freshness work.'],
    ['AI Factory Research Scout G1', 'Delegate bounded research, source discovery and synthesis work.'],
    ['AI Factory Builder Apprentice G1', 'Delegate bounded implementation, integration, testing and release planning.'],
    ['AI Factory Auditor Apprentice G1', 'Delegate independent security, contradiction, regression and authority audits.'],
  ],
  'AI Factory Evidence Apprentice G1': [
    ['AI Factory Source Verifier G2', 'Use for source provenance, authority and traceability verification.'],
    ['AI Factory Claim Classifier G2', 'Use for CONFIRMED/OBSERVED/ASSUMPTION/UNKNOWN/BLOCKER classification.'],
    ['AI Factory Provenance Analyst G2', 'Use for evidence lineage and orphan-claim detection.'],
    ['AI Factory Freshness Analyst G2', 'Use for stale-evidence and time-sensitive verification checks.'],
  ],
  'AI Factory Research Scout G1': [
    ['AI Factory Government Researcher G2', 'Use for laws, grants, budgets and public-sector research.'],
    ['AI Factory Market Researcher G2', 'Use for markets, competitors and demand signals.'],
    ['AI Factory Technical Researcher G2', 'Use for primary-source technical research and architecture evidence.'],
    ['AI Factory Synthesis Analyst G2', 'Use to reconcile multi-source evidence, contradictions and decision implications.'],
  ],
  'AI Factory Builder Apprentice G1': [
    ['AI Factory Runtime Engineer G2', 'Use for runtime, state-machine and execution-contract design.'],
    ['AI Factory Integration Engineer G2', 'Use for connector, MCP, auth-boundary and integration design.'],
    ['AI Factory Test Engineer G2', 'Use for deterministic regression, failure injection and acceptance coverage.'],
    ['AI Factory Release Engineer G2', 'Use for bounded release, rollback and executed-proof requirements.'],
  ],
  'AI Factory Auditor Apprentice G1': [
    ['AI Factory Security Reviewer G2', 'Use for permissions, secrets and authority-expansion security review.'],
    ['AI Factory Contradiction Auditor G2', 'Use to find contradictions, unsupported assumptions and evidence gaps.'],
    ['AI Factory Regression Auditor G2', 'Use to verify baselines, regressions and repair evidence.'],
    ['AI Factory Policy Authority Auditor G2', 'Use to enforce autonomy, approval and Root-of-Trust boundaries.'],
  ],
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function parsePayload(text, type = '') {
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
async function request(message) {
  let last = null;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify(message),
    });
    const raw = await response.text();
    if (response.status === 429) {
      last = new Error(`MCP 429: ${raw.slice(0, 500)}`);
      await sleep(Math.min(15000, 1200 * (2 ** (attempt - 1))));
      continue;
    }
    const payload = parsePayload(raw, response.headers.get('content-type') || '');
    if (!response.ok || payload?.error) throw new Error(`MCP ${response.status}: ${JSON.stringify(payload).slice(0, 1600)}`);
    await sleep(250);
    return payload;
  }
  throw last || new Error('MCP retry budget exhausted');
}
function structured(payload) {
  if (payload?.result?.structuredContent) return payload.result.structuredContent;
  const text = payload?.result?.content?.find?.((item) => item?.type === 'text')?.text;
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { text }; }
}

await request({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'ai-factory-network-activation', version: '1.0.0' } } });
await request({ jsonrpc: '2.0', method: 'notifications/initialized' });
let rpcId = 2;
async function tool(name, args = {}) {
  return structured(await request({ jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name, arguments: args } }));
}

async function findExactAgent(name) {
  if (name === supervisorName) return { id: supervisorId, name };
  const payload = await tool('search_agents', { projectId, query: name, limit: 50 });
  const rows = Array.isArray(payload?.data) ? payload.data : (Array.isArray(payload?.agents) ? payload.agents : []);
  const exact = rows.filter((row) => row?.name === name);
  if (exact.length !== 1) throw new Error(`Expected exactly one agent named ${name}; found ${exact.length}`);
  const id = exact[0]?.id || exact[0]?.agentId;
  if (!id) throw new Error(`Agent ${name} has no id`);
  return { id, name };
}

const names = new Set(Object.keys(topology));
for (const children of Object.values(topology)) for (const [name] of children) names.add(name);
const resolved = {};
for (const name of names) resolved[name] = await findExactAgent(name);

let publishedPayload = await tool('search_agents', { projectId, publishedOnly: true, limit: 100 });
let publishedRows = Array.isArray(publishedPayload?.data) ? publishedPayload.data : (Array.isArray(publishedPayload?.agents) ? publishedPayload.agents : []);
const publishedIds = new Set(publishedRows.map((row) => row?.id || row?.agentId).filter(Boolean));
const publicationEvents = [];

async function validate(name) {
  const id = resolved[name].id;
  const result = await tool('validate_agent', { agentId: id });
  if (result?.valid !== true) throw new Error(`Agent invalid before publication ${name}: ${JSON.stringify(result).slice(0, 1200)}`);
}
async function publish(name, force = false) {
  const id = resolved[name].id;
  await validate(name);
  if (force || !publishedIds.has(id)) {
    const result = await tool('publish_agent', { agentId: id });
    publishedIds.add(id);
    publicationEvents.push({ name, agent_id: id, republished: force, result_observed: Boolean(result) });
  }
}
async function attach(parentName) {
  const parent = resolved[parentName];
  const children = topology[parentName];
  const before = await tool('get_agent', { agentId: parent.id });
  if (!before?.configHash || !before?.config) throw new Error(`Missing draft config for ${parentName}`);
  const nextConfig = structuredClone(before.config);
  nextConfig.subAgents = {
    maxChildren: Math.min(20, Math.max(4, children.length)),
    agents: children.map(([childName, useWhen]) => ({ agentId: resolved[childName].id, useWhen })),
  };
  await tool('mutate_agent', { agentId: parent.id, baseConfigHash: before.configHash, operation: { type: 'config.replace', config: nextConfig } });
  const after = await tool('get_agent', { agentId: parent.id });
  const actual = after?.config?.subAgents?.agents;
  if (!Array.isArray(actual) || actual.length !== children.length) throw new Error(`subAgents did not persist for ${parentName}`);
  const expectedIds = new Set(children.map(([childName]) => resolved[childName].id));
  const actualIds = new Set(actual.map((row) => row?.agentId));
  if (expectedIds.size !== actualIds.size || [...expectedIds].some((id) => !actualIds.has(id))) throw new Error(`subAgents mismatch for ${parentName}`);
  await validate(parentName);
  return { parent: parentName, parent_agent_id: parent.id, child_count: actual.length, child_ids: [...actualIds] };
}

// Publish G2 leaves first so n8n accepts them as native sub-agents.
const g2Names = [...new Set(Object.entries(topology).filter(([parent]) => parent !== supervisorName).flatMap(([, children]) => children.map(([name]) => name)))];
for (const name of g2Names) await publish(name, false);

// Attach G2 to each G1 and publish the resulting G1 draft version.
const graph = [];
const g1Names = topology[supervisorName].map(([name]) => name);
for (const name of g1Names) {
  graph.push(await attach(name));
  await publish(name, true);
}

// Attach the four published G1 leads to the Supervisor and publish the complete root graph.
graph.push(await attach(supervisorName));
await publish(supervisorName, true);

publishedPayload = await tool('search_agents', { projectId, publishedOnly: true, limit: 100 });
publishedRows = Array.isArray(publishedPayload?.data) ? publishedPayload.data : (Array.isArray(publishedPayload?.agents) ? publishedPayload.agents : []);
const finalPublishedIds = new Set(publishedRows.map((row) => row?.id || row?.agentId).filter(Boolean));
const operationalNames = [...names].filter((name) => name !== supervisorName);
const missingPublished = operationalNames.filter((name) => !finalPublishedIds.has(resolved[name].id));
if (missingPublished.length) throw new Error(`Published network incomplete: ${missingPublished.join(', ')}`);
if (!finalPublishedIds.has(supervisorId)) throw new Error('Supervisor is not published after graph activation');

const result = {
  checked_at: new Date().toISOString(),
  status: 'ACTIVE',
  operational_agents: operationalNames.length,
  supervisor_published: true,
  published_operational_agents: operationalNames.length - missingPublished.length,
  parent_count: graph.length,
  native_subagent_edges: graph.reduce((sum, row) => sum + row.child_count, 0),
  graph,
  publication_events: publicationEvents.length,
  external_integration_added: false,
  production_write_authority_added: false,
  root_of_trust_mutation_attempted: false,
};
await fs.mkdir('artifacts', { recursive: true });
await fs.writeFile('artifacts/n8n-agent-network-activation.json', JSON.stringify(result, null, 2) + '\n');
console.log(`N8N_AGENT_NETWORK_ACTIVE operational=${result.published_operational_agents} supervisor_published=true parents=${result.parent_count} edges=${result.native_subagent_edges}`);
