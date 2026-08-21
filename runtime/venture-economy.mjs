export const VALUE_CHAIN_STAGES = Object.freeze([
  'RESOURCE',
  'MATERIAL',
  'GLOBAL_NEED',
  'PRODUCT',
  'MANUFACTURING',
  'GO_TO_MARKET',
  'USER_FEEDBACK',
  'SELECTION',
]);

export const COMPETITIVE_STAGES = Object.freeze(VALUE_CHAIN_STAGES.slice(0, -1));
export const FITNESS_DIMENSIONS = Object.freeze([
  'task_success',
  'evidence_quality',
  'truthfulness',
  'contradiction_detection',
  'downstream_value',
  'latency',
  'cost_efficiency',
  'tool_discipline',
  'safety_compliance',
]);
export const PASSING_EVIDENCE = new Set(['MEASURED', 'OBSERVED', 'CONFIRMED', 'DERIVED']);
export const BLOCKING_EVIDENCE = new Set(['ASSUMPTION', 'UNKNOWN', 'BLOCKER']);
export const TERMINAL_VENTURE_RUN_STATUSES = new Set(['COMPLETE', 'FAILED', 'BLOCKED', 'REJECTED', 'CANCELLED']);

const DEFAULT_FITNESS_WEIGHTS = Object.freeze({
  task_success: 0.18,
  evidence_quality: 0.16,
  truthfulness: 0.16,
  contradiction_detection: 0.09,
  downstream_value: 0.15,
  latency: 0.05,
  cost_efficiency: 0.07,
  tool_discipline: 0.06,
  safety_compliance: 0.08,
});

const DEFAULT_CHAIN_WEIGHTS = Object.freeze({
  technical_success_probability: 0.15,
  market_adoption_probability: 0.15,
  gross_margin: 0.12,
  time_to_market_months: 0.08,
  regulatory_risk: 0.08,
  supply_risk: 0.08,
  defensibility: 0.08,
  scalability: 0.10,
  expected_enterprise_value: 0.16,
});

export function isFiniteJsonMetric(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function shouldExecuteVentureRun(run = {}) {
  return Boolean(run?.id) && !TERMINAL_VENTURE_RUN_STATUSES.has(String(run.status || '').toUpperCase());
}

export function validateStageCandidate(candidate = {}, { stage, requireEvidence = true } = {}) {
  const normalizedStage = String(stage || candidate.stage || '').toUpperCase();
  if (!COMPETITIVE_STAGES.includes(normalizedStage)) return fail('INVALID_STAGE');
  if (!candidate.candidate_id) return fail('CANDIDATE_REQUIRED');
  if (!String(candidate.claim || '').trim()) return fail('CLAIM_REQUIRED');
  const evidenceClass = String(candidate.evidence_class || '').toUpperCase();
  if (requireEvidence && !PASSING_EVIDENCE.has(evidenceClass)) return fail('EVIDENCE_GATE_FAILED', { evidence_class: evidenceClass });
  const evidenceRefs = Array.isArray(candidate.evidence_refs) ? candidate.evidence_refs.filter(Boolean) : [];
  if (requireEvidence && !evidenceRefs.length) return fail('EVIDENCE_REFS_REQUIRED');
  const metrics = object(candidate.metrics);
  if (Object.values(metrics).some((value) => value == null || (typeof value !== 'number' && typeof value !== 'boolean'))) {
    return fail('NON_NUMERIC_METRIC');
  }
  if (Object.values(metrics).some((value) => typeof value === 'number' && !Number.isFinite(value))) return fail('NON_FINITE_METRIC');
  const confidence = score(candidate.confidence ?? metrics.confidence ?? 0);
  if (confidence < 50) return fail('CONFIDENCE_TOO_LOW', { confidence });
  return { ok: true, stage: normalizedStage, evidence_class: evidenceClass, evidence_refs: evidenceRefs, metrics, confidence };
}

export function normalizeFitnessTrial(trial = {}) {
  const scores = {};
  for (const dimension of FITNESS_DIMENSIONS) scores[dimension] = score(trial.scores?.[dimension]);
  return {
    candidate_id: String(trial.candidate_id || '').trim(),
    niche: String(trial.niche || '').trim(),
    context_key: String(trial.context_key || 'global').trim() || 'global',
    outcome: String(trial.outcome || 'INCONCLUSIVE').toUpperCase(),
    scores,
    latency_ms: finiteOrNull(trial.latency_ms),
    cost_units: finiteOrNull(trial.cost_units),
    evidence_refs: Array.isArray(trial.evidence_refs) ? trial.evidence_refs.filter(Boolean) : [],
  };
}

export function paretoDominates(a, b, dimensions = FITNESS_DIMENSIONS) {
  let strictlyBetter = false;
  for (const dimension of dimensions) {
    const av = score(a?.[dimension]);
    const bv = score(b?.[dimension]);
    if (av < bv) return false;
    if (av > bv) strictlyBetter = true;
  }
  return strictlyBetter;
}

export function paretoFrontier(rows = [], dimensions = FITNESS_DIMENSIONS) {
  return rows.filter((row, index) => !rows.some((other, otherIndex) => otherIndex !== index && paretoDominates(other.scores || other, row.scores || row, dimensions)));
}

export function summarizeFitnessTrials(trials = []) {
  const groups = new Map();
  for (const raw of trials) {
    const trial = normalizeFitnessTrial(raw);
    if (!trial.candidate_id) continue;
    const key = `${trial.niche}\u0000${trial.context_key}\u0000${trial.candidate_id}`;
    const group = groups.get(key) || { candidate_id: trial.candidate_id, niche: trial.niche, context_key: trial.context_key, trials: [], scores: {} };
    group.trials.push(trial);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    for (const dimension of FITNESS_DIMENSIONS) group.scores[dimension] = round(avg(group.trials.map((trial) => trial.scores[dimension])));
    group.pass_count = group.trials.filter((trial) => trial.outcome === 'PASS').length;
    group.fail_count = group.trials.filter((trial) => trial.outcome === 'FAIL' || trial.outcome === 'BLOCKED').length;
    group.trial_count = group.trials.length;
    group.avg_latency_ms = round(avg(group.trials.map((trial) => trial.latency_ms).filter(Number.isFinite)));
    group.avg_cost_units = round(avg(group.trials.map((trial) => trial.cost_units).filter(Number.isFinite)));
    return group;
  });
}

export function selectChampion(trials = [], policy = {}) {
  const minTrials = Math.max(1, Number(policy.minimumTrialsForChampion ?? 3));
  const hardGate = score(policy.minimumHardGateScore ?? 75);
  const hardDimensions = policy.hardGateDimensions || ['evidence_quality', 'truthfulness', 'safety_compliance'];
  const weights = { ...DEFAULT_FITNESS_WEIGHTS, ...(policy.utilityWeights || {}) };
  const summaries = summarizeFitnessTrials(trials).filter((summary) =>
    summary.trial_count >= minTrials && summary.pass_count >= minTrials && summary.fail_count === 0 && hardDimensions.every((dimension) => score(summary.scores[dimension]) >= hardGate)
  );
  if (!summaries.length) return { champion: null, frontier: [], eligible: [], reason: 'NO_ELIGIBLE_CHAMPION' };
  const frontier = paretoFrontier(summaries);
  const ranked = frontier.map((row) => ({ ...row, utility: weighted(row.scores, weights) }))
    .sort((a, b) => b.utility - a.utility || b.pass_count - a.pass_count || a.candidate_id.localeCompare(b.candidate_id));
  return { champion: ranked[0], frontier: ranked, eligible: summaries, reason: 'PARETO_PLUS_CONTEXT' };
}

export function generateCompatibleChains(stagePools = {}, { topKPerStage = 2, maximumChains = 128 } = {}) {
  const pools = COMPETITIVE_STAGES.map((stage) => {
    const rows = Array.isArray(stagePools[stage]) ? stagePools[stage] : [];
    return [stage, rows.filter((row) => validateStageCandidate(row, { stage }).ok).sort((a, b) => score(b.fitness_score ?? b.confidence) - score(a.fitness_score ?? a.confidence)).slice(0, Math.max(1, topKPerStage))];
  });
  if (pools.some(([, rows]) => !rows.length)) return [];
  const chains = [];
  function build(index, composition) {
    if (chains.length >= maximumChains) return;
    if (index === pools.length) {
      chains.push({ id: `chain-${String(chains.length + 1).padStart(3, '0')}`, composition: { ...composition } });
      return;
    }
    const [stage, rows] = pools[index];
    for (const row of rows) {
      build(index + 1, { ...composition, [stage]: row });
      if (chains.length >= maximumChains) break;
    }
  }
  build(0, {});
  return chains;
}

export function propagateChainConstraints(chain = {}) {
  const c = chain.composition || chain;
  const violations = [];
  const materialCost = number(c.MATERIAL?.metrics?.unit_cost);
  const maxInputCost = number(c.PRODUCT?.metrics?.max_material_input_cost);
  if (Number.isFinite(materialCost) && Number.isFinite(maxInputCost) && materialCost > maxInputCost) violations.push({ code: 'MATERIAL_COST_EXCEEDS_PRODUCT_LIMIT', actual: materialCost, limit: maxInputCost });
  const capex = number(c.MANUFACTURING?.metrics?.capex);
  const capitalCeiling = number(c.GO_TO_MARKET?.metrics?.capital_ceiling);
  if (Number.isFinite(capex) && Number.isFinite(capitalCeiling) && capex > capitalCeiling) violations.push({ code: 'CAPEX_EXCEEDS_GTM_CEILING', actual: capex, limit: capitalCeiling });
  for (const stage of COMPETITIVE_STAGES) {
    const validation = validateStageCandidate(c[stage], { stage });
    if (!validation.ok) violations.push({ code: 'STAGE_GATE_FAILED', stage, reason: validation.code });
  }
  return { valid: violations.length === 0, violations };
}

export function aggregateChainMetrics(chain = {}) {
  const c = chain.composition || chain;
  const collect = (key) => COMPETITIVE_STAGES.map((stage) => number(c[stage]?.metrics?.[key])).filter(Number.isFinite);
  const technical = collect('technical_success_probability');
  const adoption = collect('market_adoption_probability');
  const regulatory = collect('regulatory_risk');
  const supply = collect('supply_risk');
  const defensibility = collect('defensibility');
  const scalability = collect('scalability');
  const capex = number(c.MANUFACTURING?.metrics?.capex ?? c.PRODUCT?.metrics?.capex);
  const opex = number(c.MANUFACTURING?.metrics?.opex);
  const grossMargin = number(c.GO_TO_MARKET?.metrics?.gross_margin ?? c.PRODUCT?.metrics?.gross_margin);
  const ttm = number(c.MANUFACTURING?.metrics?.time_to_market_months ?? c.PRODUCT?.metrics?.time_to_market_months);
  const enterpriseValue = number(c.GO_TO_MARKET?.metrics?.expected_enterprise_value ?? c.PRODUCT?.metrics?.expected_enterprise_value);
  return {
    technical_success_probability: round(technical.length ? min(technical) : 0),
    market_adoption_probability: round(adoption.length ? min(adoption) : 0),
    capex: finiteOrNull(capex), opex: finiteOrNull(opex), gross_margin: round(Number.isFinite(grossMargin) ? grossMargin : 0),
    time_to_market_months: round(Number.isFinite(ttm) ? ttm : 120), regulatory_risk: round(regulatory.length ? max(regulatory) : 100), supply_risk: round(supply.length ? max(supply) : 100),
    defensibility: round(defensibility.length ? avg(defensibility) : 0), scalability: round(scalability.length ? avg(scalability) : 0), expected_enterprise_value: round(Number.isFinite(enterpriseValue) ? enterpriseValue : 0),
  };
}

export function scoreChain(chain = {}, policy = {}) {
  const constraints = propagateChainConstraints(chain);
  const metrics = aggregateChainMetrics(chain);
  if (!constraints.valid) return { valid: false, score: -Infinity, metrics, constraints };
  const weights = { ...DEFAULT_CHAIN_WEIGHTS, ...(policy.weights || {}) };
  const normalized = {
    technical_success_probability: probabilityToScore(metrics.technical_success_probability), market_adoption_probability: probabilityToScore(metrics.market_adoption_probability), gross_margin: score(metrics.gross_margin),
    time_to_market_months: inverseRange(metrics.time_to_market_months, 1, 60), regulatory_risk: 100 - riskToScore(metrics.regulatory_risk), supply_risk: 100 - riskToScore(metrics.supply_risk),
    defensibility: score(metrics.defensibility), scalability: score(metrics.scalability), expected_enterprise_value: logValueScore(metrics.expected_enterprise_value),
  };
  return { valid: true, score: weighted(normalized, weights), metrics, normalized, constraints };
}

export function selectBestChain(chains = [], policy = {}) {
  const ranked = chains.map((chain) => ({ ...chain, evaluation: scoreChain(chain, policy) })).sort((a, b) => b.evaluation.score - a.evaluation.score || String(a.id).localeCompare(String(b.id)));
  const valid = ranked.filter((chain) => chain.evaluation.valid);
  return { selected: valid[0] || null, ranked, valid_count: valid.length, invalid_count: ranked.length - valid.length };
}

export function detectSpecializationGap(bottlenecks = [], policy = {}) {
  const minSeverity = clamp01(policy.minimumBottleneckSeverity ?? 0.25), maxCapability = score(policy.maximumExistingCapabilityScore ?? 75), minGain = score(policy.minimumExpectedGain ?? 5);
  const eligible = bottlenecks.map((row) => ({ ...row, severity: clamp01(row.severity ?? row.share_of_total_cost ?? 0), existing_capability_score: score(row.existing_capability_score), expected_gain: score(row.expected_gain) }))
    .filter((row) => row.severity >= minSeverity && row.existing_capability_score <= maxCapability && row.expected_gain >= minGain && Boolean(String(row.specialization || '').trim()) && Boolean(String(row.metric || '').trim()))
    .sort((a, b) => (b.severity * b.expected_gain) - (a.severity * a.expected_gain));
  return eligible.length ? { confirmed: true, gap: eligible[0], alternatives: eligible.slice(1) } : { confirmed: false, gap: null, alternatives: [] };
}

export function breedSpecialist({ gap, parents = [], policy = {} } = {}) {
  if (!gap || !String(gap.specialization || '').trim()) throw new Error('SPECIALIZATION_GAP_REQUIRED');
  const minParents = Math.max(2, Number(policy.minimumParents ?? 2));
  const maxParents = Math.max(minParents, Math.min(4, Number(policy.maximumParents ?? 4)));
  const selectedParents = parents.filter((parent) => parent?.candidate_id).slice(0, maxParents);
  if (selectedParents.length < minParents) throw new Error('INSUFFICIENT_PARENTS');
  const allowedTraits = new Set(policy.allowedInheritedTraits || ['reasoning_protocol','skills','evidence_policy','tool_strategy','source_hierarchy','failure_handling','context_strategy','domain_knowledge','promoted_lessons']);
  const inherited = {};
  for (const parent of selectedParents) {
    for (const [key, value] of Object.entries(object(parent.genome))) {
      if (!allowedTraits.has(key)) continue;
      const bucket = inherited[key] || [];
      bucket.push({ parent: parent.candidate_id, value });
      inherited[key] = bucket;
    }
  }
  const mutationHypotheses = Array.isArray(gap.mutation_hypotheses) ? gap.mutation_hypotheses.filter(Boolean).slice(0, 2) : [];
  if (policy.mutationRequiresHypothesis !== false && !mutationHypotheses.length) mutationHypotheses.push(`Optimize ${gap.metric} for ${gap.specialization} with measurable expected gain >= ${score(gap.expected_gain)} points.`);
  const slug = slugify(gap.specialization).slice(0, 64) || 'specialist';
  const generation = Math.max(...selectedParents.map((p) => Number(p.generation) || 0)) + 1;
  const parentRefs = selectedParents.map((parent) => parent.candidate_id);
  const lineageSource = [gap.lineage_key || gap.gap_id || gap.id || '', gap.specialization, gap.metric, gap.description || '', ...parentRefs].join('|');
  const lineageSuffix = stableHash(lineageSource).slice(0, 10);
  return {
    candidate_id: `${slug}-g${generation}-${lineageSuffix}`,
    name: `${titleCase(gap.specialization)} G${generation} ${lineageSuffix.toUpperCase()}`,
    generation, role: slug, autonomy_level: 'A2', parent_refs: parentRefs, tools: [], production_authority_granted: false, publication_attempted: false,
    genome: {
      mission: `Reduce measured bottleneck ${gap.metric}: ${String(gap.description || gap.specialization).slice(0, 700)}`,
      specialization: gap.specialization, lineage_key: gap.lineage_key || gap.gap_id || gap.id || null, inherited_traits: inherited,
      evidence_policy: { cannot_claim_external_truth_without_traceable_evidence: true }, mutation_hypotheses: mutationHypotheses, success_metric: gap.metric, expected_gain: score(gap.expected_gain),
    },
  };
}

export function capabilityTier(proofs = [], policy = {}) {
  const cross = Math.max(2, Number(policy.minimumIndependentVenturesForCrossVenture ?? 2)), factoryWide = Math.max(cross + 1, Number(policy.minimumIndependentVenturesForFactoryWide ?? 3)), minWins = Math.max(1, Number(policy.minimumWinsPerVenture ?? 2));
  const winsByVenture = new Map();
  for (const proof of proofs) if (proof?.outcome === 'WIN' && proof?.venture_cell_id) winsByVenture.set(proof.venture_cell_id, (winsByVenture.get(proof.venture_cell_id) || 0) + 1);
  const qualifiedVentures = [...winsByVenture.values()].filter((wins) => wins >= minWins).length;
  if (qualifiedVentures >= factoryWide) return { tier: 'FACTORY_WIDE_CAPABILITY', independent_ventures: qualifiedVentures, authority_expanded: false };
  if (qualifiedVentures >= cross) return { tier: 'CROSS_VENTURE_PROVEN', independent_ventures: qualifiedVentures, authority_expanded: false };
  return { tier: 'VENTURE_LOCAL', independent_ventures: qualifiedVentures, authority_expanded: false };
}

export function applyFeedbackToChain({ feedback = {}, stageResults = [] } = {}) {
  const severity = clamp01(feedback.severity ?? 0), target = inferFeedbackStage(feedback), actions = [];
  const updated = stageResults.map((row) => {
    if (row.stage !== target) return { ...row };
    if (feedback.measured_regression === true || severity >= 0.7) { actions.push({ stage: target, action: 'SUPERSEDE' }, { stage: target, action: 'BRANCH' }); return { ...row, status: 'SUPERSEDED', confidence: Math.max(0, score(row.confidence) - 30) }; }
    if (severity >= 0.35) { actions.push({ stage: target, action: 'REPAIR' }); return { ...row, status: 'REPAIR', confidence: Math.max(0, score(row.confidence) - 15) }; }
    actions.push({ stage: target, action: 'CONFIRM' }); return { ...row, confidence: Math.min(100, score(row.confidence) + 5) };
  });
  return { target_stage: target, actions, stage_results: updated };
}

export function inferFeedbackStage(feedback = {}) {
  const text = `${feedback.kind || ''} ${feedback.summary || ''}`.toLowerCase();
  if (/adoption|retention|pricing|channel|sales|customer acquisition|cac|positioning/.test(text)) return 'GO_TO_MARKET';
  if (/manufactur|yield|energy|capex|opex|throughput|quality/.test(text)) return 'MANUFACTURING';
  if (/product|feature|architecture|usability|performance/.test(text)) return 'PRODUCT';
  if (/material|purity|composition|input cost/.test(text)) return 'MATERIAL';
  if (/resource|deposit|supply|availability|extraction|logistics/.test(text)) return 'RESOURCE';
  return 'USER_FEEDBACK';
}

export function buildVentureCell({ run, selectedChain, members = [] } = {}) {
  if (!run?.id) throw new Error('RUN_REQUIRED');
  if (!selectedChain?.id || selectedChain?.evaluation?.valid !== true) throw new Error('VALID_SELECTED_CHAIN_REQUIRED');
  return {
    run_id: run.id, objective: String(run.objective || '').slice(0, 4000), hypothesis: String(run.hypothesis || run.context?.hypothesis || '').slice(0, 4000), status: 'ACTIVE',
    champion_chain_id: selectedChain.id, champion_chain: selectedChain.composition, budget: object(run.context?.budget), kpis: object(run.context?.kpis),
    assumptions: Array.isArray(run.context?.assumptions) ? run.context.assumptions.slice(0, 40) : [], blockers: [], suppliers: [], customers: [],
    evidence_refs: unique(COMPETITIVE_STAGES.flatMap((stage) => selectedChain.composition?.[stage]?.evidence_refs || [])), feedback: [],
    members: unique(members.length ? members : COMPETITIVE_STAGES.map((stage) => selectedChain.composition?.[stage]?.candidate_id).filter(Boolean)),
  };
}

function weighted(scores, weights) { let total = 0, weightTotal = 0; for (const [key, weightValue] of Object.entries(weights || {})) { const weight = Number(weightValue); if (!Number.isFinite(weight) || weight <= 0) continue; total += score(scores?.[key]) * weight; weightTotal += weight; } return round(weightTotal ? total / weightTotal : 0); }
function probabilityToScore(value) { const n = number(value); return score(n <= 1 ? n * 100 : n); }
function riskToScore(value) { const n = number(value); return score(n <= 1 ? n * 100 : n); }
function inverseRange(value, minValue, maxValue) { const n = number(value); if (!Number.isFinite(n)) return 0; return score(100 * (1 - Math.max(0, Math.min(1, (n - minValue) / (maxValue - minValue))))); }
function logValueScore(value) { const n = Math.max(0, number(value)); if (!Number.isFinite(n) || n <= 0) return 0; return score((Math.log10(n + 1) / 9) * 100); }
function fail(code, extra = {}) { return { ok: false, code, ...extra }; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function score(value) { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.min(100, round(n))) : 0; }
function number(value) { return isFiniteJsonMetric(value) ? value : NaN; }
function finiteOrNull(value) { return isFiniteJsonMetric(value) ? round(value) : null; }
function round(value) { const n = Number(value); return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0; }
function avg(values) { return values.length ? values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length : 0; }
function min(values) { return Math.min(...values); }
function max(values) { return Math.max(...values); }
function clamp01(value) { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0; }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function slugify(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
function titleCase(value) { return String(value || '').trim().split(/\s+/).map((part) => part ? part[0].toUpperCase() + part.slice(1) : part).join(' '); }
function stableHash(value) { let hash = 2166136261; const text = String(value || ''); for (let i = 0; i < text.length; i += 1) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(16).padStart(8, '0') + text.length.toString(16).padStart(2, '0'); }
