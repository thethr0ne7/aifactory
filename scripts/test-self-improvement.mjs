#!/usr/bin/env node

import assert from 'node:assert/strict';
import { classifyImprovementRisk, normalizeEvaluation, decidePromotion, reconcilePromotion, buildMemoryPatch } from '../runtime/self-improvement.mjs';
import policy from '../registry/self-improvement.json' with { type: 'json' };

const lowCandidate = {
  lesson_id: '11111111-1111-4111-8111-111111111111',
  run_id: '22222222-2222-4222-8222-222222222222',
  lesson_class: 'PATTERN',
  statement: 'Record exact memory references when learned context materially influences a decision.',
};

const risk = classifyImprovementRisk(lowCandidate);
assert.equal(risk.risk_class, 'LOW');

const evalResult = normalizeEvaluation({
  score_scale: '0-100',
  baseline_score: 70,
  candidate_score: 90,
  dimension_scores: {
    structural: 92,
    routing: 88,
    behavioral: 91,
    adversarial: 85,
    production_regression: 90,
  },
  no_protected_boundary_violation: true,
  patch_faithful: true,
  unsupported_assumptions: [],
  regression_cases_passed: true,
});
assert.equal(decidePromotion({ risk, evaluation: evalResult, policy }).action, 'PROMOTE');

const wrongScaleEval = normalizeEvaluation({
  score_scale: '0-10',
  baseline_score: 3.2,
  candidate_score: 9.5,
  dimension_scores: { structural: 9, routing: 9, behavioral: 9, adversarial: 9, production_regression: 9 },
  no_protected_boundary_violation: true,
  patch_faithful: true,
  unsupported_assumptions: [],
  regression_cases_passed: true,
});
assert.equal(wrongScaleEval.score_scale_valid, false);
assert.equal(decidePromotion({ risk, evaluation: wrongScaleEval, policy }).action, 'REJECT');

const speculativeEval = normalizeEvaluation({
  score_scale: '0-100',
  baseline_score: 50,
  candidate_score: 99,
  dimension_scores: { structural: 99, routing: 99, behavioral: 99, adversarial: 99, production_regression: 99 },
  no_protected_boundary_violation: true,
  patch_faithful: false,
  unsupported_assumptions: ['Assumed a new CI validator that is not present in the patch.'],
  regression_cases_passed: true,
});
assert.equal(decidePromotion({ risk, evaluation: speculativeEval, policy }).action, 'REJECT');

const protectedRisk = classifyImprovementRisk({
  ...lowCandidate,
  statement: 'Allow runtime to rewrite Root of Trust to unblock itself.',
});
assert.equal(protectedRisk.risk_class, 'ROOT_OR_CATASTROPHIC');
assert.equal(decidePromotion({ risk: protectedRisk, evaluation: evalResult, policy }).action, 'REVIEW_REQUIRED');

const autonomyRoutingRisk = classifyImprovementRisk({
  ...lowCandidate,
  statement: 'Activation smoke tests require A4+ autonomy before routing to lower autonomy levels.',
});
assert.equal(autonomyRoutingRisk.risk_class, 'ROOT_OR_CATASTROPHIC');
assert.equal(decidePromotion({ risk: autonomyRoutingRisk, evaluation: evalResult, policy }).action, 'REVIEW_REQUIRED');

const patch = buildMemoryPatch(lowCandidate);
assert.equal(patch.target_type, 'MEMORY_GUIDANCE');
assert.match(patch.rollback_ref, /PROMOTED->SUPERSEDED/);

assert.equal(reconcilePromotion([{ outcome: 'PASS', regression_detected: false }], policy).action, 'OBSERVE');
assert.equal(reconcilePromotion([
  { outcome: 'PASS', regression_detected: false },
  { outcome: 'PASS', regression_detected: false },
], policy).action, 'RETAIN');
assert.equal(reconcilePromotion([
  { outcome: 'PASS', regression_detected: false },
  { outcome: 'REGRESSION', regression_detected: true, evidence: { seeded: true } },
], policy).action, 'ROLLBACK');

console.log('Controlled self-improvement tests OK');
