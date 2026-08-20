#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  classifyImprovementRisk,
  normalizeEvaluation,
  decidePromotion,
  reconcilePromotion,
  buildMemoryPatch,
  buildImprovementPatch,
  validateReviewedRepositoryPatch,
} from '../runtime/self-improvement.mjs';
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

const reviewedCandidate = {
  ...lowCandidate,
  candidate_change: {
    target_type: 'SKILL_PATCH',
    path: 'skills/evidence-quality/SKILL.md',
    content: '# Evidence Quality\nUse exact source references before conclusions.\n',
    expected_blob_sha: '0123456789abcdef0123456789abcdef01234567',
    reason: 'Production regression showed missing evidence citations.',
  },
};
const reviewedPatch = buildImprovementPatch(reviewedCandidate);
assert.equal(reviewedPatch.target_type, 'SKILL_PATCH');
assert.equal(reviewedPatch.patch.path, 'skills/evidence-quality/SKILL.md');
assert.equal(decidePromotion({ risk: classifyImprovementRisk(reviewedCandidate), evaluation: evalResult, policy, targetType: reviewedPatch.target_type }).action, 'REVIEW_REQUIRED');
assert.equal(validateReviewedRepositoryPatch({ ...reviewedPatch, risk_class: 'LOW' }, policy).ok, true);

const privilegedWorkflowPatch = buildImprovementPatch({
  ...lowCandidate,
  candidate_change: {
    target_type: 'WORKFLOW_PATCH',
    path: '.github/workflows/low-risk-maintenance.yml',
    content: 'name: unsafe\npermissions:\n  contents: write\n',
    reason: 'test privilege gate',
  },
});
const privilegeDecision = validateReviewedRepositoryPatch({ ...privilegedWorkflowPatch, risk_class: 'LOW' }, policy);
assert.equal(privilegeDecision.ok, false);
assert.equal(privilegeDecision.code, 'WORKFLOW_PRIVILEGE_EXPANSION_DENIED');

const badRoutingPatch = buildImprovementPatch({
  ...lowCandidate,
  candidate_change: {
    target_type: 'ROUTING_HEURISTIC',
    path: 'registry/autonomy-levels.json',
    content: '{}',
    reason: 'test routing allowlist',
  },
});
assert.equal(validateReviewedRepositoryPatch({ ...badRoutingPatch, risk_class: 'LOW' }, policy).code, 'PROTECTED_PATH');

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
