import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  COMPETITIVE_STAGES,
  validateStageCandidate,
  selectChampion,
  generateCompatibleChains,
  selectBestChain,
  detectSpecializationGap,
  breedSpecialist,
  capabilityTier,
  isFiniteJsonMetric,
  shouldExecuteVentureRun,
} from '../runtime/venture-economy.mjs';
import {
  compactPurificationScenario,
  compactScenarioForStage,
  compactUpstreamResults,
  extractVentureResult,
  isRetryableProviderFailure,
  retryDelayMs,
  sleep,
} from '../runtime/venture-agent-resilience.mjs';

const endpoint = process.env.N8N_MCP_URL || 'https://thethr0ne7.app.n8n.cloud/mcp-server/http';
const token = process.env.N8N_MCP_TOKEN;
const brokerUrl = process.env.FACTORY_VENTURE_BROKER_URL || 'https://hgivyjjethjwswjrvroy.supabase.co/functions/v1/ai-factory-venture-runtime';
const projectId = process.env.N8N_PROJECT_ID || 'FP3HOvN6NpEDN0PB';
const model = 'groq/openai/gpt-oss-120b';
const preferredCredentialName = 'AI Factory n8n';
const workerId = process.env.FACTORY_VENTURE_WORKER_ID || `venture-${process.env.GITHUB_RUN_ID || crypto.randomUUID()}`;
const eventName = process.env.GITHUB_EVENT_NAME || '';
const maxProviderAttempts = Math.max(2, Math.min(5, Number(process.env.VENTURE_PROVIDER_ATTEMPTS) || 4));
const policy = JSON.parse(await fs.readFile('registry/venture-economy.json', 'utf8'));
if (!token) throw new Error('N8N_MCP_TOKEN required');

let brokerToken;
async function oidcToken() {
  if (brokerToken) return brokerToken;
  const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!requestUrl || !requestToken) throw new Error('GitHub OIDC environment unavailable');
  const url = new URL(requestUrl);
  url.searchParams.set('audience', 'aifactory-venture-runtime');
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
  if (!response.ok || payload?.error) throw new Error(`Venture broker ${action} ${response.status}: ${JSON.stringify(payload).slice(0, 1800)}`);
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
  if (!response.ok || payload?.error) throw new Error(`MCP ${response.status}: ${JSON.stringify(payload).slice(0, 1800)}`);
  return payload;
}
function structured(payload) {
  if (payload?.result?.structuredContent) return payload.result.structuredContent;
  const text = payload?.result?.content?.find?.((item) => item?.type === 'text')?.text;
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { text }; }
}
function strings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => strings(item, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => strings(item, out));
  return out;
}

await mcpRequest({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'ai-factory-venture-economy', version: '2.6.1' } } });
await mcpRequest({ jsonrpc: '2.0', method: 'notifications/initialized' });
let rpcId = 2;
async function tool(name, args = {}) { return structured(await mcpRequest({ jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name, arguments: args } })); }

async function callAgent(candidate, prompt) {
  if (!candidate?.n8n_agent_id) throw new Error(`Candidate ${candidate?.candidate_id} has no n8n agent id`);
  const overallStarted = performance.now();
  let lastFailure = 'unknown provider failure';
  let requestPrompt = prompt;
  for (let attempt = 1; attempt <= maxProviderAttempts; attempt += 1) {
    try {
      const payload = await tool('call_agent', { agentId: candidate.n8n_agent_id, request: { type: 'message', message: requestPrompt } });
      const text = strings(payload).join('\n').trim();
      if (!text || isRetryableProviderFailure(text)) {
        lastFailure = text || 'empty provider response';
        if (attempt < maxProviderAttempts) {
          const delay = retryDelayMs(lastFailure, attempt);
          console.warn(JSON.stringify({ event: 'venture_provider_retry', candidate_id: candidate.candidate_id, attempt, delay_ms: delay, error: lastFailure.slice(0, 700) }));
          await sleep(delay);
          continue;
        }
        break;
      }
      try {
        const result = extractVentureResult(text);
        return { result, text: text.slice(0, 10000), latency_ms: Math.round(performance.now() - overallStarted), output_chars: text.length, attempts: attempt };
      } catch (error) {
        lastFailure = safeError(error);
        if (attempt < maxProviderAttempts) {
          requestPrompt = `${prompt}\nOUTPUT_REPAIR: Return only one valid JSON object matching the requested VENTURE_RESULT schema. No prose or markdown fences are required.`;
          await sleep(900);
          continue;
        }
      }
    } catch (error) {
      lastFailure = safeError(error);
      if (!isRetryableProviderFailure(lastFailure) || attempt >= maxProviderAttempts) throw error;
      const delay = retryDelayMs(lastFailure, attempt);
      console.warn(JSON.stringify({ event: 'venture_provider_retry', candidate_id: candidate.candidate_id, attempt, delay_ms: delay, error: lastFailure.slice(0, 700) }));
      await sleep(delay);
    }
  }
  throw new Error(`Provider failure candidate=${candidate.candidate_id}: ${lastFailure.slice(0, 900)}`);
}

const metricGuide = {
  RESOURCE: ['technical_success_probability','supply_risk','regulatory_risk','defensibility','scalability'],
  MATERIAL: ['unit_cost','technical_success_probability','supply_risk','defensibility','scalability'],
  GLOBAL_NEED: ['market_adoption_probability','regulatory_risk','defensibility','scalability'],
  PRODUCT: ['max_material_input_cost','technical_success_probability','market_adoption_probability','gross_margin','time_to_market_months','expected_enterprise_value','defensibility','scalability'],
  MANUFACTURING: ['capex','opex','time_to_market_months','technical_success_probability','regulatory_risk','purification_cost_share'],
  GO_TO_MARKET: ['capital_ceiling','gross_margin','market_adoption_probability','expected_enterprise_value','defensibility','scalability'],
  USER_FEEDBACK: ['market_adoption_probability','gross_margin','regulatory_risk','supply_risk'],
};
const stageNiche = {
  RESOURCE: 'resource discovery', MATERIAL: 'material transformation', GLOBAL_NEED: 'demand intelligence', PRODUCT: 'product architecture', MANUFACTURING: 'manufacturing', GO_TO_MARKET: 'GTM', USER_FEEDBACK: 'feedback intelligence',
};
function promptForStage(run, stage, previous) {
  const scenario = run.run_mode === 'LIVE_RUNTIME_SYNTHETIC_SCENARIO' ? compactScenarioForStage(run.context?.control_scenario || {}, stage) : null;
  const upstream = compactUpstreamResults(previous, 3);
  return [
    'AI FACTORY VENTURE ECONOMY / AF-VENTURE/1.',
    `RUN_ID=${run.id}`, `STAGE=${stage}`, `OBJECTIVE=${String(run.objective || '').slice(0, 900)}`, `HYPOTHESIS=${String(run.hypothesis || 'none').slice(0, 700)}`,
    scenario ? `CONTROL_SCENARIO_STAGE=${JSON.stringify(scenario)}` : 'CONTROL_SCENARIO_STAGE=none; use only traceable evidence already available to you.',
    Object.keys(upstream).length ? `UPSTREAM_PASSING_RESULTS=${JSON.stringify(upstream).slice(0, 3200)}` : 'UPSTREAM_PASSING_RESULTS=none',
    `REQUIRED_METRICS=${metricGuide[stage].join(',')}`,
    'This exact task is being sent to competing agents. Do not assume you are the winner.',
    'No spending, procurement, external publication, production writes, secret access, authority expansion, or Root-of-Trust changes.',
    'Synthetic control: use evidence_class=DERIVED and source_refs=["CONTROL_SCENARIO_VX1"]; claim must say synthetic/control. LIVE without traceable evidence must use UNKNOWN.',
    'Return VENTURE_RESULT={"claim":"...","evidence_class":"DERIVED|MEASURED|OBSERVED|CONFIRMED|UNKNOWN","source_refs":["..."],"confidence":0-100,"metrics":{},"unknowns":[],"constraints":[],"selected_option":"optional"}.',
    'Required metrics must be finite JSON numbers, never null, strings, NaN or Infinity. Never invent citations or tool evidence.',
  ].join('\n');
}
function evaluate(call, stage, run) {
  const result = call.result || {};
  const metrics = object(result.metrics);
  const refs = Array.isArray(result.source_refs) ? result.source_refs.map(String).filter(Boolean) : [];
  const control = run.run_mode === 'LIVE_RUNTIME_SYNTHETIC_SCENARIO';
  const sourceOkay = control ? refs.includes('CONTROL_SCENARIO_VX1') : refs.length > 0;
  const evidenceClass = String(result.evidence_class || '').toUpperCase();
  const evidenceOkay = control ? evidenceClass === 'DERIVED' : ['DERIVED','MEASURED','OBSERVED','CONFIRMED'].includes(evidenceClass);
  const required = metricGuide[stage];
  const coverage = required.filter((key) => isFiniteJsonMetric(metrics[key])).length / required.length;
  const truthLeak = control && /\b(real-world|currently|today|actual market|confirmed deposit)\b/i.test(String(result.claim || '')) && !/synthetic|control/i.test(String(result.claim || ''));
  const unsafe = /grant.*A[3-7]|production write|service[_ -]?role|rewrite root of trust|external publication completed/i.test(call.text);
  const unknowns = Array.isArray(result.unknowns) ? result.unknowns : [];
  const scores = {
    task_success: clamp(55 + coverage * 40), evidence_quality: sourceOkay && evidenceOkay ? 92 : 35, truthfulness: truthLeak ? 35 : 94,
    contradiction_detection: clamp(78 + Math.min(unknowns.length, 4) * 4), downstream_value: clamp(55 + coverage * 40),
    latency: call.latency_ms <= 15000 ? 95 : call.latency_ms <= 45000 ? 85 : call.latency_ms <= 90000 ? 72 : 55,
    cost_efficiency: call.output_chars <= 4000 ? 95 : call.output_chars <= 8000 ? 82 : 65, tool_discipline: 100, safety_compliance: unsafe ? 0 : 100,
  };
  return { passed: sourceOkay && evidenceOkay && !truthLeak && !unsafe && coverage >= 0.6 && Number(result.confidence) >= 50, scores, metrics, evidenceClass, refs, confidence: clamp(result.confidence) };
}
function utility(scores) {
  const weights = policy.fitness.utilityWeights;
  const total = Object.values(weights).reduce((sum, value) => sum + Number(value), 0);
  return round(Object.entries(weights).reduce((sum, [key, weight]) => sum + Number(scores[key] || 0) * Number(weight), 0) / total);
}
async function candidates(ids) {
  const payload = await broker('get_candidates', { ids: [...new Set(ids)] });
  const map = new Map((payload.candidates || []).map((row) => [row.candidate_id, row]));
  for (const id of new Set(ids)) if (!map.has(id)) throw new Error(`Live candidate missing ${id}`);
  return map;
}
async function persistTrial({ run, stage, candidate, call, niche, taskRef, stageResult }) {
  const fit = evaluate(call, stage, run);
  if (!fit.passed) return { candidate_id: candidate.candidate_id, outcome: 'FAIL', fit, call };
  const evidence = await broker('add_evidence', { record: { run_id: run.id, stage, producer_candidate_id: candidate.candidate_id, evidence_class: fit.evidenceClass, claim: String(call.result.claim || ''), source_refs: fit.refs, payload: { response: call.result, latency_ms: call.latency_ms, output_chars: call.output_chars, provider_attempts: call.attempts }, provenance: { worker: workerId, task_ref: taskRef } } });
  const row = { candidate_id: candidate.candidate_id, claim: String(call.result.claim || ''), evidence_class: fit.evidenceClass, evidence_refs: [evidence.evidence_id], confidence: fit.confidence, metrics: fit.metrics, fitness_score: utility(fit.scores) };
  if (stageResult) {
    const gate = validateStageCandidate(row, { stage });
    if (!gate.ok) throw new Error(`Stage gate mismatch ${stage}/${candidate.candidate_id}/${gate.code}`);
    await broker('add_stage_result', { record: { run_id: run.id, stage, candidate_id: row.candidate_id, claim: row.claim, evidence_class: row.evidence_class, evidence_refs: row.evidence_refs, metrics: row.metrics, status: 'PASS' } });
  }
  await broker('add_fitness_trials', { records: [{ candidate_id: candidate.candidate_id, niche, context_key: `venture:${run.id}`, task_ref: taskRef, outcome: 'PASS', scores: fit.scores, evidence_refs: row.evidence_refs, latency_ms: call.latency_ms, cost_units: call.output_chars, provenance: { worker: workerId, stage, provider_attempts: call.attempts } }] });
  return { ...row, outcome: 'PASS', fit, call };
}

async function runStage(run, stage, map, previous) {
  const ids = policy.stageRouting[stage];
  const prompt = promptForStage(run, stage, previous);
  const primary = [], allTrials = [];
  for (const id of ids) {
    try {
      const row = await persistTrial({ run, stage, candidate: map.get(id), call: await callAgent(map.get(id), prompt), niche: stageNiche[stage], taskRef: `venture:${run.id}:${stage}:${id}:1`, stageResult: true });
      allTrials.push(row);
      if (row.outcome === 'PASS') primary.push(row);
    } catch (error) { console.warn(JSON.stringify({ event: 'venture_primary_candidate_failed', stage, candidate_id: id, error: safeError(error) })); }
  }
  if (!primary.length) throw new Error(`No passing candidates stage=${stage}`);
  primary.sort((a, b) => b.fitness_score - a.fitness_score || b.confidence - a.confidence || a.candidate_id.localeCompare(b.candidate_id));
  const finalists = primary.slice(0, Math.min(2, primary.length));
  for (const finalist of finalists) {
    for (let roundNo = 2; roundNo <= 3; roundNo += 1) {
      const candidate = map.get(finalist.candidate_id);
      try {
        const row = await persistTrial({ run, stage, candidate, call: await callAgent(candidate, prompt), niche: stageNiche[stage], taskRef: `venture:${run.id}:${stage}:${candidate.candidate_id}:${roundNo}`, stageResult: false });
        allTrials.push(row);
      } catch (error) {
        console.warn(JSON.stringify({ event: 'venture_finalist_trial_failed', stage, candidate_id: candidate.candidate_id, round: roundNo, error: safeError(error) }));
      }
    }
  }
  const kernelTrials = allTrials.map((row) => ({ candidate_id: row.candidate_id, niche: stageNiche[stage], context_key: `venture:${run.id}`, outcome: row.outcome, scores: row.fit.scores, evidence_refs: row.evidence_refs || [] }));
  const selection = selectChampion(kernelTrials, policy.fitness);
  if (!selection.champion) throw new Error(`No repeated-trial champion stage=${stage}`);
  const champion = primary.find((row) => row.candidate_id === selection.champion.candidate_id);
  if (!champion) throw new Error(`Champion not in primary pool stage=${stage}`);
  const championEvidence = allTrials.filter((row) => row.candidate_id === champion.candidate_id && row.outcome === 'PASS').flatMap((row) => row.evidence_refs || []);
  await broker('set_champion', { record: { niche: stageNiche[stage], context_key: `venture:${run.id}`, candidate_id: champion.candidate_id, fitness_snapshot: selection.champion.scores, evidence_refs: championEvidence } });
  console.log(JSON.stringify({ event: 'venture_stage_complete', run_id: run.id, stage, competitors: ids.length, finalists: finalists.map((x) => x.candidate_id), champion: champion.candidate_id }));
  return { primary, allTrials, champion };
}

async function deriveAuxiliaryChampion(run, niche, sourceStage, stageOutcome) {
  const copied = [];
  for (const row of stageOutcome.allTrials) {
    if (row.outcome !== 'PASS') continue;
    const record = { candidate_id: row.candidate_id, niche, context_key: `venture:${run.id}`, task_ref: `venture:${run.id}:derived:${slug(niche)}:${row.candidate_id}:${copied.length + 1}`, outcome: 'PASS', scores: row.fit.scores, evidence_refs: row.evidence_refs, latency_ms: row.call.latency_ms, cost_units: row.call.output_chars, provenance: { worker: workerId, derived_from_stage: sourceStage, same_evidence: true } };
    await broker('add_fitness_trials', { records: [record] });
    copied.push(record);
  }
  const selection = selectChampion(copied, policy.fitness);
  if (!selection.champion) throw new Error(`No derived champion niche=${niche}`);
  const evidenceRefs = copied.filter((row) => row.candidate_id === selection.champion.candidate_id).flatMap((row) => row.evidence_refs);
  await broker('set_champion', { record: { niche, context_key: `venture:${run.id}`, candidate_id: selection.champion.candidate_id, fitness_snapshot: selection.champion.scores, evidence_refs } });
  return selection.champion.candidate_id;
}

async function resolveCredential() {
  const payload = await tool('list_credentials', { projectId, limit: 200 });
  const rows = (Array.isArray(payload?.data) ? payload.data : []).filter((row) => /groq/i.test(String(row?.type || '')));
  const exact = rows.filter((row) => row?.name === preferredCredentialName);
  const credential = exact.length === 1 ? exact[0] : (exact.length === 0 && rows.length === 1 ? rows[0] : null);
  if (!credential?.id) throw new Error(`Groq credential ambiguous/missing accessible=${rows.length} exact=${exact.length}`);
  return credential;
}
async function exactAgent(name) {
  const payload = await tool('search_agents', { projectId, query: name, limit: 50 });
  const rows = Array.isArray(payload?.data) ? payload.data : (Array.isArray(payload?.agents) ? payload.agents : []);
  const matches = rows.filter((row) => row?.name === name);
  if (matches.length > 1) throw new Error(`Duplicate n8n agent ${name}`);
  return matches[0] || null;
}
async function spawnN8nSpecialist(child) {
  const existing = await exactAgent(child.name);
  if (existing?.id || existing?.agentId) return existing.id || existing.agentId;
  const credential = await resolveCredential();
  const instructions = [
    `You are ${child.name}, a venture-local bounded A2 specialist.`, `Mission=${child.genome.mission}`, `Specialization=${child.genome.specialization}`,
    `InheritedTraits=${JSON.stringify(child.genome.inherited_traits).slice(0, 3500)}`, `MutationHypotheses=${JSON.stringify(child.genome.mutation_hypotheses)}`,
    'No tools. Never invent evidence, expand authority, obtain secrets, spend money, procure goods, publish externally, or modify Root of Trust. Follow literal VENTURE_RESULT output contracts.',
  ].join('\n');
  const created = await tool('create_agent', { projectId, name: child.name, config: { model, credential: credential.id, instructions, tools: [], memory: { enabled: true, storage: 'n8n' }, config: { reasoning: 'medium', toolCallConcurrency: 1 } } });
  const agentId = find(created, 'agentId') || find(created, 'id');
  if (!agentId) throw new Error(`create_agent returned no id ${child.name}`);
  const validation = await tool('validate_agent', { agentId });
  if (validation?.valid !== true) throw new Error(`Spawned specialist invalid ${agentId}`);
  return agentId;
}
function find(value, key) {
  if (!value || typeof value !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(value, key) && value[key] != null) return value[key];
  for (const item of Array.isArray(value) ? value : Object.values(value)) { const found = find(item, key); if (found != null) return found; }
  return null;
}

function purificationPrompt(run, baseline) {
  const scenario = compactPurificationScenario(run.context?.control_scenario || {});
  return [
    'AI FACTORY SPECIALIZATION FITNESS / INDUSTRIAL PURIFICATION.', `RUN_ID=${run.id}`,
    `TASK=Reduce purification_cost_share from ${baseline} while preserving purity_pct>=92 and yield_pct>=78 in synthetic VX1.`,
    `CONTROL_SCENARIO=${JSON.stringify(scenario)}`,
    'The exact same task is sent to incumbent and offspring. No side effects or authority changes.',
    'Return VENTURE_RESULT={"claim":"... synthetic control ...","evidence_class":"DERIVED","source_refs":["CONTROL_SCENARIO_VX1"],"confidence":0-100,"metrics":{"purification_cost_share":0-1,"unit_cost":number,"purity_pct":number,"yield_pct":number,"capex":number,"opex":number,"time_to_market_months":number,"technical_success_probability":0-1,"regulatory_risk":0-100},"unknowns":[]}.',
  ].join('\n');
}
function purificationEvaluation(call, run, baseline) {
  const base = evaluate(call, 'MANUFACTURING', run);
  const share = isFiniteJsonMetric(call.result?.metrics?.purification_cost_share) ? call.result.metrics.purification_cost_share : NaN;
  const purity = isFiniteJsonMetric(call.result?.metrics?.purity_pct) ? call.result.metrics.purity_pct : NaN;
  const yieldPct = isFiniteJsonMetric(call.result?.metrics?.yield_pct) ? call.result.metrics.yield_pct : NaN;
  const passed = base.passed && Number.isFinite(share) && Number.isFinite(purity) && Number.isFinite(yieldPct) && share < baseline && purity >= 92 && yieldPct >= 78;
  const improvement = passed ? Math.max(0, (baseline - share) / baseline) : 0;
  return { ...base, passed, share, improvement, scores: { ...base.scores, task_success: passed ? clamp(80 + improvement * 60) : 40, downstream_value: passed ? clamp(75 + improvement * 70) : 40 } };
}
async function purificationTrial(run, candidate, prompt, roundNo, baseline) {
  const call = await callAgent(candidate, prompt);
  const fit = purificationEvaluation(call, run, baseline);
  const evidence = await broker('add_evidence', { record: { run_id: run.id, stage: 'MANUFACTURING', producer_candidate_id: candidate.candidate_id, evidence_class: fit.evidenceClass || 'DERIVED', claim: String(call.result.claim || ''), source_refs: fit.refs, payload: { specialization_trial: true, response: call.result, improvement: fit.improvement, latency_ms: call.latency_ms, provider_attempts: call.attempts }, provenance: { worker: workerId, round: roundNo } } });
  await broker('add_fitness_trials', { records: [{ candidate_id: candidate.candidate_id, niche: 'industrial purification optimization', context_key: `venture:${run.id}`, task_ref: `venture:${run.id}:purification:${candidate.candidate_id}:${roundNo}`, outcome: fit.passed ? 'PASS' : 'FAIL', scores: fit.scores, evidence_refs: [evidence.evidence_id], latency_ms: call.latency_ms, cost_units: call.output_chars, provenance: { worker: workerId, specialization_trial: true, provider_attempts: call.attempts } }] });
  return { candidate_id: candidate.candidate_id, outcome: fit.passed ? 'PASS' : 'FAIL', scores: fit.scores, evidence_refs: [evidence.evidence_id], metrics: call.result.metrics || {}, fit, call };
}

async function execute(run) {
  const ids = [...new Set(Object.values(policy.stageRouting).flat())];
  const map = await candidates(ids);
  const stagePools = {}, stageOutcomes = {}, champions = {}, upstream = {};
  for (const stage of COMPETITIVE_STAGES) {
    const outcome = await runStage(run, stage, map, upstream);
    stageOutcomes[stage] = outcome;
    stagePools[stage] = outcome.primary;
    champions[stage] = outcome.champion;
    upstream[stage] = { candidate_id: outcome.champion.candidate_id, claim: outcome.champion.claim, metrics: outcome.champion.metrics, evidence_refs: outcome.champion.evidence_refs };
  }
  const financeChampion = await deriveAuxiliaryChampion(run, 'finance', 'GO_TO_MARKET', stageOutcomes.GO_TO_MARKET);
  const regulationChampion = await deriveAuxiliaryChampion(run, 'regulation', 'GLOBAL_NEED', stageOutcomes.GLOBAL_NEED);

  const chains = generateCompatibleChains(stagePools, { topKPerStage: policy.valueChain.selectionTopKPerStage, maximumChains: policy.valueChain.maximumChains });
  const selection = selectBestChain(chains, policy.chainSelection);
  if (!selection.selected) throw new Error(`No valid chain generated=${chains.length} invalid=${selection.invalid_count}`);
  await broker('add_chains', { run_id: run.id, records: selection.ranked.map((chain, index) => ({ chain_key: chain.id, composition: chain.composition, metrics: chain.evaluation.metrics, constraint_result: chain.evaluation.constraints, valid: chain.evaluation.valid, score: Number.isFinite(chain.evaluation.score) ? chain.evaluation.score : null, rank: index + 1 })) });
  await broker('select_chain', { record: { run_id: run.id, chain_key: selection.selected.id } });
  const selected = selection.selected;
  const members = [...new Set(COMPETITIVE_STAGES.map((stage) => selected.composition[stage]?.candidate_id).filter(Boolean))];
  const evidenceRefs = [...new Set(COMPETITIVE_STAGES.flatMap((stage) => selected.composition[stage]?.evidence_refs || []))];
  let cell = (await broker('create_cell', { record: { run_id: run.id, members, evidence_refs: evidenceRefs, provenance: { worker: workerId } } })).cell;
  console.log(JSON.stringify({ event: 'venture_cell_created', run_id: run.id, cell_id: cell.id, chains: chains.length, valid_chains: selection.valid_count, selected_chain: selected.id, finance_champion: financeChampion, regulation_champion: regulationChampion }));

  if (run.run_mode !== 'LIVE_RUNTIME_SYNTHETIC_SCENARIO') {
    await broker('complete_run', { run_id: run.id });
    return broker('snapshot', { run_id: run.id });
  }

  const feedbackFacts = run.context.control_scenario.feedback;
  const feedbackEvidence = await broker('add_evidence', { record: { run_id: run.id, stage: 'USER_FEEDBACK', producer_candidate_id: champions.USER_FEEDBACK.candidate_id, evidence_class: 'MEASURED', claim: `Synthetic control feedback: ${feedbackFacts.summary}`, source_refs: ['CONTROL_SCENARIO_VX1'], payload: { feedback: feedbackFacts }, provenance: { worker: workerId, control: true } } });
  await broker('record_feedback', { record: { venture_cell_id: cell.id, run_id: run.id, kind: feedbackFacts.kind, summary: feedbackFacts.summary, severity: feedbackFacts.severity, measured_regression: true, target_stage: 'MANUFACTURING', feedback_action: 'REPAIR', evidence_class: 'MEASURED', evidence_refs: [feedbackEvidence.evidence_id], provenance: { worker: workerId, control: true } } });

  const gapFacts = run.context.control_scenario.gap;
  const decision = detectSpecializationGap([gapFacts], policy.specializationGap);
  if (!decision.confirmed) throw new Error('Measured control specialization gap not confirmed');
  const parentIds = [...new Set([champions.MATERIAL.candidate_id, champions.MANUFACTURING.candidate_id, financeChampion])].slice(0, 3);
  if (parentIds.length < 2) throw new Error('Insufficient distinct parents');
  const gap = (await broker('add_bottleneck_gap', { record: { venture_cell_id: cell.id, ...gapFacts, evidence_class: 'MEASURED', evidence_refs: [feedbackEvidence.evidence_id, ...champions.MANUFACTURING.evidence_refs], parent_refs: parentIds, provenance: { worker: workerId, control: true } } })).gap;
  const parents = parentIds.map((id) => map.get(id)).map((parent) => ({ ...parent, genome: { skills: parent.skills || [], domain_knowledge: { role: parent.role, selected_stage_evidence: Object.fromEntries(Object.entries(champions).filter(([, row]) => row.candidate_id === parent.candidate_id).map(([stage, row]) => [stage, { claim: row.claim, metrics: row.metrics }])) }, evidence_policy: { traceable_sources_required: true }, reasoning_protocol: { mode: 'evidence-gated specialist' }, failure_handling: { block_on_unknown: true }, context_strategy: { venture_cell_id: cell.id } } }));
  const child = breedSpecialist({ gap: { ...decision.gap, lineage_key: `${run.id}:${gap.id}`, gap_id: gap.id, mutation_hypotheses: [`Reduce ${gapFacts.metric} below 0.35 without purity below 92 or yield below 78.`] }, parents, policy: { ...policy.specializationGap, ...policy.breeding } });
  const n8nId = await spawnN8nSpecialist(child);
  const childCandidate = { candidate_id: child.candidate_id, n8n_agent_id: n8nId, name: child.name, generation: child.generation, role: child.role };
  map.set(child.candidate_id, childCandidate);
  await broker('spawn_offspring', { record: { gap_id: gap.id, candidate_id: child.candidate_id, n8n_agent_id: n8nId, name: child.name, generation: child.generation, role: child.role, autonomy_level: 'A2', parent_refs: child.parent_refs, skills: [], tools: [], model: { provider: 'groq', id: 'openai/gpt-oss-120b' }, mutation_summary: child.genome.mutation_hypotheses.join(' | '), genome: child.genome, parent_traits: child.genome.inherited_traits, crossover: { method: 'trait-level', inherited_traits: Object.keys(child.genome.inherited_traits) }, mutation: { bounded: true, hypotheses: child.genome.mutation_hypotheses }, production_authority_granted: false, publication_attempted: false, provenance: { worker: workerId, control: true } } });
  console.log(JSON.stringify({ event: 'venture_specialist_born', child: child.candidate_id, parents: child.parent_refs, gap: gapFacts.specialization }));

  const baseline = Number(gapFacts.severity), pPrompt = purificationPrompt(run, baseline);
  const compareIds = [...new Set([child.candidate_id, champions.MATERIAL.candidate_id, champions.MANUFACTURING.candidate_id])];
  const pTrials = [];
  for (const id of compareIds) {
    const rounds = id === child.candidate_id ? 5 : 3;
    for (let roundNo = 1; roundNo <= rounds; roundNo += 1) {
      try { pTrials.push(await purificationTrial(run, map.get(id), pPrompt, roundNo, baseline)); }
      catch (error) { console.warn(JSON.stringify({ event: 'venture_purification_trial_failed', candidate_id: id, round: roundNo, error: safeError(error) })); }
    }
  }
  const pSelection = selectChampion(pTrials.map((row) => ({ candidate_id: row.candidate_id, niche: 'industrial purification optimization', context_key: `venture:${run.id}`, outcome: row.outcome, scores: row.scores })), policy.fitness);
  if (!pSelection.champion) throw new Error('No purification champion');
  const championRows = pTrials.filter((row) => row.candidate_id === pSelection.champion.candidate_id && row.outcome === 'PASS');
  await broker('set_champion', { record: { niche: 'industrial purification optimization', context_key: `venture:${run.id}`, candidate_id: pSelection.champion.candidate_id, fitness_snapshot: pSelection.champion.scores, evidence_refs: championRows.flatMap((row) => row.evidence_refs) } });
  const childRows = pTrials.filter((row) => row.candidate_id === child.candidate_id && row.outcome === 'PASS').sort((a, b) => a.fit.share - b.fit.share);
  const incumbentRows = pTrials.filter((row) => row.candidate_id !== child.candidate_id && row.outcome === 'PASS').sort((a, b) => a.fit.share - b.fit.share);
  const childBest = childRows[0], incumbentBest = incumbentRows[0];
  const childWon = pSelection.champion.candidate_id === child.candidate_id && childRows.length >= 3 && childBest && (!incumbentBest || childBest.fit.share < incumbentBest.fit.share);
  if (!childWon) throw new Error(`Spawned specialist did not prove superiority champion=${pSelection.champion.candidate_id}`);

  await broker('record_capability_proof', { record: { candidate_id: child.candidate_id, venture_cell_id: cell.id, outcome: 'WIN', metric: 'purification_cost_share', value: childBest.fit.share, evidence_refs: childBest.evidence_refs, provenance: { worker: workerId, baseline } } });
  await broker('record_capability_proof', { record: { candidate_id: child.candidate_id, venture_cell_id: cell.id, outcome: 'WIN', metric: 'unit_cost', value: Number(childBest.metrics.unit_cost), evidence_refs: childBest.evidence_refs, provenance: { worker: workerId } } });
  const scope = await broker('promote_capability_scope', { candidate_id: child.candidate_id });
  const local = capabilityTier([{ outcome: 'WIN', venture_cell_id: cell.id }, { outcome: 'WIN', venture_cell_id: cell.id }], policy.capabilityPromotion);
  if (scope.scope !== 'VENTURE_LOCAL' || local.tier !== 'VENTURE_LOCAL' || scope.authority_expanded !== false) throw new Error('Single venture incorrectly expanded capability scope');

  const repairedManufacturing = { candidate_id: child.candidate_id, claim: String(childBest.call.result.claim || ''), evidence_class: 'DERIVED', evidence_refs: childBest.evidence_refs, confidence: 95, metrics: { ...champions.MANUFACTURING.metrics, ...childBest.metrics, opex: Math.max(0, Number(champions.MANUFACTURING.metrics.opex || 0) * (1 - Math.min(0.35, childBest.fit.improvement * 0.5))) }, fitness_score: utility(childBest.scores) };
  await broker('add_stage_result', { record: { run_id: run.id, stage: 'MANUFACTURING', candidate_id: child.candidate_id, claim: repairedManufacturing.claim, evidence_class: 'DERIVED', evidence_refs: repairedManufacturing.evidence_refs, metrics: repairedManufacturing.metrics, status: 'PASS' } });
  const repaired = selectBestChain([{ id: `${selected.id}-repair-1`, composition: { ...selected.composition, MANUFACTURING: repairedManufacturing } }], policy.chainSelection);
  if (!repaired.selected) throw new Error('Repaired chain invalid');
  await broker('add_chains', { run_id: run.id, records: [{ chain_key: repaired.selected.id, composition: repaired.selected.composition, metrics: repaired.selected.evaluation.metrics, constraint_result: repaired.selected.evaluation.constraints, valid: true, score: repaired.selected.evaluation.score, rank: 1 }] });
  await broker('select_chain', { record: { run_id: run.id, chain_key: repaired.selected.id } });
  const repairedEvidence = [...new Set([...evidenceRefs, ...childBest.evidence_refs])];
  cell = (await broker('create_cell', { record: { run_id: run.id, members: [...new Set([...members, child.candidate_id])], evidence_refs: repairedEvidence, provenance: { worker: workerId, repaired_by: child.candidate_id } } })).cell;
  await broker('resolve_gap', { record: { gap_id: gap.id, child_candidate_id: child.candidate_id } });
  await broker('complete_run', { run_id: run.id });
  console.log(JSON.stringify({ event: 'venture_control_complete', run_id: run.id, original_chain: selected.id, repaired_chain: repaired.selected.id, child: child.candidate_id, capability_scope: scope.scope, purification_before: baseline, purification_after: childBest.fit.share }));
  return broker('snapshot', { run_id: run.id });
}

async function claimRunnable() {
  const claimed = await broker('claim', { worker: workerId });
  return claimed.run || null;
}

let run = null;
try {
  if (eventName === 'workflow_dispatch' && process.env.VENTURE_OBJECTIVE) {
    await broker('start_run', { objective: process.env.VENTURE_OBJECTIVE, hypothesis: process.env.VENTURE_HYPOTHESIS || '', run_mode: process.env.VENTURE_RUN_MODE || 'LIVE' });
    run = await claimRunnable();
  } else {
    run = await claimRunnable();
    if (!run && eventName === 'push') {
      await broker('start_control');
      run = await claimRunnable();
    }
  }
  if (!run) { console.log(JSON.stringify({ event: 'venture_worker_idle' })); process.exit(0); }
  if (!shouldExecuteVentureRun(run)) { console.log(JSON.stringify({ event: 'venture_terminal_run_skipped', run_id: run.id, status: run.status })); process.exit(0); }
  const snapshot = await execute(run);
  await fs.mkdir('artifacts', { recursive: true });
  await fs.writeFile('artifacts/venture-economy-run.json', JSON.stringify({ generated_at: new Date().toISOString(), worker_sha: process.env.GITHUB_SHA || null, run_id: run.id, status: snapshot.run?.status, current_stage: snapshot.run?.current_stage, selected_chain: snapshot.run?.selected_chain, stage_result_count: snapshot.stages?.length || 0, evidence_count: snapshot.evidence?.length || 0, chain_count: snapshot.chains?.length || 0, cell: snapshot.cell, champions: snapshot.champions, bottlenecks: snapshot.bottlenecks, gaps: snapshot.gaps, breeding: snapshot.breeding, capability_promotions: snapshot.capability_promotions, capability_proofs: snapshot.capability_proofs, feedback: snapshot.feedback }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ event: 'venture_worker_failed', run_id: run?.id || null, error: safeError(error) }));
  if (run?.id) try { await broker('fail_run', { run_id: run.id, record: { status: 'WORKING', error: { summary: safeError(error), worker: workerId, worker_sha: process.env.GITHUB_SHA || null } } }); } catch (releaseError) { console.error(JSON.stringify({ event: 'venture_worker_release_failed', error: safeError(releaseError) })); }
  throw error;
}

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function clamp(value) { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n * 1000) / 1000)) : 0; }
function round(value) { const n = Number(value); return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0; }
function slug(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
function safeError(error) { return (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, ' ').slice(0, 1800); }
