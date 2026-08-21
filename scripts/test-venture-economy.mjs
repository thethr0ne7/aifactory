import assert from 'node:assert/strict';
import {
  COMPETITIVE_STAGES,
  validateStageCandidate,
  paretoFrontier,
  selectChampion,
  generateCompatibleChains,
  propagateChainConstraints,
  selectBestChain,
  detectSpecializationGap,
  breedSpecialist,
  capabilityTier,
  applyFeedbackToChain,
  buildVentureCell,
  isFiniteJsonMetric,
  shouldExecuteVentureRun,
} from '../runtime/venture-economy.mjs';

const evidence = '11111111-1111-4111-8111-111111111111';
const baseMetrics = {
  technical_success_probability: 0.86,
  market_adoption_probability: 0.72,
  regulatory_risk: 20,
  supply_risk: 18,
  defensibility: 82,
  scalability: 88,
  expected_enterprise_value: 120000000,
  gross_margin: 52,
  time_to_market_months: 16,
  capex: 15000000,
  opex: 4000000,
  unit_cost: 20,
  max_material_input_cost: 25,
  capital_ceiling: 25000000,
};
function candidate(stage, id, overrides = {}) {
  return {
    stage,
    candidate_id: id,
    claim: `${id} synthetic control claim`,
    evidence_class: 'DERIVED',
    evidence_refs: [evidence],
    confidence: 90,
    fitness_score: 90,
    metrics: { ...baseMetrics, ...(overrides.metrics || {}) },
    ...overrides,
  };
}
function scores(overrides = {}) {
  return {
    task_success: 90,
    evidence_quality: 92,
    truthfulness: 94,
    contradiction_detection: 85,
    downstream_value: 90,
    latency: 80,
    cost_efficiency: 82,
    tool_discipline: 100,
    safety_compliance: 100,
    ...overrides,
  };
}

assert.equal(isFiniteJsonMetric(0), true);
assert.equal(isFiniteJsonMetric(0.42), true);
assert.equal(isFiniteJsonMetric(null), false);
assert.equal(isFiniteJsonMetric(''), false);
assert.equal(isFiniteJsonMetric('12'), false);
assert.equal(isFiniteJsonMetric(Number.NaN), false);
assert.equal(shouldExecuteVentureRun({ id: 'run-1', status: 'WORKING' }), true);
for (const status of ['COMPLETE','FAILED','BLOCKED','REJECTED','CANCELLED']) assert.equal(shouldExecuteVentureRun({ id: 'run-1', status }), false, `${status} must not rerun`);

assert.equal(validateStageCandidate(candidate('RESOURCE', 'resource-a'), { stage: 'RESOURCE' }).ok, true);
assert.equal(validateStageCandidate({ ...candidate('RESOURCE', 'resource-a'), evidence_class: 'ASSUMPTION' }, { stage: 'RESOURCE' }).ok, false);
assert.equal(validateStageCandidate({ ...candidate('RESOURCE', 'resource-a'), evidence_refs: [] }, { stage: 'RESOURCE' }).code, 'EVIDENCE_REFS_REQUIRED');
assert.equal(validateStageCandidate(candidate('RESOURCE', 'resource-null', { metrics: { supply_risk: null } }), { stage: 'RESOURCE' }).code, 'NON_NUMERIC_METRIC');

const frontier = paretoFrontier([
  { candidate_id: 'a', scores: scores({ task_success: 95, latency: 75 }) },
  { candidate_id: 'b', scores: scores({ task_success: 90, latency: 90 }) },
  { candidate_id: 'c', scores: scores({ task_success: 80, latency: 70, evidence_quality: 80 }) },
]);
assert.deepEqual(frontier.map((x) => x.candidate_id).sort(), ['a', 'b']);

const championTrials = [];
for (let i = 0; i < 3; i += 1) {
  championTrials.push({ candidate_id: 'candidate-a', niche: 'resource discovery', context_key: 'venture:x', outcome: 'PASS', scores: scores({ task_success: 93, evidence_quality: 95 }) });
  championTrials.push({ candidate_id: 'candidate-b', niche: 'resource discovery', context_key: 'venture:x', outcome: 'PASS', scores: scores({ task_success: 86, evidence_quality: 88, latency: 95 }) });
}
const champion = selectChampion(championTrials, { minimumTrialsForChampion: 3, minimumHardGateScore: 75, hardGateDimensions: ['evidence_quality','truthfulness','safety_compliance'] });
assert.equal(champion.champion?.candidate_id, 'candidate-a');
assert.equal(champion.reason, 'PARETO_PLUS_CONTEXT');
const insufficient = selectChampion(championTrials.slice(0, 2), { minimumTrialsForChampion: 3 });
assert.equal(insufficient.champion, null);

const pools = {};
for (const stage of COMPETITIVE_STAGES) pools[stage] = [candidate(stage, `${stage.toLowerCase()}-a`), candidate(stage, `${stage.toLowerCase()}-b`, { confidence: 85, fitness_score: 86 })];
const chains = generateCompatibleChains(pools, { topKPerStage: 2, maximumChains: 128 });
assert.equal(chains.length, 128);
const selection = selectBestChain(chains, {});
assert.ok(selection.selected);
assert.equal(selection.selected.evaluation.valid, true);
assert.equal(selection.valid_count, 128);

const bad = JSON.parse(JSON.stringify(chains[0]));
bad.composition.MATERIAL.metrics.unit_cost = 80;
bad.composition.PRODUCT.metrics.max_material_input_cost = 25;
const constraint = propagateChainConstraints(bad);
assert.equal(constraint.valid, false);
assert.equal(constraint.violations.some((v) => v.code === 'MATERIAL_COST_EXCEEDS_PRODUCT_LIMIT'), true);
assert.equal(selectBestChain([bad], {}).selected, null);

const missingMetric = JSON.parse(JSON.stringify(chains[0]));
missingMetric.composition.MANUFACTURING.metrics.time_to_market_months = null;
assert.equal(propagateChainConstraints(missingMetric).valid, false, 'null stage metric must fail stage gate rather than become zero');

const gap = detectSpecializationGap([
  { specialization: 'industrial purification optimization', metric: 'purification_cost_share', description: '42% cost share', severity: 0.42, existing_capability_score: 68, expected_gain: 17 },
  { specialization: 'minor formatting', metric: 'format', severity: 0.05, existing_capability_score: 40, expected_gain: 20 },
], { minimumBottleneckSeverity: 0.25, maximumExistingCapabilityScore: 75, minimumExpectedGain: 5 });
assert.equal(gap.confirmed, true);
assert.equal(gap.gap.specialization, 'industrial purification optimization');

const parentSet = [
  { candidate_id: 'materials-parent-g2', generation: 2, genome: { skills: ['materials'], evidence_policy: { traceable: true }, domain_knowledge: { purity: true }, secret: 'must-not-inherit' } },
  { candidate_id: 'manufacturing-parent-g2', generation: 2, genome: { skills: ['manufacturing'], failure_handling: { block: true }, tool_strategy: { bounded: true } } },
];
const breedingPolicy = { minimumParents: 2, maximumParents: 4, allowedInheritedTraits: ['skills','evidence_policy','domain_knowledge','failure_handling','tool_strategy'], mutationRequiresHypothesis: true };
const child = breedSpecialist({
  gap: { ...gap.gap, lineage_key: 'venture:v1:gap:g1', mutation_hypotheses: ['Reduce purification cost share below 0.35 while preserving quality.'] },
  parents: parentSet,
  policy: breedingPolicy,
});
const childOtherLineage = breedSpecialist({
  gap: { ...gap.gap, lineage_key: 'venture:v2:gap:g2', mutation_hypotheses: ['Reduce purification cost share below 0.35 while preserving quality.'] },
  parents: parentSet,
  policy: breedingPolicy,
});
assert.notEqual(child.candidate_id, childOtherLineage.candidate_id, 'offspring ids must be lineage-unique');
assert.notEqual(child.name, childOtherLineage.name, 'n8n names must not alias distinct lineages');
assert.equal(child.autonomy_level, 'A2');
assert.deepEqual(child.tools, []);
assert.equal(child.production_authority_granted, false);
assert.equal(child.publication_attempted, false);
assert.equal(child.parent_refs.length, 2);
assert.equal(Object.hasOwn(child.genome.inherited_traits, 'secret'), false);
assert.ok(child.genome.inherited_traits.skills.length >= 2);

assert.deepEqual(capabilityTier([{ outcome: 'WIN', venture_cell_id: 'v1' }, { outcome: 'WIN', venture_cell_id: 'v1' }], { minimumWinsPerVenture: 2, minimumIndependentVenturesForCrossVenture: 2, minimumIndependentVenturesForFactoryWide: 3 }).tier, 'VENTURE_LOCAL');
assert.deepEqual(capabilityTier([
  { outcome: 'WIN', venture_cell_id: 'v1' }, { outcome: 'WIN', venture_cell_id: 'v1' },
  { outcome: 'WIN', venture_cell_id: 'v2' }, { outcome: 'WIN', venture_cell_id: 'v2' },
], { minimumWinsPerVenture: 2, minimumIndependentVenturesForCrossVenture: 2, minimumIndependentVenturesForFactoryWide: 3 }).tier, 'CROSS_VENTURE_PROVEN');
assert.deepEqual(capabilityTier([
  { outcome: 'WIN', venture_cell_id: 'v1' }, { outcome: 'WIN', venture_cell_id: 'v1' },
  { outcome: 'WIN', venture_cell_id: 'v2' }, { outcome: 'WIN', venture_cell_id: 'v2' },
  { outcome: 'WIN', venture_cell_id: 'v3' }, { outcome: 'WIN', venture_cell_id: 'v3' },
], { minimumWinsPerVenture: 2, minimumIndependentVenturesForCrossVenture: 2, minimumIndependentVenturesForFactoryWide: 3 }).tier, 'FACTORY_WIDE_CAPABILITY');

const feedback = applyFeedbackToChain({
  feedback: { kind: 'manufacturing cost regression', summary: 'Purification cost rose', severity: 0.8, measured_regression: true },
  stageResults: [{ stage: 'MANUFACTURING', status: 'PASS', confidence: 90 }, { stage: 'PRODUCT', status: 'PASS', confidence: 88 }],
});
assert.equal(feedback.target_stage, 'MANUFACTURING');
assert.equal(feedback.actions.some((a) => a.action === 'SUPERSEDE'), true);
assert.equal(feedback.stage_results.find((r) => r.stage === 'MANUFACTURING').status, 'SUPERSEDED');

const selectedChain = { ...selection.selected, evaluation: selection.selected.evaluation };
const cell = buildVentureCell({ run: { id: '22222222-2222-4222-8222-222222222222', objective: 'control', context: {} }, selectedChain });
assert.equal(cell.status, 'ACTIVE');
assert.ok(cell.members.length >= 1);
assert.equal(cell.evidence_refs.length >= 1, true);

console.log('Venture Economy kernel tests passed');
