import fs from 'node:fs/promises';

const endpoint = process.env.N8N_MCP_URL || 'https://thethr0ne7.app.n8n.cloud/mcp-server/http';
const token = process.env.N8N_MCP_TOKEN;
const projectId = 'FP3HOvN6NpEDN0PB';
const model = 'groq/openai/gpt-oss-120b';
const preferredCredentialName = 'AI Factory n8n';
const network = JSON.parse(await fs.readFile('registry/agent-network.json', 'utf8'));
const blueprints = Array.isArray(network.generation2Blueprints) ? network.generation2Blueprints : [];

if (!token) throw new Error('N8N_MCP_TOKEN is required');
if (blueprints.length !== 16) throw new Error(`Generation 2 requires exactly 16 draft blueprints; found ${blueprints.length}`);

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

function findKey(value, key) {
  if (!value || typeof value !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(value, key) && value[key] != null) return value[key];
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    const found = findKey(child, key);
    if (found != null) return found;
  }
  return null;
}

await request({
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'ai-factory-generation2-drafts', version: '2.4.0' } },
});
await request({ jsonrpc: '2.0', method: 'notifications/initialized' });
let rpcId = 2;
async function tool(name, args = {}) {
  return structured(await request({ jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name, arguments: args } }));
}

const credentialPayload = await tool('list_credentials', { projectId, limit: 200 });
const credentials = Array.isArray(credentialPayload?.data) ? credentialPayload.data : [];
const groqCredentials = credentials.filter((row) => /groq/i.test(String(row?.type || '')));
const exact = groqCredentials.filter((row) => row?.name === preferredCredentialName);
let credential = null;
let credentialSelectionRule = null;
if (exact.length === 1) {
  credential = exact[0];
  credentialSelectionRule = 'preferred_exact_name';
} else if (exact.length > 1) {
  throw new Error(`Multiple Groq credentials named ${preferredCredentialName}; refusing to guess`);
} else if (groqCredentials.length === 1) {
  credential = groqCredentials[0];
  credentialSelectionRule = 'only_accessible_groq_credential';
} else {
  throw new Error(`Expected one unambiguous Groq credential; found ${groqCredentials.length}`);
}
if (!credential?.id) throw new Error('Selected Groq credential has no id');

const results = [];
for (const blueprint of blueprints) {
  const search = await tool('search_agents', { projectId, query: blueprint.name, limit: 50 });
  const rows = Array.isArray(search?.data) ? search.data : (Array.isArray(search?.agents) ? search.agents : []);
  const exactRows = rows.filter((row) => row?.name === blueprint.name);
  if (exactRows.length > 1) throw new Error(`Duplicate n8n agents detected for ${blueprint.name}`);

  let agentId = exactRows[0]?.id || exactRows[0]?.agentId || null;
  let created = false;
  const instructions = [
    `You are ${blueprint.name}, a bounded Generation 2 ${blueprint.role} specialist in AI Factory.`,
    blueprint.mission,
    'Your autonomy is A2. You have no tools during initial training.',
    'Never invent current state, sources, tool results, credentials, completed work or authority.',
    'Never mutate Root of Trust, self-promote, expand production write authority, expand secret scope, or bypass human promotion review.',
    `Your intended parent cell is ${blueprint.parentRefs?.[0] || 'UNKNOWN'}, but network attachment is not assumed until separately verified.`,
  ].join(' ');

  if (!agentId) {
    const createdPayload = await tool('create_agent', {
      projectId,
      name: blueprint.name,
      config: {
        model,
        credential: credential.id,
        instructions,
        tools: [],
        memory: { enabled: true, storage: 'n8n' },
        config: { reasoning: 'medium', toolCallConcurrency: 1 },
      },
    });
    agentId = findKey(createdPayload, 'agentId') || findKey(createdPayload, 'id');
    if (!agentId) throw new Error(`create_agent returned no id for ${blueprint.name}`);
    created = true;
  }

  const before = await tool('get_agent', { agentId });
  const configHash = findKey(before, 'configHash');
  if (!configHash) throw new Error(`configHash missing for ${blueprint.name}`);

  await tool('mutate_agent', {
    agentId,
    baseConfigHash: configHash,
    operation: {
      type: 'skill.upsert',
      skill: {
        name: `${blueprint.role} Discipline G2`,
        description: `Bounded Generation 2 discipline for ${blueprint.role}.`,
        instructions: `${blueprint.mission} Preserve evidence labels and uncertainty. Refuse unsupported success claims and authority escalation. Do not call tools during initial training.`,
        allowedTools: [],
      },
    },
  });

  const validation = await tool('validate_agent', { agentId });
  if (validation?.valid !== true) throw new Error(`Validation failed for ${blueprint.name}: ${JSON.stringify(validation).slice(0, 1200)}`);

  results.push({
    candidate_id: blueprint.candidateId,
    name: blueprint.name,
    role: blueprint.role,
    intended_parent: blueprint.parentRefs?.[0] || null,
    runtime_agent_id: agentId,
    created,
    valid: true,
    state: 'TRAINING',
    autonomy_level: 'A2',
    tools: [],
    publication_attempted: false,
    production_authority_granted: false,
    root_of_trust_mutation_attempted: false,
  });
}

await fs.mkdir('artifacts', { recursive: true });
await fs.writeFile('artifacts/generation2-drafts.json', JSON.stringify({
  checked_at: new Date().toISOString(),
  model,
  credential_type: credential.type || null,
  credential_selection_rule: credentialSelectionRule,
  expected_generation2: 16,
  created_or_reconciled: results.length,
  network_attachment_claimed: false,
  publication_attempted: false,
  production_authority_granted: false,
  results,
}, null, 2) + '\n');

console.log(`GENERATION2_DRAFTS_OK count=${results.length} created=${results.filter((x) => x.created).length} reconciled=${results.filter((x) => !x.created).length} attachment_claimed=false`);
