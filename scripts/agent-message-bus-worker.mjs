import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const endpoint = process.env.N8N_MCP_URL || 'https://thethr0ne7.app.n8n.cloud/mcp-server/http';
const token = process.env.N8N_MCP_TOKEN;
const workerId = process.env.FACTORY_BUS_WORKER_ID || `github-${process.env.GITHUB_RUN_ID || crypto.randomUUID()}`;
const maxClaims = Math.min(4, Math.max(1, Number(process.env.FACTORY_BUS_MAX_CLAIMS || 4)));
const projectId = 'FP3HOvN6NpEDN0PB';
const model = 'groq/openai/gpt-oss-120b';
const preferredCredentialName = 'AI Factory n8n';
if (!supabaseUrl || !serviceKey) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required');
if (!token) throw new Error('N8N_MCP_TOKEN required');

const routing = JSON.parse(await fs.readFile('registry/agent-routing.json', 'utf8'));
const network = JSON.parse(await fs.readFile('registry/agent-network.json', 'utf8'));

const dbHeaders = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json',
};

async function db(path, { method = 'GET', body, prefer } = {}) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    method,
    headers: { ...dbHeaders, ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase ${method} ${path} ${response.status}: ${text.slice(0, 1600)}`);
  return text ? JSON.parse(text) : null;
}

async function rpc(name, body) {
  return db(`rpc/${name}`, { method: 'POST', body });
}

function parsePayload(text, type = '') {
  if (!text.trim()) return null;
  if (!type.includes('text/event-stream')) return JSON.parse(text);
  const chunks = text.split(/\r?\n\r?\n/)
    .map((block) => block.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n'))
    .filter(Boolean);
  for (let i = chunks.length - 1; i >= 0; i -= 1) { try { return JSON.parse(chunks[i]); } catch {} }
  throw new Error('No JSON SSE payload');
}

async function mcpRequest(message) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify(message),
  });
  const payload = parsePayload(await response.text(), response.headers.get('content-type') || '');
  if (!response.ok || payload?.error) throw new Error(`MCP ${response.status}: ${JSON.stringify(payload).slice(0, 1600)}`);
  return payload;
}
function structured(payload) {
  if (payload?.result?.structuredContent) return payload.result.structuredContent;
  const text = payload?.result?.content?.find?.((item) => item?.type === 'text')?.text;
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { text }; }
}
function flattenStrings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((x) => flattenStrings(x, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((x) => flattenStrings(x, out));
  return out;
}

await mcpRequest({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'ai-factory-message-bus', version: '1.0.0' } } });
await mcpRequest({ jsonrpc: '2.0', method: 'notifications/initialized' });
let rpcId = 2;
async function tool(name, args = {}) {
  return structured(await mcpRequest({ jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name, arguments: args } }));
}

const agentCache = new Map();
async function resolveAgent(name) {
  if (agentCache.has(name)) return agentCache.get(name);
  const payload = await tool('search_agents', { projectId, query: name, limit: 50 });
  const rows = Array.isArray(payload?.data) ? payload.data : (Array.isArray(payload?.agents) ? payload.agents : []);
  const exact = rows.filter((row) => row?.name === name);
  if (exact.length !== 1) throw new Error(`Expected exactly one n8n agent ${name}; found ${exact.length}`);
  const row = { id: exact[0].id || exact[0].agentId, name };
  if (!row.id) throw new Error(`n8n agent ${name} has no id`);
  agentCache.set(name, row);
  return row;
}

async function callAgent(name, prompt) {
  const agent = await resolveAgent(name);
  const payload = await tool('call_agent', { agentId: agent.id, request: { type: 'message', message: prompt } });
  const text = flattenStrings(payload).join('\n').trim();
  if (!text) throw new Error(`Empty response from ${name}`);
  return { agent, text: text.slice(0, 12000) };
}

function existingStateRank(state) {
  return ['DRAFT','SPAWNED','TRAINING','EVALUATING','REPAIRING','CANDIDATE','PROMOTED'].indexOf(state);
}

async function syncDirectory() {
  const blueprints = [...(network.seedBlueprints || []), ...(network.generation2Blueprints || [])];
  const rows = [{ candidateId: 'nursery-supervisor-g0', name: 'AI Factory Nursery Supervisor', generation: 0, role: 'nursery-supervisor', autonomyLevel: 'A3', parentRefs: [] }, ...blueprints.map((x) => ({
    candidateId: x.candidateId, name: x.name, generation: x.generation, role: x.role, autonomyLevel: x.autonomyLevel || 'A2', parentRefs: x.parentRefs || [], skills: x.skills || [], tools: x.tools || [], mission: x.mission,
  }))];

  for (const item of rows) {
    const agent = item.candidateId === 'nursery-supervisor-g0' ? { id: 'tjPdLV47rjFQFHOV' } : await resolveAgent(item.name);
    const current = await db(`af_agent_candidates?candidate_id=eq.${encodeURIComponent(item.candidateId)}&select=state`);
    const observedDefault = item.candidateId === 'evidence-apprentice-g1' ? 'PROMOTED' : 'SPAWNED';
    const currentState = current?.[0]?.state;
    const state = existingStateRank(currentState) >= existingStateRank(observedDefault) ? currentState : observedDefault;
    await db('af_agent_candidates?on_conflict=candidate_id', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: {
        candidate_id: item.candidateId,
        n8n_agent_id: agent.id,
        name: item.name,
        generation: item.generation,
        role: item.role,
        state,
        autonomy_level: item.autonomyLevel,
        parent_refs: item.parentRefs,
        skills: item.skills || [],
        tools: item.tools || [],
        model: { provider: 'groq', id: 'openai/gpt-oss-120b' },
        mutation_summary: item.mission || null,
        provenance: { source: 'agent-message-bus-worker', runtime: 'n8n', evidence: 'live search_agents exact match' },
        metadata: { communication_transport: 'af_agent_messages' },
        updated_at: new Date().toISOString(),
      },
    });
  }

  for (const item of rows.filter((x) => x.candidateId !== 'nursery-supervisor-g0')) {
    const parents = item.parentRefs || [];
    for (const parent of parents) {
      await db('af_agent_relationships?on_conflict=parent_candidate_id,child_candidate_id,relation_type', {
        method: 'POST',
        prefer: 'resolution=merge-duplicates,return=minimal',
        body: {
          parent_candidate_id: parent,
          child_candidate_id: item.candidateId,
          relation_type: item.generation === 1 ? 'SUPERVISOR' : 'PARENT',
          use_when: 'Durable Factory Message Bus routing relationship. Native n8n subAgent attachment is not required for delivery.',
          active: true,
          provenance: { source: 'registry/agent-network.json', transport: 'af_agent_messages' },
        },
      });
    }
  }
}

async function getEvidence(correlationId) {
  const rows = await db(`af_shared_evidence?correlation_id=eq.${encodeURIComponent(correlationId)}&select=id,stage,evidence_class,producer_agent_ref,claim,payload,created_at&order=created_at.asc&limit=60`);
  return Array.isArray(rows) ? rows : [];
}

function evidenceDigest(rows) {
  return rows.slice(-30).map((row) => {
    const response = String(row?.payload?.response || row?.claim || '').replace(/\s+/g, ' ').slice(0, 900);
    return `[${row.stage}/${row.evidence_class}/${row.producer_agent_ref}] ${response}`;
  }).join('\n');
}

async function recordEvidence({ correlationId, messageId, producer, stage, evidenceClass, claim, response, sourceRefs = [] }) {
  const rows = await db('af_shared_evidence', {
    method: 'POST', prefer: 'return=representation', body: {
      correlation_id: correlationId, message_id: messageId, producer_agent_ref: producer, stage,
      evidence_class: evidenceClass, claim, source_refs: sourceRefs, payload: { response },
    },
  });
  return rows?.[0]?.id || null;
}

async function enqueue({ correlationId, causationId, from, to, kind = 'HANDOFF', stage, payload, priority = 100 }) {
  const rows = await db('af_agent_messages', {
    method: 'POST', prefer: 'return=representation', body: {
      correlation_id: correlationId, causation_id: causationId || null, from_agent_ref: from, to_agent_ref: to,
      kind, stage, payload, status: 'QUEUED', priority, max_attempts: 3,
    },
  });
  return rows?.[0];
}

function stagePrompt({ stage, objective, correlationId, prior, role, isLead, specialistReports, candidateSeed }) {
  const base = [
    'Protocol=AF-HANDOFF/1.',
    `Correlation=${correlationId}. Stage=${stage}.`,
    `Objective=${objective}`,
    'Root of Trust, autonomy ceilings, evidence gates and production authority are immutable. Do not claim tools or evidence you do not have.',
    'This is an internal bounded architecture/evidence task. No external side effects are requested.',
  ];
  if (candidateSeed) base.push(`Candidate seed=${JSON.stringify(candidateSeed)}`);
  if (prior) base.push(`Prior shared evidence:\n${prior}`);
  if (!isLead) {
    base.push(`Act only as ${role}. Produce one compact specialist report. First line exactly SPECIALIST_RESULT=READY. Explicitly label assumptions/unknowns and identify blockers.`);
  } else {
    base.push(`Specialist reports:\n${specialistReports}`);
    base.push(`Act as the ${stage} cell lead. First line exactly ${stage}_GATE=PASS unless a concrete safety/evidence blocker requires ${stage}_GATE=BLOCK. Synthesize the reports and produce the handoff to the next cell.`);
    if (stage === 'BUILD') {
      base.push('If PASS, design the bounded draft child described by the candidate seed and include exact lines CANDIDATE_ID=..., CANDIDATE_NAME=..., CANDIDATE_ROLE=..., then MISSION=... . Keep A2, zero initial tools, no publication, no production-write authority.');
    }
    if (stage === 'AUDIT') {
      base.push('Audit the proposed child for security, contradictions, regression/evaluation requirements and authority boundaries. PASS only if it is safe to SPAWN AS AN UNPUBLISHED A2 DRAFT with zero tools. PASS is not promotion or publication.');
    }
  }
  return base.join('\n\n');
}

async function processStage(message) {
  const cell = routing.cells?.[message.stage];
  if (!cell) throw new Error(`No routing cell for ${message.stage}`);
  const objective = message.payload?.objective;
  if (!objective) throw new Error('Message objective missing');
  const priorRows = await getEvidence(message.correlation_id);
  const prior = evidenceDigest(priorRows);
  const candidateSeed = message.payload?.candidate_seed || null;

  const specialistResults = await Promise.all(cell.specialists.map(async (spec) => {
    const result = await callAgent(spec.name, stagePrompt({ stage: message.stage, objective, correlationId: message.correlation_id, prior, role: spec.candidateId, isLead: false, candidateSeed }));
    const evidenceId = await recordEvidence({ correlationId: message.correlation_id, messageId: message.id, producer: spec.candidateId, stage: message.stage, evidenceClass: 'OBSERVED', claim: `${message.stage} specialist report`, response: result.text });
    return { ...spec, response: result.text, evidenceId };
  }));

  const specialistReports = specialistResults.map((x) => `[${x.candidateId}] ${x.response.slice(0, 1800)}`).join('\n\n');
  const leadResult = await callAgent(cell.lead.name, stagePrompt({ stage: message.stage, objective, correlationId: message.correlation_id, prior, role: cell.lead.candidateId, isLead: true, specialistReports, candidateSeed }));
  const leadEvidenceId = await recordEvidence({ correlationId: message.correlation_id, messageId: message.id, producer: cell.lead.candidateId, stage: message.stage, evidenceClass: 'DERIVED', claim: `${message.stage} cell lead handoff`, response: leadResult.text, sourceRefs: specialistResults.map((x) => x.evidenceId).filter(Boolean) });
  const passMarker = `${message.stage}_GATE=PASS`;
  const gateStatus = leadResult.text.includes(passMarker) ? 'PASS' : 'BLOCK';
  const nextStage = cell.next;
  const nextCell = routing.cells?.[nextStage];
  const toRef = nextCell?.lead?.candidateId || 'nursery-supervisor-g0';

  await db('af_agent_handoffs', { method: 'POST', prefer: 'return=minimal', body: {
    correlation_id: message.correlation_id, from_stage: message.stage, to_stage: nextStage,
    from_agent_ref: cell.lead.candidateId, to_agent_ref: toRef, message_id: message.id,
    evidence_refs: [...specialistResults.map((x) => x.evidenceId), leadEvidenceId].filter(Boolean), gate_status: gateStatus,
    summary: { pass_marker: passMarker, lead_response: leadResult.text.slice(0, 4000) },
  } });

  if (gateStatus !== 'PASS') {
    await db(`af_agent_messages?id=eq.${message.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'BLOCKED', result: { gate: gateStatus, lead: leadResult.text.slice(0, 4000) }, locked_at: null, locked_by: null, updated_at: new Date().toISOString() } });
    return { status: 'BLOCKED', stage: message.stage };
  }

  await enqueue({
    correlationId: message.correlation_id, causationId: message.id, from: cell.lead.candidateId, to: toRef,
    kind: nextStage === 'BIRTH' ? 'BIRTH_PROPOSAL' : 'HANDOFF', stage: nextStage,
    payload: { ...message.payload, previous_stage: message.stage, previous_lead_evidence_id: leadEvidenceId }, priority: message.priority,
  });
  const completed = await rpc('af_bus_complete', { p_message_id: message.id, p_worker: workerId, p_result: { gate: gateStatus, next_stage: nextStage, lead_evidence_id: leadEvidenceId } });
  if (completed !== true) throw new Error(`Failed to complete claimed message ${message.id}`);
  return { status: 'DELIVERED', stage: message.stage, nextStage };
}

async function selectGroqCredential() {
  const payload = await tool('list_credentials', { projectId, limit: 200 });
  const credentials = Array.isArray(payload?.data) ? payload.data : [];
  const groq = credentials.filter((row) => /groq/i.test(String(row?.type || '')));
  const exact = groq.filter((row) => row?.name === preferredCredentialName);
  if (exact.length === 1) return exact[0];
  if (groq.length === 1) return groq[0];
  throw new Error(`Expected one unambiguous Groq credential; found ${groq.length}`);
}

function parseCandidateMarkers(text, fallback) {
  const get = (key) => text.match(new RegExp(`(?:^|\\n)${key}=([^\\n]+)`))?.[1]?.trim();
  return {
    candidateId: get('CANDIDATE_ID') || fallback.candidateId,
    name: get('CANDIDATE_NAME') || fallback.name,
    role: get('CANDIDATE_ROLE') || fallback.role,
    mission: get('MISSION') || fallback.mission,
  };
}

async function processBirth(message) {
  const evidence = await getEvidence(message.correlation_id);
  const auditLead = [...evidence].reverse().find((x) => x.stage === 'AUDIT' && x.producer_agent_ref === 'auditor-apprentice-g1');
  const buildLead = [...evidence].reverse().find((x) => x.stage === 'BUILD' && x.producer_agent_ref === 'builder-apprentice-g1');
  if (!auditLead || !String(auditLead?.payload?.response || '').includes('AUDIT_GATE=PASS')) throw new Error('Birth requires durable AUDIT_GATE=PASS evidence');
  if (!buildLead) throw new Error('Birth requires BUILD lead evidence');
  const fallback = message.payload?.candidate_seed;
  if (!fallback?.candidateId || !fallback?.name || !fallback?.role || !fallback?.mission) throw new Error('Bounded candidate seed missing');
  const candidate = parseCandidateMarkers(String(buildLead.payload?.response || ''), fallback);
  if (!/^[a-z0-9][a-z0-9-]{2,80}$/.test(candidate.candidateId)) throw new Error(`Invalid candidate id ${candidate.candidateId}`);

  const existingProposal = await db(`af_agent_birth_proposals?correlation_id=eq.${message.correlation_id}&proposed_candidate_id=eq.${encodeURIComponent(candidate.candidateId)}&select=*`);
  let agentId = existingProposal?.[0]?.n8n_agent_id || null;
  if (!agentId) {
    const search = await tool('search_agents', { projectId, query: candidate.name, limit: 50 });
    const rows = Array.isArray(search?.data) ? search.data : (Array.isArray(search?.agents) ? search.agents : []);
    const exact = rows.filter((row) => row?.name === candidate.name);
    if (exact.length > 1) throw new Error(`Duplicate synergy child name ${candidate.name}`);
    agentId = exact[0]?.id || exact[0]?.agentId || null;
  }

  await db('af_agent_birth_proposals?on_conflict=correlation_id,proposed_candidate_id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: {
    correlation_id: message.correlation_id, proposed_candidate_id: candidate.candidateId, proposed_name: candidate.name,
    proposed_role: candidate.role, generation: 3, autonomy_level: 'A2',
    parent_refs: ['research-scout-g1','evidence-apprentice-g1','builder-apprentice-g1','auditor-apprentice-g1'],
    sponsor_agent_refs: ['research-scout-g1','evidence-apprentice-g1','builder-apprentice-g1','auditor-apprentice-g1'],
    evidence_refs: evidence.map((x) => x.id), blueprint: { ...candidate, model, tools: [], publication: false, production_write_authority: false },
    audit_result: { evidence_id: auditLead.id, response: String(auditLead.payload?.response || '').slice(0, 5000) },
    status: agentId ? 'SPAWNED' : 'APPROVED_FOR_SPAWN', n8n_agent_id: agentId,
    production_authority_granted: false, publication_attempted: false, updated_at: new Date().toISOString(),
  } });

  if (!agentId) {
    const credential = await selectGroqCredential();
    const created = await tool('create_agent', { projectId, name: candidate.name, config: {
      model, credential: credential.id,
      instructions: [
        `You are ${candidate.name}, a bounded A2 ${candidate.role}.`,
        candidate.mission,
        'Your purpose was derived from an audited Research→Evidence→Build→Audit Factory handoff.',
        'Preserve AF-HANDOFF/1 envelopes, correlation IDs, evidence references and uncertainty labels across cell boundaries.',
        'Never self-promote, publish yourself, expand production write authority, expand secret scope or mutate Root of Trust.',
        'You begin with zero tools. If required evidence or authority is missing, return BLOCKER instead of guessing.',
      ].join(' '),
      tools: [], memory: { enabled: true, storage: 'n8n' }, config: { reasoning: 'medium', toolCallConcurrency: 1 },
    } });
    agentId = created?.agentId || created?.id;
    if (!agentId) throw new Error(`create_agent returned no id for synergy child: ${JSON.stringify(created).slice(0, 1200)}`);
    const validation = await tool('validate_agent', { agentId });
    if (validation?.valid !== true) throw new Error(`Synergy child validation failed: ${JSON.stringify(validation).slice(0, 1200)}`);
  }

  await db('af_agent_candidates?on_conflict=candidate_id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: {
    candidate_id: candidate.candidateId, n8n_agent_id: agentId, name: candidate.name, generation: 3, role: candidate.role,
    state: 'SPAWNED', autonomy_level: 'A2',
    parent_refs: ['research-scout-g1','evidence-apprentice-g1','builder-apprentice-g1','auditor-apprentice-g1'],
    skills: [], tools: [], model: { provider: 'groq', id: 'openai/gpt-oss-120b' }, mutation_summary: candidate.mission,
    provenance: { source: 'AF-HANDOFF/1 synergy birth', correlation_id: message.correlation_id, audit_evidence_id: auditLead.id },
    metadata: { publication_attempted: false, production_authority_granted: false }, updated_at: new Date().toISOString(),
  } });

  await db('af_agent_lifecycle_events', { method: 'POST', prefer: 'return=minimal', body: {
    candidate_id: candidate.candidateId, from_state: 'DRAFT', to_state: 'SPAWNED', event_type: 'cross_cell_audited_synergy_birth',
    evidence_class: 'CONFIRMED', payload: { n8n_agent_id: agentId, correlation_id: message.correlation_id, publication_attempted: false, production_authority_granted: false },
    provenance: { protocol: 'AF-HANDOFF/1', audit_evidence_id: auditLead.id },
  } });

  for (const parent of ['research-scout-g1','evidence-apprentice-g1','builder-apprentice-g1','auditor-apprentice-g1']) {
    await db('af_agent_relationships?on_conflict=parent_candidate_id,child_candidate_id,relation_type', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: {
      parent_candidate_id: parent, child_candidate_id: candidate.candidateId, relation_type: 'MENTOR', active: true,
      use_when: 'Cross-cell synergy parent/mentor; communication occurs through AF-HANDOFF/1 and shared evidence.',
      provenance: { correlation_id: message.correlation_id, protocol: 'AF-HANDOFF/1' },
    } });
  }

  await db('af_agent_birth_proposals?correlation_id=eq.' + message.correlation_id + '&proposed_candidate_id=eq.' + encodeURIComponent(candidate.candidateId), {
    method: 'PATCH', prefer: 'return=minimal', body: { status: 'SPAWNED', n8n_agent_id: agentId, updated_at: new Date().toISOString() },
  });
  const completed = await rpc('af_bus_complete', { p_message_id: message.id, p_worker: workerId, p_result: { spawned_candidate_id: candidate.candidateId, n8n_agent_id: agentId, publication_attempted: false } });
  if (completed !== true) throw new Error(`Failed to complete birth message ${message.id}`);
  return { status: 'SPAWNED', candidateId: candidate.candidateId, agentId };
}

await syncDirectory();
await rpc('af_bus_recover_stale', { p_stale_minutes: 10 });
const claimed = await rpc('af_bus_claim', { p_worker: workerId, p_limit: maxClaims });
const messages = Array.isArray(claimed) ? claimed : [];
const results = [];
for (const message of messages) {
  try {
    const result = message.stage === 'BIRTH' ? await processBirth(message) : await processStage(message);
    results.push({ id: message.id, ...result });
  } catch (error) {
    const summary = String(error?.message || error).slice(0, 1200);
    const status = await rpc('af_bus_fail', { p_message_id: message.id, p_worker: workerId, p_error: { summary }, p_retry_seconds: Math.min(300, 30 * Math.max(1, message.attempts || 1)) });
    results.push({ id: message.id, status, error: summary });
  }
}

console.log(`FACTORY_MESSAGE_BUS worker=${workerId} claimed=${messages.length} results=${JSON.stringify(results)}`);
if (results.some((x) => x.status === 'DEAD_LETTER')) process.exitCode = 1;
