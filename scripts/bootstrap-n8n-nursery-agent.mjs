import fs from 'node:fs/promises';

const endpoint = process.env.N8N_MCP_URL || 'https://thethr0ne7.app.n8n.cloud/mcp-server/http';
const token = process.env.N8N_MCP_TOKEN;
const agentName = 'AI Factory Nursery Supervisor';

if (!token) throw new Error('N8N_MCP_TOKEN is required');

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
    throw new Error('MCP returned SSE without JSON data');
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
  const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(message) });
  const text = await response.text();
  const contentType = response.headers.get('content-type') || '';
  const payload = parsePayload(text, contentType);
  if (!response.ok) throw new Error(`MCP HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 1200)}`);
  return { payload, sessionId: response.headers.get('mcp-session-id') || sessionId || null };
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

let init;
let initError;
for (const protocolVersion of ['2025-06-18', '2025-03-26', '2024-11-05']) {
  try {
    const candidate = await request({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion, capabilities: {}, clientInfo: { name: 'ai-factory-nursery-bootstrap', version: '2.4.0' } },
    });
    if (candidate.payload?.error) continue;
    init = candidate;
    break;
  } catch (error) { initError = error; }
}
if (!init) throw initError || new Error('Unable to initialize n8n MCP');

const sessionId = init.sessionId;
await request({ jsonrpc: '2.0', method: 'notifications/initialized' }, sessionId);
let nextId = 2;
async function callTool(name, args = {}) {
  const response = await request({
    jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args },
  }, sessionId);
  if (response.payload?.error) throw new Error(`${name} failed: ${JSON.stringify(response.payload.error)}`);
  return response.payload;
}

const projectsPayload = await callTool('search_projects', { limit: 50 });
const projects = structured(projectsPayload)?.data || [];
const personalProjects = projects.filter((project) => project.type === 'personal');
if (personalProjects.length !== 1) {
  throw new Error(`Expected exactly one personal n8n project; found ${personalProjects.length}`);
}
const projectId = personalProjects[0].id;

const agentsPayload = await callTool('search_agents', { projectId, query: agentName, limit: 50 });
const agents = structured(agentsPayload)?.data || [];
const existing = agents.find((agent) => agent.name === agentName) || null;
let createdThisRun = false;
let agentId = existing?.id || existing?.agentId || null;
let createResult = null;

if (!agentId) {
  const createPayload = await callTool('create_agent', {
    projectId,
    name: agentName,
    config: {
      model: '',
      instructions: [
        'You are the bounded AI Factory Nursery Supervisor.',
        'Create, compare, repair and prepare candidate agents for evaluation, but never publish or self-promote them.',
        'Treat AI Factory Root of Trust, autonomy ceilings, evidence gates, negative actions and production authority as immutable external constraints.',
        'Never expand secret scope or production write authority. Never hide failed regressions.',
        'Use baseline-versus-candidate evaluation and preserve provenance for every recommendation.',
        'When a required model credential or authority is missing, stop at a draft/blocker and report exactly what is missing.',
      ].join(' '),
    },
  });
  createResult = structured(createPayload);
  agentId = findKey(createResult, 'agentId') || findKey(createResult, 'id');
  if (!agentId) throw new Error(`create_agent returned no agent id: ${JSON.stringify(createResult).slice(0, 1200)}`);
  createdThisRun = true;
}

const agentSnapshot = structured(await callTool('get_agent', { agentId }));
let configHash = findKey(agentSnapshot, 'configHash');
if (!configHash) throw new Error('get_agent returned no configHash for draft agent');

let skillResult = null;
if (createdThisRun) {
  const skillPayload = await callTool('mutate_agent', {
    agentId,
    baseConfigHash: configHash,
    operation: {
      type: 'skill.upsert',
      skill: {
        name: 'Factory Nursery Governance',
        description: 'Bounded lifecycle rules for creating and evaluating AI Factory candidate agents.',
        instructions: [
          'Candidate lifecycle: DRAFT -> SPAWNED -> TRAINING -> EVALUATING -> CANDIDATE or REPAIRING/REJECTED/QUARANTINED.',
          'Automatic production promotion is forbidden.',
          'Maximum nursery autonomy without explicit owner promotion is A3.',
          'Root of Trust mutation, self-raised autonomy, silent tool/secret expansion and hidden regression failures are forbidden.',
          'A promotion recommendation requires provenance, baseline comparison, regression evidence, safety compliance, evidence honesty and rollback readiness.',
        ].join(' '),
        allowedTools: [],
      },
    },
  });
  skillResult = structured(skillPayload);
  configHash = findKey(skillResult, 'configHash') || configHash;
}

const validation = structured(await callTool('validate_agent', { agentId }));
const validationCallOk = Boolean(validation?.ok ?? false);
const validationValid = Boolean(validation?.valid ?? false);
const editorUrl = findKey(validation, 'url') || findKey(createResult, 'url') || null;

const result = {
  checked_at: new Date().toISOString(),
  endpoint,
  project_id: projectId,
  agent_name: agentName,
  agent_id: agentId,
  created_this_run: createdThisRun,
  skill_created_this_run: Boolean(skillResult),
  validation_call_ok: validationCallOk,
  validation_valid: validationValid,
  validation,
  editor_url: editorUrl,
  publication_attempted: false,
  preview_execution_attempted: false,
  authority_note: 'Draft bootstrap only. No publish_agent, call_agent, workflow execution, integration connection, or production activation.',
};

await fs.mkdir('artifacts', { recursive: true });
await fs.writeFile('artifacts/n8n-nursery-agent-bootstrap.json', JSON.stringify(result, null, 2) + '\n');

console.log(`N8N_NURSERY_AGENT_BOOTSTRAP_OK agent_id=${agentId} created=${createdThisRun} validation_call_ok=${validationCallOk} validation_valid=${validationValid}`);
if (editorUrl) console.log(`Agent editor: ${editorUrl}`);
if (!validationValid) console.log(`Draft exists but is not runnable yet; missing=${JSON.stringify(validation?.missing || [])}`);
