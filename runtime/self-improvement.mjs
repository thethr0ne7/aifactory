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

const REVIEWED_REPOSITORY_TARGETS = new Set(['ROUTING_HEURISTIC', 'SKILL_PATCH', 'WORKFLOW_PATCH']);
const WORKFLOW_PRIVILEGE_EXPANSION = [
  /\bcontents:\s*write\b/i,
  /\bpull-requests:\s*write\b/i,
  /\bactions:\s*write\b/i,
  /\bchecks:\s*write\b/i,
  /\bdeployments:\s*write\b/i,
  /\bpackages:\s*write\b/i,
  /\bsecurity-events:\s*write\b/i,
  /\bstatuses:\s*write\b/i,
  /\bid-token:\s*write\b/i,
];

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
  const score_scale = String(raw.score_scale || '').trim();
  return {
    baseline_score: baseline,
    candidate_score: candidate,
    dimension_scores: scores,
    score_scale,
    score_scale_valid: score_scale === '0-100',
    no_protected_boundary_violation: raw.no_protected_boundary_violation === true,
    regression_cases_passed: raw.regression_cases_passed === true,
    patch_faithful: raw.patch_faithful === true,
    unsupported_assumptions,
    rationale: String(raw.rationale || '').slice(0, 4000),
  };
}

export function decidePromotion({ risk, evaluation, policy, targetType = 'MEMORY_GUIDANCE' }) {
  const cfg = policy?.evaluation || {};
  if (risk?.risk_class !== 'LOW') return { action: 'REVIEW_REQUIRED', reason: `risk=${risk?.risk_class || 'UNKNOWN'}` };
  if (!evaluation?.no_protected_boundary_violation) return { action: 'REJECT', reason: 'protected boundary violation' };
  if (!evaluation?.patch_faithful) return { action: 'REJECT', reason: 'evaluation is not faithful to represented patch' };
  if ((evaluation?.unsupported_assumptions || []).length) return { action: 'REJECT', reason: 'evaluation relies on unsupported candidate changes' };
  if (!evaluation?.score_scale_valid) return { action: 'REJECT', reason: 'evaluation score scale is missing or not 0-100' };
  if (!evaluation?.regression_cases_passed) return { action: 'REJECT', reason: 'regression cases failed' };

  const minCandidate = Number(cfg.minimumCandidateScore ?? 80);
  const minDimension = Number(cfg.minimumDimensionScore ?? 75);
  const minDelta = Number(cfg.minimumImprovementOverBaseline ?? 5);
  const dimensions = Object.values(evaluation.dimension_scores || {});

  if (evaluation.candidate_score < minCandidate) return { action: 'REJECT', reason: 'candidate score below threshold' };
  if (evaluation.candidate_score - evaluation.baseline_score < minDelta) return { action: 'REJECT', reason: 'insufficient improvement over baseline' };
  if (dimensions.some((score) => score < minDimension)) return { action: 'REJECT', reason: 'one or more dimensions below threshold' };

  const autoTargets = new Set(policy?.automaticPromotion?.allowedTargetTypes || ['MEMORY_GUIDANCE']);
  if (!autoTargets.has(String(targetType || ''))) {
    return { action: 'REVIEW_REQUIRED', reason: `target=${targetType || 'UNKNOWN'} requires explicit reviewed repository path` };
  }

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

export function buildImprovementPatch(candidate = {}) {
  const change = candidate?.candidate_change && typeof candidate.candidate_change === 'object' && !Array.isArray(candidate.candidate_change)
    ? candidate.candidate_change
    : {};
  const targetType = String(change.target_type || change.targetType || '').trim().toUpperCase();

  if (REVIEWED_REPOSITORY_TARGETS.has(targetType)) {
    const repoPath = String(change.path || change.target_ref || '').replace(/\\/g, '/').trim();
    return {
      target_type: targetType,
      target_ref: repoPath || null,
      patch: {
        operation: 'reviewed-repository-candidate',
        path: repoPath,
        content: typeof change.content === 'string' ? change.content : '',
        expected_blob_sha: String(change.expected_blob_sha || '').trim() || null,
        reason: String(change.reason || candidate.statement || '').trim().slice(0, 2000),
      },
      rollback: {
        operation: 'discard-candidate-branch',
        path: repoPath || null,
        restore_blob_sha: String(change.expected_blob_sha || '').trim() || null,
      },
      rollback_ref: `review-only:${candidate.lesson_id || 'unknown'}:${repoPath || 'missing-path'}`,
    };
  }

  return buildMemoryPatch(candidate);
}

export function validateReviewedRepositoryPatch(candidate = {}, policy = {}) {
  const targetType = String(candidate.target_type || '').toUpperCase();
  const patch = candidate.patch && typeof candidate.patch === 'object' && !Array.isArray(candidate.patch) ? candidate.patch : {};
  const cfg = policy?.reviewedRepositoryPatches || {};
  const allowedTypes = new Set(cfg.allowedTargetTypes || ['ROUTING_HEURISTIC','SKILL_PATCH','WORKFLOW_PATCH']);
  if (!allowedTypes.has(targetType)) return { ok: false, code: 'TARGET_TYPE_NOT_REVIEWABLE' };
  if (!new Set(['LOW','MEDIUM']).has(String(candidate.risk_class || '').toUpperCase())) return { ok: false, code: 'RISK_REQUIRES_HIGHER_AUTHORITY' };

  const repoPath = normalizeRepoPath(patch.path || candidate.target_ref);
  if (!repoPath) return { ok: false, code: 'INVALID_PATH' };
  const content = typeof patch.content === 'string' ? patch.content : '';
  const maxChars = Math.max(1, Math.min(Number(cfg.maxContentCharacters) || 100000, 100000));
  if (!content || content.length > maxChars) return { ok: false, code: 'CONTENT_SIZE_INVALID', path: repoPath };
  if (!String(patch.reason || '').trim()) return { ok: false, code: 'REASON_REQUIRED', path: repoPath };
  if (patch.expected_blob_sha && !/^[0-9a-f]{40}$/i.test(String(patch.expected_blob_sha))) {
    return { ok: false, code: 'INVALID_EXPECTED_BLOB_SHA', path: repoPath };
  }

  const denied = new Set(cfg.deniedPaths || []);
  if (denied.has(repoPath)) return { ok: false, code: 'PROTECTED_PATH', path: repoPath };

  if (targetType === 'SKILL_PATCH' && !repoPath.startsWith('skills/')) return { ok: false, code: 'SKILL_PATH_NOT_ALLOWLISTED', path: repoPath };
  if (targetType === 'ROUTING_HEURISTIC' && !(cfg.routingPaths || ['registry/agent-routing.json']).includes(repoPath)) {
    return { ok: false, code: 'ROUTING_PATH_NOT_ALLOWLISTED', path: repoPath };
  }
  if (targetType === 'WORKFLOW_PATCH') {
    if (!repoPath.startsWith('.github/workflows/')) return { ok: false, code: 'WORKFLOW_PATH_NOT_ALLOWLISTED', path: repoPath };
    const privilegeHit = WORKFLOW_PRIVILEGE_EXPANSION.find((pattern) => pattern.test(content));
    if (privilegeHit) return { ok: false, code: 'WORKFLOW_PRIVILEGE_EXPANSION_DENIED', path: repoPath, protected_hit: privilegeHit.source };
  }

  return { ok: true, path: repoPath, target_type: targetType, content, expected_blob_sha: patch.expected_blob_sha || null, reason: String(patch.reason).trim().slice(0, 2000) };
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

function normalizeRepoPath(value) {
  const raw = String(value || '').replace(/\\/g, '/').trim();
  if (!raw || raw.startsWith('/') || raw.includes('\u0000')) return null;
  const parts = raw.split('/');
  if (parts.some((part) => part === '..' || part === '')) return null;
  if (raw === '.git' || raw.startsWith('.git/')) return null;
  return parts.filter((part) => part !== '.').join('/');
}

function clampScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n * 100) / 100));
}
