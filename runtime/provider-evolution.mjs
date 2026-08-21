const DEFAULT_DIMENSIONS = ['task_success','correctness','evidence_fidelity','reliability','latency','cost_efficiency','context_efficiency','observability','safety_compliance'];

export function normalizeProviderTrial(row = {}) {
  const scores = object(row.scores);
  const normalized = {};
  for (const key of DEFAULT_DIMENSIONS) normalized[key] = score(scores[key]);
  return {
    provider_id: clean(row.provider_id), capability_id: clean(row.capability_id), context_key: clean(row.context_key || 'general'),
    case_key: clean(row.case_key), outcome: ['PASS','FAIL','BLOCKED'].includes(String(row.outcome || '').toUpperCase()) ? String(row.outcome).toUpperCase() : 'FAIL',
    scores: normalized, raw_metrics: object(row.raw_metrics), evidence: object(row.evidence)
  };
}

export function aggregateProviderTrials(trials = [], policy = {}) {
  const minimumTrials = integer(policy.minimumTrialsPerProvider, 3, 1, 100);
  const minimumPassRate = finite(policy.minimumPassRate, 0.8);
  const hardGateMinimum = finite(policy.hardGateMinimum, 80);
  const hardGateDimensions = Array.isArray(policy.hardGateDimensions) ? policy.hardGateDimensions : ['correctness','evidence_fidelity','safety_compliance'];
  const grouped = new Map();
  for (const input of trials) { const row = normalizeProviderTrial(input); if (!row.provider_id) continue; if (!grouped.has(row.provider_id)) grouped.set(row.provider_id, []); grouped.get(row.provider_id).push(row); }
  const out = [];
  for (const [providerId, rows] of grouped) {
    const passed = rows.filter((x) => x.outcome === 'PASS');
    const scores = {};
    for (const key of DEFAULT_DIMENSIONS) scores[key] = round(mean(rows.map((x) => x.scores[key])));
    const passRate = rows.length ? passed.length / rows.length : 0;
    const hardGatesPass = hardGateDimensions.every((key) => scores[key] >= hardGateMinimum);
    out.push({ provider_id: providerId, trial_count: rows.length, pass_count: passed.length, pass_rate: round(passRate), scores, eligible: rows.length >= minimumTrials && passRate >= minimumPassRate && hardGatesPass, hard_gates_pass: hardGatesPass });
  }
  return out.sort((a, b) => a.provider_id.localeCompare(b.provider_id));
}

export function paretoDominates(a, b, dimensions = DEFAULT_DIMENSIONS) {
  const as = object(a?.scores), bs = object(b?.scores); let strictlyBetter = false;
  for (const key of dimensions) { const av = score(as[key]), bv = score(bs[key]); if (av < bv) return false; if (av > bv) strictlyBetter = true; }
  return strictlyBetter;
}

export function providerUtility(scores = {}, weights = {}) {
  const entries = Object.entries(weights);
  if (!entries.length) return round(mean(DEFAULT_DIMENSIONS.map((key) => score(scores[key]))));
  const total = entries.reduce((sum, [, weight]) => sum + Math.max(0, finite(weight, 0)), 0); if (!total) return 0;
  return round(entries.reduce((sum, [key, weight]) => sum + score(scores[key]) * Math.max(0, finite(weight, 0)), 0) / total);
}

export function selectProviderChampion(trials = [], options = {}) {
  const policy = object(options.policy);
  const dimensions = Array.isArray(policy.dimensions) && policy.dimensions.length ? policy.dimensions : DEFAULT_DIMENSIONS;
  const aggregates = aggregateProviderTrials(trials, policy).map((row) => ({ ...row, utility: providerUtility(row.scores, object(policy.utilityWeights)) }));
  const eligible = aggregates.filter((row) => row.eligible);
  const pareto = eligible.filter((candidate) => !eligible.some((other) => other.provider_id !== candidate.provider_id && paretoDominates(other, candidate, dimensions)));
  pareto.sort((a, b) => b.utility - a.utility || b.pass_rate - a.pass_rate || a.provider_id.localeCompare(b.provider_id));
  let selected = pareto[0] || null;
  const currentId = clean(options.currentChampion); const current = eligible.find((row) => row.provider_id === currentId) || null; const minDelta = finite(policy.minimumPromotionDelta, 2);
  if (current && selected && selected.provider_id !== current.provider_id && selected.utility - current.utility < minDelta) selected = current;
  if (current && !selected) selected = current;
  return { selected, current, aggregates, pareto_front: pareto.map((x) => x.provider_id), changed: Boolean(selected && currentId && selected.provider_id !== currentId) };
}

export function providerAllowedForProduction(provider = {}, arena = {}, policy = {}) {
  if (provider.productionReady !== true) return { ok: false, code: 'PROVIDER_NOT_PRODUCTION_READY' };
  const context = object(arena.context); if (context.routing === 'shadow') return { ok: false, code: 'CONTEXT_SHADOW_ONLY' };
  if (policy.requireSameOrLowerRiskClass !== false) { const baseline = riskRank(arena.incumbentRiskClass || provider.riskClass || 'LOW'); if (riskRank(provider.riskClass || 'HIGH') > baseline) return { ok: false, code: 'RISK_CLASS_EXPANSION' }; }
  return { ok: true };
}

export function shouldRechallenge(champion = {}, policy = {}, now = new Date()) {
  const cadenceDays = integer(policy.cadenceDays, 14, 1, 365), failureRateTrigger = finite(policy.failureRateTrigger, 0.15), failureRate = finite(champion.failure_rate, 0);
  if (failureRate > failureRateTrigger) return { due: true, reason: 'FAILURE_RATE_TRIGGER' };
  const activated = Date.parse(String(champion.activated_at || champion.updated_at || '')); if (!Number.isFinite(activated)) return { due: true, reason: 'NO_CHAMPION_TIMESTAMP' };
  const dueAt = activated + cadenceDays * 86400000; return { due: now.getTime() >= dueAt, reason: now.getTime() >= dueAt ? 'CADENCE' : 'NOT_DUE', due_at: new Date(dueAt).toISOString() };
}

export function inferWebEvidenceContext(args = {}) {
  const explicit = clean(args.provider_context || args.context_key); if (['general','public-static-html','js-heavy','structured-crawl'].includes(explicit)) return explicit;
  if (args.render_js === true || args.javascript === true) return 'js-heavy'; if (Array.isArray(args.urls) && args.urls.length > 1) return 'structured-crawl'; return 'general';
}

export function contextualArena(registry = {}, capabilityId, contextKey = 'general') {
  const arena = (registry.arenas || []).find((x) => x.capability === capabilityId); if (!arena) return null;
  const contexts = object(arena.contexts); const context = object(contexts[contextKey] || contexts.general); return { ...arena, context_key: contexts[contextKey] ? contextKey : 'general', context };
}

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function clean(value) { return String(value ?? '').trim().slice(0, 240); }
function finite(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function integer(value, fallback, min, max) { return Math.max(min, Math.min(max, Math.floor(finite(value, fallback)))); }
function score(value) { return Math.max(0, Math.min(100, finite(value, 0))); }
function mean(values) { return values.length ? values.reduce((a, b) => a + finite(b, 0), 0) / values.length : 0; }
function round(value) { return Math.round(finite(value, 0) * 1000) / 1000; }
function riskRank(value) { return ({ LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 })[String(value || '').toUpperCase()] || 99; }
