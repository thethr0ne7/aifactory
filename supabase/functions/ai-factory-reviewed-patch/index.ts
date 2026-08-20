import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "npm:jose@6";

type GitHubClaims = JWTPayload & {
  repository?: string;
  repository_id?: string;
  ref?: string;
  event_name?: string;
  workflow_ref?: string;
  job_workflow_ref?: string;
  run_id?: string;
  actor?: string;
  sha?: string;
};

type RequestBody = { patch_candidate_id?: string };

const SUPABASE_URL = mustEnv("SUPABASE_URL");
const db = createClient(SUPABASE_URL, adminKey(), { auth: { persistSession: false, autoRefreshToken: false } });
const ISSUER = "https://token.actions.githubusercontent.com";
const AUDIENCE = "aifactory-supabase-runtime";
const EXPECTED_REPOSITORY = "thethr0ne7/aifactory";
const EXPECTED_REPOSITORY_ID = "1334997374";
const EXPECTED_REF = "refs/heads/main";
const EXPECTED_WORKFLOW = "thethr0ne7/aifactory/.github/workflows/reviewed-self-improvement-patch.yml@refs/heads/main";
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks`));
const REVIEWABLE_TARGETS = new Set(["ROUTING_HEURISTIC", "SKILL_PATCH", "WORKFLOW_PATCH"]);

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const claims = await authenticate(request);
    const body = await safeJson<RequestBody>(request);
    const candidateId = uuid(body.patch_candidate_id, "patch_candidate_id");

    const { data: candidate, error: candidateError } = await db.from("af_patch_candidates")
      .select("id,lesson_id,incident_id,regression_eval_id,target_type,target_ref,patch,risk_class,status,rollback,provenance,created_at,decided_at")
      .eq("id", candidateId)
      .single();
    if (candidateError || !candidate) return json({ error: "candidate_not_found" }, 404);
    if (candidate.status !== "REVIEW_REQUIRED") return json({ error: "candidate_not_review_required" }, 409);
    if (candidate.risk_class !== "LOW") return json({ error: "candidate_risk_not_low" }, 403);
    if (!REVIEWABLE_TARGETS.has(String(candidate.target_type || ""))) return json({ error: "candidate_target_not_reviewable" }, 403);
    if (!candidate.regression_eval_id) return json({ error: "candidate_missing_regression_eval" }, 409);

    const { data: evaluation, error: evalError } = await db.from("af_regression_evals")
      .select("id,status,baseline_result,candidate_result,score,source_refs,provenance,completed_at")
      .eq("id", candidate.regression_eval_id)
      .single();
    if (evalError || !evaluation) return json({ error: "candidate_evaluation_not_found" }, 409);

    const baseline = object(evaluation.baseline_result);
    const result = object(evaluation.candidate_result);
    const dimensionScores = object(result.dimension_scores);
    const unsupported = Array.isArray(result.unsupported_assumptions) ? result.unsupported_assumptions : [];
    const overall = finite(result.score ?? evaluation.score);
    const baselineScore = finite(baseline.score);
    const dims = ["structural", "routing", "behavioral", "adversarial", "production_regression"].map((key) => finite(dimensionScores[key]));

    const evaluationPassed =
      result.score_scale === "0-100" &&
      result.score_scale_valid === true &&
      result.patch_faithful === true &&
      result.no_protected_boundary_violation === true &&
      result.regression_cases_passed === true &&
      unsupported.length === 0 &&
      overall >= 80 &&
      overall - baselineScore >= 5 &&
      dims.every((score) => score >= 75);
    if (!evaluationPassed) return json({ error: "candidate_evaluation_not_passed" }, 403);

    return json({
      candidate,
      evaluation: {
        id: evaluation.id,
        score: overall,
        baseline_score: baselineScore,
        dimension_scores: dimensionScores,
        patch_faithful: true,
        regression_cases_passed: true,
      },
      review_contract: {
        repository: EXPECTED_REPOSITORY,
        ref: EXPECTED_REF,
        workflow: EXPECTED_WORKFLOW,
        event_name: "workflow_dispatch",
        exact_patch_candidate_id: candidateId,
        direct_main_write: false,
        automatic_merge: false,
      },
      provenance: {
        github_run_id: claims.run_id,
        actor: claims.actor,
        sha: claims.sha,
      },
    });
  } catch (error) {
    const message = sanitize(error);
    const unauthorized = message.startsWith("oidc_") || message.startsWith("invalid_");
    console.error(JSON.stringify({ event: "reviewed_patch_gate_error", error: message }));
    return json({ error: unauthorized ? "unauthorized" : "review_gate_error" }, unauthorized ? 401 : 500);
  }
});

async function authenticate(request: Request): Promise<GitHubClaims> {
  const token = (request.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new Error("oidc_missing_bearer_token");
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: ["RS256"],
    clockTolerance: 10,
  });
  const claims = payload as GitHubClaims;
  if (claims.repository !== EXPECTED_REPOSITORY) throw new Error("oidc_repository_mismatch");
  if (claims.repository_id !== EXPECTED_REPOSITORY_ID) throw new Error("oidc_repository_id_mismatch");
  if (claims.ref !== EXPECTED_REF) throw new Error("oidc_ref_mismatch");
  if (claims.event_name !== "workflow_dispatch") throw new Error("oidc_event_not_manual_dispatch");
  const workflow = String(claims.job_workflow_ref ?? claims.workflow_ref ?? "");
  if (workflow !== EXPECTED_WORKFLOW) throw new Error("oidc_workflow_mismatch");
  return claims;
}

function adminKey() {
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (keys) {
    try {
      const parsed = JSON.parse(keys);
      if (parsed.default) return String(parsed.default);
    } catch { /* legacy fallback */ }
  }
  return mustEnv("SUPABASE_SERVICE_ROLE_KEY");
}
function mustEnv(name: string) { const value = Deno.env.get(name); if (!value) throw new Error(`missing_env_${name}`); return value; }
function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function finite(value: unknown) { const n = Number(value); return Number.isFinite(n) ? n : -Infinity; }
function uuid(value: unknown, name: string) { const text = String(value ?? ""); if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) throw new Error(`invalid_${name}`); return text; }
async function safeJson<T>(request: Request): Promise<T> { try { return await request.json() as T; } catch { return {} as T; } }
function sanitize(error: unknown) { return (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, " ").slice(0, 1200); }
function json(payload: unknown, status = 200) { return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } }); }
