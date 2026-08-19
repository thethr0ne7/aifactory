import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeAgentCandidate,
  nextGeneration,
  buildExperimentPlan,
  assessPromotion,
} from '../../runtime/agent-nursery.mjs';
import {
  buildN8nNurseryEnvelope,
  buildOpikEvaluationEnvelope,
  mapOpikMetricsToFactoryDimensions,
} from '../../runtime/external-eval-adapters.mjs';
import {
  planPdfExtraction,
  normalizeSweepSnapshot,
  compareSweepSnapshots,
  gateDefensiveOsintRequest,
  normalizeRuntimeTelemetry,
} from '../../runtime/intelligence-routing.mjs';

const requiredDimensions = {
  task_success: { score: 0.9, evidence_class: 'MEASURED', basis: 'benchmark' },
  evidence_quality: { score: 0.9, evidence_class: 'OBSERVED', basis: 'trace review' },
  truthfulness: { score: 0.95, evidence_class: 'OBSERVED', basis: 'claim audit' },
  safety_compliance: { score: 1, evidence_class: 'CONFIRMED', basis: 'negative-action suite' },
  tool_discipline: { score: 0.9, evidence_class: 'OBSERVED', basis: 'tool traces' },
  cost_or_resource_efficiency: { score: 0.7, evidence_class: 'MEASURED', basis: 'token/resource counters' },
};

test('agent candidate normalization and bounded generation are deterministic in policy shape', () => {
  const parent = normalizeAgentCandidate({
    candidate_id: 'research-parent',
    generation: 4,
    role: 'research',
    skills: ['research-truth'],
    tools: ['web'],
    autonomy_level: 'A3',
    provenance: { source: 'test' },
  });
  const child = nextGeneration([parent], { add_skills: ['claim-checker'], summary: 'add claim verification' });
  assert.equal(child.generation, 5);
  assert.deepEqual(child.parent_refs, ['research-parent']);
  assert.ok(child.skills.includes('research-truth'));
  assert.ok(child.skills.includes('claim-checker'));
  assert.equal(child.autonomy_level, 'A3');
});

test('promotion never becomes automatic and requires baseline/regression evidence', () => {
  const candidate = normalizeAgentCandidate({
    candidate_id: 'candidate-1',
    generation: 1,
    role: 'research',
    skills: ['research-truth'],
    tools: ['web'],
    autonomy_level: 'A3',
    provenance: { source: 'nursery' },
  });
  const plan = buildExperimentPlan(candidate, { baseline_ref: 'baseline:1', regression_suite_ref: 'evals:1' });
  assert.equal(plan.promotion_authority, 'AI Factory');

  const decision = assessPromotion(candidate, {
    evaluation_id: 'eval-1',
    candidate_ref: candidate.candidate_id,
    baseline_ref: 'baseline:1',
    regression_suite_ref: 'evals:1',
    regression_passed: true,
    dimensions: requiredDimensions,
  });
  assert.equal(decision.decision, 'ELIGIBLE_FOR_HUMAN_PROMOTION_REVIEW');
  assert.equal(decision.automatic_promotion, false);
  assert.equal(decision.failures.length, 0);
});

test('A4 nursery candidate and missing dimensions are rejected for repair', () => {
  const candidate = normalizeAgentCandidate({
    candidate_id: 'candidate-a4', generation: 1, role: 'ops', autonomy_level: 'A4', provenance: { source: 'test' },
  });
  const incompleteDimensions = { ...requiredDimensions };
  delete incompleteDimensions.truthfulness;
  const decision = assessPromotion(candidate, {
    baseline_ref: 'baseline', regression_suite_ref: 'suite', regression_passed: true,
    dimensions: incompleteDimensions,
  });
  assert.equal(decision.decision, 'REJECT_OR_REPAIR');
  assert.ok(decision.failures.some((x) => x.includes('exceeds automatic nursery ceiling A3')));
  assert.ok(decision.failures.some((x) => x.includes('missing required dimension: truthfulness')));
});

test('n8n envelope carries a hard authority boundary', () => {
  const envelope = buildN8nNurseryEnvelope('spawn_candidate', { role: 'research' }, { candidate_ref: 'c1' });
  assert.equal(envelope.authority.max_autonomy, 'A3');
  assert.equal(envelope.authority.root_of_trust_mutation, false);
  assert.equal(envelope.authority.self_promotion, false);
  assert.throws(() => buildN8nNurseryEnvelope('rewrite_constitution', {}));
});

test('Opik metrics map to Factory dimensions but retain evidence classes', () => {
  const envelope = buildOpikEvaluationEnvelope({
    candidate_ref: 'c1',
    metrics: [
      { name: 'accuracy', score: 0.91, evidence_class: 'MEASURED', basis: 'dataset' },
      { name: 'judge_truth', score: 0.88, evidence_class: 'OBSERVED', basis: 'judge trace' },
    ],
  });
  const mapped = mapOpikMetricsToFactoryDimensions(envelope, { accuracy: 'task_success', judge_truth: 'truthfulness' });
  assert.equal(mapped.task_success.evidence_class, 'MEASURED');
  assert.equal(mapped.truthfulness.evidence_class, 'OBSERVED');
});

test('PDF routing chooses per-page extraction for mixed documents', () => {
  const plan = planPdfExtraction({
    kind: 'MIXED',
    pages: [
      { page: 1, kind: 'TEXT_BASED', confidence: 0.9 },
      { page: 2, kind: 'SCANNED', confidence: 0.8 },
    ],
  });
  assert.equal(plan.document_route, 'SELECTIVE_PER_PAGE');
  assert.equal(plan.per_page[0].route, 'NATIVE_EXTRACTION');
  assert.equal(plan.per_page[1].route, 'OCR_OR_VISION');
  assert.equal(plan.preserve_page_provenance, true);
});

test('intelligence sweep exposes content and source-health deltas', () => {
  const before = normalizeSweepSnapshot({ sweep_id: 's1', sources: [{ source_id: 'ministry', state: 'HEALTHY', content: 'v1' }] });
  const after = normalizeSweepSnapshot({ sweep_id: 's2', sources: [{ source_id: 'ministry', state: 'STALE', content: 'v2' }] });
  const delta = compareSweepSnapshots(before, after);
  assert.equal(delta.changed, true);
  assert.ok(delta.deltas.some((x) => x.type === 'CONTENT_CHANGED'));
  assert.ok(delta.deltas.some((x) => x.type === 'SOURCE_STATE_CHANGED'));
});

test('defensive OSINT gate blocks unauthorized private-person lookup', () => {
  const blocked = gateDefensiveOsintRequest({ purpose: 'organization-due-diligence', scope: 'bounded', target_type: 'private-person' });
  assert.equal(blocked.decision, 'BLOCKED');
  const allowed = gateDefensiveOsintRequest({ purpose: 'organization-due-diligence', scope: 'company public footprint', target_type: 'organization' });
  assert.equal(allowed.decision, 'ALLOWED_BOUNDED');
});

test('runtime telemetry labels source metrics measured and flags public source exposure', () => {
  const telemetry = normalizeRuntimeTelemetry({
    node_ref: 'worker-1',
    source_endpoint_exposure: 'public',
    metrics: [{ name: 'cpu_load', value: 55, unit: '%' }],
  });
  assert.equal(telemetry.metrics[0].evidence_class, 'MEASURED');
  assert.equal(telemetry.source_endpoint_exposure, 'PUBLIC_RISK');
});
