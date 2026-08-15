const PROTECTED_PATTERNS = [
  /root of trust/i,
  /catastrophic/i,
  /weaken(?:ing)? security/i,
  /security weaken/i,
  /production permission/i,
  /autonomy ceiling/i,
  /raise autonomy/i,
  /\bA[0-7]\+\s+autonomy/i,
  /autonomy level/i,
  /lower autonomy/i,
  /higher autonomy/i,
  /service[_ -]?role/i,
  /secret handling/i,
  /unrestricted filesystem/i,
  /unbounded network/i,
];

const LOW_RISK_CLASSES = new Set([
  'PATTERN',
  'HEURISTIC',
  'SUCCESS_PATTERN',
  'EVIDENCE_GAP',
  'SPEC_GAP',
  'QUALITY_REGRESSION',
]);

export function classifyImprovementRisk(candidate = {}) {
  const text = [
    candidate.statement,
    candidate.lesson_class,
    candidate.incident_summary,
    JSON.stringify(candidate.candidate_change || {}),
  ].filter(Boolean).join(' ');

  if (String(candidate.incident_severity || '').toUpperCase() === 'CATASTROPHIC') {
    return { risk_class: 'ROOT_OR_CATASTROPHIC', protected_hits: ['CATASTROPHIC incident'] };
  }

  const protected_hits = PROTECTED_PATTERNS.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source);
  if (protected_hits.length) {
    return { risk_class: 'ROOT_OR_CATASTROPHIC', protected_hits };
  }

  if (!LOW_RISK_CLASSES.has(String(candidate.lesson_class || '').toUpperCase())) {
    return { risk_class: 'MEDIUM', protected_hits: [] };
  }

  if (!candidate.run_id) {
    return { risk_class: 'MEDIUM', protected_hits: ['missing production-derived run'] };
  }

  return { risk_class: 'LOW', protected_hits: [] };
}

export function normalizeEvaluation(raw = {}) {
  const dimensions = ['structural','routing','behavioral','adversarial','production_regression'];
  const baseline = clampScore(raw.baseline_score);
  const candidate = clampScore(raw.candidate_score);
  const scores = {};
  for (const key of dimensions) scores[key] = clampScore(raw.dimension_scores?.[key]);
  const unsupported_assumptions = Array.isArray(raw.unsupported_assumptions)
    ? [...new Set(raw.unsupported_assumptions.map((x) => String(x || '').trim()).filter(Boolean))].slice(0, 10)
    : [];
  return {
    baseline_score: baseline,
    candidate_score: candidate,
    dimension_scores: scores,
    no_protected_boundary_violation: raw.no_protected_boundary_violation === true,
    regression_cases_passed: raw.regression_cases_passed === true,
    patch_faithful: raw.patch_faithful === true,
    unsupported_assumptions,
    rationale: String(raw.rationale || '').slice(0, 4000),
  };
}

export function decidePromotion({ risk, evaluation, policy }) {
  const cfg = policy?.evaluation || {};
  if (risk?.risk_class !== 'LOW') return { action: 'REVIEW_REQUIRED', reason: `risk=${risk?.risk_class || 'UNKNOWN'}` };
  if (!evaluation?.no_protected_boundary_violation) return { action: 'REJECT', reason: 'protected boundary violation' };
  if (!evaluation?.patch_faithful) return { action: 'REJECT', reason: 'evaluation is not faithful to represented patch' };
  if ((evaluation?.unsupported_assumptions || []).length) return { action: 'REJECT', reason: 'evaluation relies on unsupported candidate changes' };
  if (!evaluation?.regression_cases_passed) return { action: 'REJECT', reason: 'regression cases failed' };

  const minCandidate = Number(cfg.minimumCandidateScore ?? 80);
  const minDimension = Number(cfg.minimumDimensionScore ?? 75);
  const minDelta = Number(cfg.minimumImprovementOverBaseline ?? 5);
  const dimensions = Object.values(evaluation.dimension_scores || {});

  if (evaluation.candidate_score < minCandidate) return { action: 'REJECT', reason: 'candidate score below threshold' };
  if (evaluation.candidate_score - evaluation.baseline_score < minDelta) return { action: 'REJECT', reason: 'insufficient improvement over baseline' };
  if (dimensions.some((score) => score < minDimension)) return { action: 'REJECT', reason: 'one or more dimensions below threshold' };

  return { action: 'PROMOTE', reason: 'A4 low-risk gates passed' };
}

export function reconcilePromotion(observations = [], policy = {}) {
  const minPass = Number(policy?.observation?.minimumPassObservationsToRetain ?? 2);
  const regression = observations.find((x) => x.regression_detected === true || x.outcome === 'REGRESSION');
  if (regression) return { action: 'ROLLBACK', reason: 'regression detected', evidence: regression };
  const passCount = observations.filter((x) => x.outcome === 'PASS' && x.regression_detected !== true).length;
  if (passCount >= minPass) return { action: 'RETAIN', reason: `${passCount} pass observations` };
  return { action: 'OBSERVE', reason: `${passCount}/${minPass} pass observations` };
}

export function buildMemoryPatch(candidate) {
  return {
    target_type: 'MEMORY_GUIDANCE',
    target_ref: `af_lessons/${candidate.lesson_id}`,
    patch: {
      operation: 'activate-promoted-guidance',
      lesson_id: candidate.lesson_id,
      statement: String(candidate.statement || '').slice(0, 6000),
      authority_after_promotion: 'PROMOTED',
    },
    rollback: {
      operation: 'supersede-promoted-guidance',
      lesson_id: candidate.lesson_id,
      restore_authority: 'SUPERSEDED_HISTORY',
    },
    rollback_ref: `lesson:${candidate.lesson_id}:PROMOTED->SUPERSEDED`,
  };
}

function clampScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n * 100) / 100));
}
