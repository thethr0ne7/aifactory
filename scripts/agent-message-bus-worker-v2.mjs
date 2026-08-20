import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const endpoint = process.env.N8N_MCP_URL || 'https://thethr0ne7.app.n8n.cloud/mcp-server/http';
const token = process.env.N8N_MCP_TOKEN;
const brokerUrl = process.env.FACTORY_BUS_BROKER_URL || 'https://hgivyjjethjwswjrvroy.supabase.co/functions/v1/ai-factory-agent-bus';
const workerId = process.env.FACTORY_BUS_WORKER_ID || `github-${process.env.GITHUB_RUN_ID || crypto.randomUUID()}`;
const maxClaims = Math.min(4, Math.max(1, Number(process.env.FACTORY_BUS_MAX_CLAIMS || 4)));
const syncDirectoryEnabled = String(process.env.FACTORY_BUS_SYNC_DIRECTORY || 'false').toLowerCase() === 'true';
const projectId = 'FP3HOvN6NpEDN0PB';
const model = 'groq/openai/gpt-oss-120b';
const preferredCredentialName = 'AI Factory n8n';
if (!token) throw new Error('N8N_MCP_TOKEN required');

const routing = JSON.parse(await fs.readFile('registry/agent-routing.json', 'utf8'));
const network = JSON.parse(await fs.readFile('registry/agent-network.json', 'utf8'));

let brokerToken;
async function oidcToken() {
  if (brokerToken) return brokerToken;
  const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!requestUrl || !requestToken) throw new Error('GitHub OIDC environment unavailable');
  const url = new URL(requestUrl);
  url.searchParams.set('audience', 'aifactory-agent-bus');
  const response = await fetch(url, { headers: { Authorization: `Bearer ${requestToken}` } });
  const payload = await response.json();
  if (!response.ok || !payload?.value) throw new Error(`OIDC token request failed ${response.status}`);
  brokerToken = payload.value;
  return brokerToken;
}
async function broker(action, fields = {}) {
  const response = await fetch(brokerUrl, {
    method: 'POST',
    headers: { authorization: `Bearer ${await oidcToken()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ action, ...fields }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) throw new Error(`Agent bus broker ${action} ${response.status}: ${JSON.stringify(payload).slice(0, 1200)}`);
  return payload;
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

await mcpRequest({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'ai-factory-message-bus', version: '2.0.0' } } });
await mcpRequest({ jsonrpc: '2.0', method: 'notifications/initialized' });
let rpcId = 2;
async function tool(name, args = {}) {
  return structured(await mcpRequest({ jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name, arguments: args } }));
}

class RetryableProviderError extends Error {
  constructor(message, retryAfterSeconds = 300) {
    super(message);
    this.name = 'RetryableProviderError';
    this.retryAfterSeconds = Math.max(30, Math.min(Number(retryAfterSeconds) || 300, 3600));
  }
}
function parseRetryAfterSeconds(text) {
  const lower = String(text || '');
  const match = lower.match(/try again in\s+(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?/i);
  if (!match) return 300;
  const seconds = (Number(match[1]) || 0) * 3600 + (Number(match[2]) || 0) * 60 + (Number(match[3]) || 0);
  return Math.ceil(seconds + 45);
}
function isProviderFailure(text) {
  return /execution_failed|AI_APICallError|rate limit reached|too many requests|insufficient quota|provider.*timeout|service unavailable/i.test(String(text || ''));
}
function isRateLimitFailure(text) {
  return /rate limit reached|too many requests|429|tokens per day|TPD/i.test(String(text || ''));
}
function validAgentResponse(text, requiredMarker) {
  const value = String(text || '').trim();
  return Boolean(value && !isProviderFailure(value) && (!requiredMarker || value.includes(requiredMarker)));
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
  if (isProviderFailure(text)) {
    const retry = parseRetryAfterSeconds(text);
    throw new RetryableProviderError(`${isRateLimitFailure(text) ? 'PROVIDER_RATE_LIMIT' : 'PROVIDER_FAILURE'} agent=${name}: ${text.slice(0, 700)}`, retry);
  }
  return { agent, text: text.slice(0, 2500) };
}

async function syncDirectory() {
  const blueprints = [...(network.seedBlueprints || []), ...(network.generation2Blueprints || [])];
  const rows = [{ candidateId: 'nursery-supervisor-g0', name: 'AI Factory Nursery Supervisor', generation: 0, role: 'nursery-supervisor', autonomyLevel: 'A3', parentRefs: [] }, ...blueprints.map((x) => ({
    candidateId: x.candidateId, name: x.name, generation: x.generation, role: x.role, autonomyLevel: x.autonomyLevel || 'A2', parentRefs: x.parentRefs || [], skills: x.skills || [], tools: x.tools || [], mission: x.mission,
  }))];
  for (const item of rows) {
    const agent = item.candidateId === 'nursery-supervisor-g0' ? { id: 'tjPdLV47rjFQFHOV' } : await resolveAgent(item.name);
    await broker('sync_candidate', { record: {
      candidate_id: item.candidateId, n8n_agent_id: agent.id, name: item.name, generation: item.generation, role: item.role,
      state: item.candidateId === 'evidence-apprentice-g1' ? 'PROMOTED' : 'SPAWNED', autonomy_level: item.autonomyLevel,
      parent_refs: item.parentRefs, skills: item.skills || [], tools: item.tools || [], model: { provider: 'groq', id: 'openai/gpt-oss-120b' },
      mutation_summary: item.mission || null, provenance: { source: 'agent-message-bus-worker-v2', runtime: 'n8n', evidence: 'live search_agents exact match' }, metadata: { communication_transport: 'AF-HANDOFF/1' },
    } });
  }
  for (const item of rows.filter((x) => x.candidateId !== 'nursery-supervisor-g0')) {
    for (const parent of item.parentRefs || []) {
      await broker('sync_relationship', { record: {
        parent_candidate_id: parent, child_candidate_id: item.candidateId, relation_type: item.generation === 1 ? 'SUPERVISOR' : 'PARENT',
        use_when: 'Durable AF-HANDOFF/1 routing relationship; native n8n subAgent attachment is optional.', active: true,
        provenance: { source: 'registry/agent-network.json', transport: 'AF-HANDOFF/1' },
      } });
    }
  }
}

async function correlation(id) { return broker('read_correlation', { correlation_id: id }); }
function responseText(row) { return String(row?.payload?.response || row?.claim || '').trim(); }
function validEvidenceRows(rows) { return (rows || []).filter((row) => !isProviderFailure(responseText(row))); }
function evidenceDigest(rows) {
  return validEvidenceRows(rows).slice(-12).map((row) => `[${row.stage}/${row.evidence_class}/${row.producer_agent_ref}] ${responseText(row).replace(/\s+/g, ' ').slice(0, 500)}`).join('\n');
}
function latestReusableEvidence(rows, stage, producer, marker) {
  return [...(rows || [])].reverse().find((row) => row.stage === stage && row.producer_agent_ref === producer && validAgentResponse(responseText(row), marker)) || null;
}
async function recordEvidence({ correlationId, messageId, producer, stage, evidenceClass, claim, response, sourceRefs = [] }) {
  const payload = await broker('add_evidence', { record: { correlation_id: correlationId, message_id: messageId, producer_agent_ref: producer, stage, evidence_class: evidenceClass, claim, source_refs: sourceRefs, payload: { response: String(response).slice(0, 2500) } } });
  return payload.evidence_id;
}
async function enqueue({ correlationId, causationId, from, to, kind = 'HANDOFF', stage, payload, priority = 100 }) {
  return broker('add_message', { record: { correlation_id: correlationId, causation_id: causationId || null, from_agent_ref: from, to_agent_ref: to, kind, stage, payload, priority, max_attempts: 3 } });
}

function stagePrompt({ stage, objective, correlationId, prior, role, isLead, specialistReports, candidateSeed }) {
  const base = [
    'Protocol=AF-HANDOFF/1.', `Correlation=${correlationId}. Stage=${stage}.`, `Objective=${String(objective).slice(0, 1400)}`,
    'No external side effects. Root of Trust, evidence gates, production authority and autonomy ceilings are immutable. Never invent tools or evidence.',
  ];
  if (candidateSeed) base.push(`CandidateSeed=${JSON.stringify(candidateSeed).slice(0, 900)}`);
  if (prior) base.push(`PriorEvidence=${prior.slice(0, 5000)}`);
  if (!isLead) {
    base.push(`Role=${role}. First line EXACTLY SPECIALIST_RESULT=READY. Then at most 600 characters: strongest finding, evidence class, one blocker/unknown if any. Do not repeat the objective.`);
  } else {
    base.push(`SpecialistReports=${String(specialistReports || '').slice(0, 6500)}`);
    base.push(`You are ${stage} cell lead. First line EXACTLY ${stage}_GATE=PASS unless a concrete blocker requires ${stage}_GATE=BLOCK. Then at most 1000 characters: synthesis + next handoff. Do not restate all reports.`);
    if (stage === 'BUILD') base.push('If PASS include four exact lines: CANDIDATE_ID=..., CANDIDATE_NAME=..., CANDIDATE_ROLE=..., MISSION=... . Candidate stays A2, zero tools, unpublished, no production writes.');
    if (stage === 'AUDIT') base.push('PASS only means safe to SPAWN as unpublished A2 draft with zero tools. It is not promotion or publication.');
  }
  return base.join('\n');
}

async function processStage(message) {
  const cell = routing.cells?.[message.stage];
  if (!cell) throw new Error(`No routing cell for ${message.stage}`);
  const objective = message.payload?.objective;
  if (!objective) throw new Error('Message objective missing');
  const context = await correlation(message.correlation_id);
  const existing = context.evidence || [];
  const prior = evidenceDigest(existing);
  const candidateSeed = message.payload?.candidate_seed || null;
  const specialistResults = [];

  // Sequential by design: if the provider is degraded, stop after the first failure instead of amplifying the outage.
  for (const spec of cell.specialists) {
    const reusable = latestReusableEvidence(existing, message.stage, spec.candidateId, 'SPECIALIST_RESULT=READY');
    if (reusable) {
      specialistResults.push({ ...spec, response: responseText(reusable), evidenceId: reusable.id, reused: true });
      continue;
    }
    const result = await callAgent(spec.name, stagePrompt({ stage: message.stage, objective, correlationId: message.correlation_id, prior, role: spec.candidateId, isLead: false, candidateSeed }));
    if (!result.text.includes('SPECIALIST_RESULT=READY')) throw new Error(`Specialist marker missing agent=${spec.name}`);
    const evidenceId = await recordEvidence({ correlationId: message.correlation_id, messageId: message.id, producer: spec.candidateId, stage: message.stage, evidenceClass: 'OBSERVED', claim: `${message.stage} specialist report`, response: result.text });
    specialistResults.push({ ...spec, response: result.text, evidenceId, reused: false });
  }

  const reports = specialistResults.map((x) => `[${x.candidateId}] ${x.response.slice(0, 900)}`).join('\n');
  const leadMarker = `${message.stage}_GATE=`;
  const reusableLead = latestReusableEvidence(existing, message.stage, cell.lead.candidateId, leadMarker);
  let leadText;
  let leadEvidenceId;
  if (reusableLead) {
    leadText = responseText(reusableLead);
    leadEvidenceId = reusableLead.id;
  } else {
    const leadResult = await callAgent(cell.lead.name, stagePrompt({ stage: message.stage, objective, correlationId: message.correlation_id, prior, role: cell.lead.candidateId, isLead: true, specialistReports: reports, candidateSeed }));
    leadText = leadResult.text;
    if (!leadText.includes(leadMarker)) throw new Error(`Lead gate marker missing agent=${cell.lead.name}`);
    leadEvidenceId = await recordEvidence({ correlationId: message.correlation_id, messageId: message.id, producer: cell.lead.candidateId, stage: message.stage, evidenceClass: 'DERIVED', claim: `${message.stage} cell lead handoff`, response: leadText, sourceRefs: specialistResults.map((x) => x.evidenceId).filter(Boolean) });
  }

  const passMarker = `${message.stage}_GATE=PASS`;
  const gate = leadText.includes(passMarker) ? 'PASS' : 'BLOCK';
  const nextStage = cell.next;
  const nextCell = routing.cells?.[nextStage];
  const toRef = nextCell?.lead?.candidateId || 'nursery-supervisor-g0';
  await broker('add_handoff', { record: {
    correlation_id: message.correlation_id, from_stage: message.stage, to_stage: nextStage,
    from_agent_ref: cell.lead.candidateId, to_agent_ref: toRef, message_id: message.id,
    evidence_refs: [...specialistResults.map((x) => x.evidenceId), leadEvidenceId].filter(Boolean), gate_status: gate,
    summary: { pass_marker: passMarker, lead_response: leadText.slice(0, 2000), reused_specialists: specialistResults.filter((x) => x.reused).map((x) => x.candidateId) },
  } });
  if (gate !== 'PASS') {
    const blocked = await broker('block', { message_id: message.id, worker: workerId, result: { gate, lead: leadText.slice(0, 2000) } });
    if (!blocked.blocked) throw new Error(`Failed to block ${message.id}`);
    return { status: 'BLOCKED', stage: message.stage };
  }
  await enqueue({ correlationId: message.correlation_id, causationId: message.id, from: cell.lead.candidateId, to: toRef, kind: nextStage === 'BIRTH' ? 'BIRTH_PROPOSAL' : 'HANDOFF', stage: nextStage, payload: { ...message.payload, previous_stage: message.stage, previous_lead_evidence_id: leadEvidenceId }, priority: message.priority });
  const done = await broker('complete', { message_id: message.id, worker: workerId, result: { gate, next_stage: nextStage, lead_evidence_id: leadEvidenceId } });
  if (!done.completed) throw new Error(`Failed to complete ${message.id}`);
  return { status: 'DELIVERED', stage: message.stage, nextStage };
}

async function selectGroqCredential() {
  const payload = await tool('list_credentials', { projectId, limit: 200 });
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const groq = rows.filter((row) => /groq/i.test(String(row?.type || '')));
  const exact = groq.filter((row) => row?.name === preferredCredentialName);
  if (exact.length === 1) return exact[0];
  if (groq.length === 1) return groq[0];
  throw new Error(`Expected one unambiguous Groq credential; found ${groq.length}`);
}
function parseCandidateMarkers(text, fallback) {
  const get = (key) => String(text).match(new RegExp(`(?:^|\\n)${key}=([^\\n]+)`))?.[1]?.trim();
  return { candidateId: get('CANDIDATE_ID') || fallback.candidateId, name: get('CANDIDATE_NAME') || fallback.name, role: get('CANDIDATE_ROLE') || fallback.role, mission: get('MISSION') || fallback.mission };
}
async function processBirth(message) {
  const context = await correlation(message.correlation_id);
  const evidence = validEvidenceRows(context.evidence || []);
  const audit = [...evidence].reverse().find((x) => x.stage === 'AUDIT' && x.producer_agent_ref === 'auditor-apprentice-g1');
  const build = [...evidence].reverse().find((x) => x.stage === 'BUILD' && x.producer_agent_ref === 'builder-apprentice-g1');
  if (!audit || !responseText(audit).includes('AUDIT_GATE=PASS')) throw new Error('Birth requires durable AUDIT_GATE=PASS');
  if (!build) throw new Error('Birth requires BUILD lead evidence');
  const fallback = message.payload?.candidate_seed;
  if (!fallback?.candidateId || !fallback?.name || !fallback?.role || !fallback?.mission) throw new Error('Candidate seed missing');
  const candidate = parseCandidateMarkers(responseText(build), fallback);
  if (!/^[a-z0-9][a-z0-9-]{2,80}$/.test(candidate.candidateId)) throw new Error(`Invalid candidate id ${candidate.candidateId}`);

  const proposal = (context.births || []).find((x) => x.proposed_candidate_id === candidate.candidateId);
  let agentId = proposal?.n8n_agent_id || null;
  if (!agentId) {
    const search = await tool('search_agents', { projectId, query: candidate.name, limit: 50 });
    const rows = Array.isArray(search?.data) ? search.data : (Array.isArray(search?.agents) ? search.agents : []);
    const exact = rows.filter((row) => row?.name === candidate.name);
    if (exact.length > 1) throw new Error(`Duplicate synergy child ${candidate.name}`);
    agentId = exact[0]?.id || exact[0]?.agentId || null;
  }
  const parents = ['research-scout-g1','evidence-apprentice-g1','builder-apprentice-g1','auditor-apprentice-g1'];
  const birthRecord = {
    correlation_id: message.correlation_id, proposed_candidate_id: candidate.candidateId, proposed_name: candidate.name,
    proposed_role: candidate.role, generation: 3, autonomy_level: 'A2', parent_refs: parents, sponsor_agent_refs: parents,
    evidence_refs: evidence.map((x) => x.id), blueprint: { ...candidate, model, tools: [], publication: false, production_write_authority: false },
    audit_result: { evidence_id: audit.id, response: responseText(audit).slice(0, 2500) }, status: agentId ? 'SPAWNED' : 'APPROVED_FOR_SPAWN',
    n8n_agent_id: agentId, production_authority_granted: false, publication_attempted: false,
  };
  await broker('upsert_birth', { record: birthRecord });
  if (!agentId) {
    const credential = await selectGroqCredential();
    const created = await tool('create_agent', { projectId, name: candidate.name, config: {
      model, credential: credential.id,
      instructions: [`You are ${candidate.name}, bounded A2 ${candidate.role}.`, candidate.mission, 'Preserve AF-HANDOFF/1 correlation, evidence refs, constraints, blockers and expected outputs.', 'Never self-promote, publish yourself, expand production writes or secret scope, or mutate Root of Trust.', 'Begin with zero tools; missing evidence/authority => BLOCKER.'].join(' '),
      tools: [], memory: { enabled: true, storage: 'n8n' }, config: { reasoning: 'low', toolCallConcurrency: 1 },
    } });
    agentId = created?.agentId || created?.id;
    if (!agentId) throw new Error('create_agent returned no id');
    const validation = await tool('validate_agent', { agentId });
    if (validation?.valid !== true) throw new Error(`Synergy child invalid: ${JSON.stringify(validation).slice(0, 900)}`);
  }
  await broker('sync_candidate', { record: { candidate_id: candidate.candidateId, n8n_agent_id: agentId, name: candidate.name, generation: 3, role: candidate.role, state: 'SPAWNED', autonomy_level: 'A2', parent_refs: parents, skills: [], tools: [], model: { provider: 'groq', id: 'openai/gpt-oss-120b' }, mutation_summary: candidate.mission, provenance: { source: 'AF-HANDOFF/1 synergy birth', correlation_id: message.correlation_id, audit_evidence_id: audit.id }, metadata: { publication_attempted: false, production_authority_granted: false } } });
  await broker('add_lifecycle', { record: { candidate_id: candidate.candidateId, from_state: 'DRAFT', to_state: 'SPAWNED', event_type: 'cross_cell_audited_synergy_birth', evidence_class: 'CONFIRMED', payload: { n8n_agent_id: agentId, correlation_id: message.correlation_id, publication_attempted: false, production_authority_granted: false }, provenance: { protocol: 'AF-HANDOFF/1', audit_evidence_id: audit.id } } });
  for (const parent of parents) await broker('sync_relationship', { record: { parent_candidate_id: parent, child_candidate_id: candidate.candidateId, relation_type: 'MENTOR', active: true, use_when: 'Cross-cell synergy mentor; communication occurs through AF-HANDOFF/1.', provenance: { correlation_id: message.correlation_id, protocol: 'AF-HANDOFF/1' } } });
  await broker('upsert_birth', { record: { ...birthRecord, status: 'SPAWNED', n8n_agent_id: agentId } });
  const done = await broker('complete', { message_id: message.id, worker: workerId, result: { spawned_candidate_id: candidate.candidateId, n8n_agent_id: agentId, publication_attempted: false } });
  if (!done.completed) throw new Error(`Failed to complete birth ${message.id}`);
  return { status: 'SPAWNED', candidateId: candidate.candidateId, agentId };
}

if (syncDirectoryEnabled) await syncDirectory();
await broker('recover', { stale_minutes: 10 });
const claimed = await broker('claim', { worker: workerId, limit: maxClaims });
const messages = Array.isArray(claimed.messages) ? claimed.messages : [];
const results = [];
for (const message of messages) {
  try {
    const result = message.stage === 'BIRTH' ? await processBirth(message) : await processStage(message);
    results.push({ id: message.id, ...result });
  } catch (error) {
    const retryAfterSeconds = error instanceof RetryableProviderError ? error.retryAfterSeconds : Math.min(300, 30 * Math.max(1, message.attempts || 1));
    const summary = String(error?.message || error).slice(0, 1200);
    const failed = await broker('fail', { message_id: message.id, worker: workerId, error: { summary, retryable_provider_failure: error instanceof RetryableProviderError, retry_after_seconds: retryAfterSeconds }, retry_seconds: retryAfterSeconds });
    results.push({ id: message.id, status: failed.status, error: summary, retry_after_seconds: retryAfterSeconds });
    if (error instanceof RetryableProviderError) break;
  }
}
console.log(`FACTORY_MESSAGE_BUS_V2 worker=${workerId} sync_directory=${syncDirectoryEnabled} claimed=${messages.length} results=${JSON.stringify(results)}`);
if (results.some((x) => x.status === 'DEAD_LETTER')) process.exitCode = 1;
