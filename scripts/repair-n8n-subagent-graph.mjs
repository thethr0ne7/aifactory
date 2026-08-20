import fs from 'node:fs/promises';

const endpoint = process.env.N8N_MCP_URL || 'https://thethr0ne7.app.n8n.cloud/mcp-server/http';
const token = process.env.N8N_MCP_TOKEN;
const projectId = 'FP3HOvN6NpEDN0PB';
const supervisorId = 'tjPdLV47rjFQFHOV';
if (!token) throw new Error('N8N_MCP_TOKEN is required');

const topology = {
  'AI Factory Nursery Supervisor': [
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

function parsePayload(text, type = '') {
  if (!text.trim()) return null;
  if (!type.includes('text/event-stream')) return JSON.parse(text);
  const chunks = text.split(/\r?\n\r?\n/).map((block) => block.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')).filter(Boolean);
  for (let i = chunks.length - 1; i >= 0; i -= 1) { try { return JSON.parse(chunks[i]); } catch {} }
  throw new Error('No JSON SSE payload');
}
async function request(message) {
  const response = await fetch(endpoint, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify(message) });
  const payload = parsePayload(await response.text(), response.headers.get('content-type') || '');
  if (!response.ok || payload?.error) throw new Error(`MCP ${response.status}: ${JSON.stringify(payload).slice(0, 1800)}`);
  return payload;
}
function structured(payload) {
  if (payload?.result?.structuredContent) return payload.result.structuredContent;
  const text = payload?.result?.content?.find?.((item) => item?.type === 'text')?.text;
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { text }; }
}
await request({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'ai-factory-subagent-graph-repair', version: '1.1.0' } } });
await request({ jsonrpc: '2.0', method: 'notifications/initialized' });
let rpcId = 2;
async function tool(name, args = {}) { return structured(await request({ jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name, arguments: args } })); }
await tool('get_agent_builder_reference', {});

async function findExactAgent(name) {
  if (name === 'AI Factory Nursery Supervisor') return { id: supervisorId, name };
  const payload = await tool('search_agents', { projectId, query: name, limit: 50 });
  const rows = Array.isArray(payload?.data) ? payload.data : (Array.isArray(payload?.agents) ? payload.agents : []);
  const exact = rows.filter((row) => row?.name === name);
  if (exact.length !== 1) throw new Error(`Expected exactly one agent named ${name}; found ${exact.length}`);
  return { id: exact[0].id || exact[0].agentId, name };
}
const names = new Set(Object.keys(topology));
for (const children of Object.values(topology)) for (const [name] of children) names.add(name);
const resolved = {};
for (const name of names) resolved[name] = await findExactAgent(name);

// n8n's MCP contract exposes native sub-agents as published assets. Do not publish implicitly.
const publishedPayload = await tool('search_agents', { projectId, publishedOnly: true, excludeAgentId: supervisorId, limit: 100 });
const publishedRows = Array.isArray(publishedPayload?.data) ? publishedPayload.data : (Array.isArray(publishedPayload?.agents) ? publishedPayload.agents : []);
const publishedIds = new Set(publishedRows.map((row) => row?.id || row?.agentId).filter(Boolean));
const requiredChildNames = [...new Set(Object.values(topology).flatMap((children) => children.map(([name]) => name)))];
const unpublishedRequired = requiredChildNames.filter((name) => !publishedIds.has(resolved[name].id));
if (unpublishedRequired.length) {
  const result = {
    checked_at: new Date().toISOString(),
    native_status: 'BLOCKED_BY_N8N_PUBLISHED_SUBAGENT_REQUIREMENT',
    required_child_count: requiredChildNames.length,
    published_eligible_count: requiredChildNames.length - unpublishedRequired.length,
    unpublished_required_names: unpublishedRequired,
    functional_fallback: 'Factory Message Bus / AF-HANDOFF/1',
    publication_attempted: false,
    reason: 'n8n search_agents/discover sub-agent contract exposes published sub-agents; Factory policy forbids implicit publication.',
  };
  await fs.mkdir('artifacts', { recursive: true });
  await fs.writeFile('artifacts/n8n-subagent-graph.json', JSON.stringify(result, null, 2) + '\n');
  console.log(`N8N_SUBAGENT_GRAPH_BLOCKED unpublished_required=${unpublishedRequired.length} publication_attempted=false fallback=AF-HANDOFF/1`);
  process.exit(0);
}

const parentSnapshots = new Map();
for (const parentName of Object.keys(topology)) {
  const snapshot = await tool('get_agent', { agentId: resolved[parentName].id });
  if (!snapshot?.configHash || !snapshot?.config) throw new Error(`Missing config/configHash for ${parentName}`);
  parentSnapshots.set(parentName, snapshot);
}
const modified = [];
async function rollback() {
  for (const parentName of modified.reverse()) {
    try {
      const current = await tool('get_agent', { agentId: resolved[parentName].id });
      if (!current?.configHash) continue;
      await tool('mutate_agent', { agentId: resolved[parentName].id, baseConfigHash: current.configHash, operation: { type: 'config.replace', config: parentSnapshots.get(parentName).config } });
    } catch (error) { console.error(`ROLLBACK_FAILED parent=${parentName} error=${String(error?.message || error).slice(0, 500)}`); }
  }
}
try {
  for (const [parentName, children] of Object.entries(topology)) {
    const before = parentSnapshots.get(parentName);
    const nextConfig = structuredClone(before.config);
    nextConfig.subAgents = { maxChildren: 4, agents: children.map(([childName, useWhen]) => ({ agentId: resolved[childName].id, useWhen })) };
    await tool('mutate_agent', { agentId: resolved[parentName].id, baseConfigHash: before.configHash, operation: { type: 'config.replace', config: nextConfig } });
    modified.push(parentName);
    const after = await tool('get_agent', { agentId: resolved[parentName].id });
    const actual = after?.config?.subAgents?.agents;
    if (!Array.isArray(actual) || actual.length !== 4) throw new Error(`Native subAgents did not persist for ${parentName}`);
    const expectedIds = new Set(children.map(([childName]) => resolved[childName].id));
    const actualIds = new Set(actual.map((row) => row?.agentId));
    if (expectedIds.size !== actualIds.size || [...expectedIds].some((id) => !actualIds.has(id))) throw new Error(`Native subAgents mismatch for ${parentName}`);
    const validation = await tool('validate_agent', { agentId: resolved[parentName].id });
    if (validation?.valid !== true) throw new Error(`Parent invalid after subAgent persistence ${parentName}: ${JSON.stringify(validation).slice(0, 1200)}`);
  }
} catch (error) { await rollback(); throw error; }
const verification = [];
for (const [parentName, children] of Object.entries(topology)) {
  const snapshot = await tool('get_agent', { agentId: resolved[parentName].id });
  verification.push({ parent: parentName, parent_agent_id: resolved[parentName].id, child_count: snapshot?.config?.subAgents?.agents?.length || 0, expected_children: children.map(([name]) => name), persisted: (snapshot?.config?.subAgents?.agents?.length || 0) === 4 });
}
await fs.mkdir('artifacts', { recursive: true });
await fs.writeFile('artifacts/n8n-subagent-graph.json', JSON.stringify({ checked_at: new Date().toISOString(), native_status: 'PERSISTED', verification, publication_attempted: false, root_of_trust_mutation_attempted: false }, null, 2) + '\n');
console.log(`N8N_SUBAGENT_GRAPH_OK parents=${verification.length} edges=${verification.reduce((n, x) => n + x.child_count, 0)} persisted=${verification.every((x) => x.persisted)}`);
