import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "npm:jose@6";

type Action =
  | "enqueue" | "claim" | "heartbeat" | "learning_context" | "event" | "checkpoint" | "incident" | "lesson" | "finish" | "recover"
  | "seed_regression_evals" | "improvement_claim" | "improvement_record" | "improvement_promote"
  | "promotion_context" | "promotion_observe" | "promotion_retain" | "promotion_rollback";

type Body = {
  action?: Action;
  objective?: string;
  payload?: Record<string, unknown>;
  kind?: string;
  autonomy_level?: string;
  worker_id?: string;
  run_id?: string;
  task_id?: string;
  event_type?: string;
  evidence_class?: string;
  state?: string;
  snapshot?: Record<string, unknown>;
  severity?: string;
  summary?: string;
  evidence?: Record<string, unknown>;
  root_cause?: Record<string, unknown>;
  affected_invariants?: string[];
  repair?: Record<string, unknown>;
  negative_action_id?: string;
  regression_eval_ref?: string;
  lesson_class?: string;
  statement?: string;
  generalization?: Record<string, unknown>;
  candidate_change?: Record<string, unknown>;
  status?: string;
  result?: Record<string, unknown>;
  activated_agents?: string[];
  selected_skills?: string[];
  stale_minutes?: number;
  limit?: number;
  metadata?: Record<string, unknown>;
  lesson_id?: string;
  incident_id?: string;
  regression_eval_id?: string;
  patch_candidate_id?: string;
  promotion_id?: string;
  target_type?: string;
  target_ref?: string;
  patch?: Record<string, unknown>;
  rollback?: Record<string, unknown>;
  rollback_ref?: string;
  risk_class?: string;
  decision?: Record<string, unknown>;
  evaluation?: Record<string, unknown>;
  outcome?: string;
  regression_detected?: boolean;
  reason?: string;
};

type GitHubClaims = JWTPayload & {
  repository?: string;
  repository_id?: string;
  ref?: string;
  event_name?: string;
  workflow_ref?: string;
  job_workflow_ref?: string;
  run_id?: string;
  run_number?: string;
  run_attempt?: string;
  actor?: string;
  actor_id?: string;
  sha?: string;
};

const SUPABASE_URL = mustEnv("SUPABASE_URL");
const db = createClient(SUPABASE_URL, adminKey(), { auth: { persistSession: false, autoRefreshToken: false } });

const ISSUER = "https://token.actions.githubusercontent.com";
const AUDIENCE = "aifactory-supabase-runtime";
const EXPECTED_REPOSITORY = "thethr0ne7/aifactory";
const EXPECTED_REPOSITORY_ID = "1334997374";
const EXPECTED_REF = "refs/heads/main";
const AUTONOMOUS_WORKFLOW = "thethr0ne7/aifactory/.github/workflows/factory-autonomous-worker.yml@refs/heads/main";
const SELF_IMPROVEMENT_WORKFLOW = "thethr0ne7/aifactory/.github/workflows/factory-self-improvement.yml@refs/heads/main";
const ALLOWED_WORKFLOWS = new Set([AUTONOMOUS_WORKFLOW, SELF_IMPROVEMENT_WORKFLOW]);
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks`));
const EVIDENCE_CLASSES = new Set(["MEASURED","OBSERVED","CONFIRMED","DERIVED","INFERRED","ASSUMPTION","UNKNOWN","BLOCKER"]);
const SEVERITIES = new Set(["UNDESIRABLE","FORBIDDEN","CATASTROPHIC"]);
const TERMINAL = new Set(["COMPLETE","BLOCKED","FAILED"]);
const SELF_ACTIONS = new Set<Action>([
  "seed_regression_evals","improvement_claim","improvement_record","improvement_promote",
  "promotion_context","promotion_observe","promotion_retain","promotion_rollback",
]);

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const claims = await authenticate(request);
    const body = await safeJson<Body>(request);
    const action = body.action;
    if (!action) return json({ error: "action_required" }, 400);
    const provenance = runnerMetadata(claims, body.metadata);
    const kind = workflowKind(claims);

    if (SELF_ACTIONS.has(action)) requireWorkflowKind(kind, "self-improvement");
    else if (action !== "learning_context") requireWorkflowKind(kind, "autonomous");

    if (action === "enqueue") {
      const objective = clean(body.objective, 12000);
      if (objective.length < 3) return json({ error: "objective_required" }, 400);
      const { data, error } = await db.rpc("af_enqueue_run", {
        p_objective: objective,
        p_payload: body.payload ?? {},
        p_kind: clean(body.kind || "general", 120),
        p_autonomy_level: clean(body.autonomy_level || "A3", 2),
      });
      if (error) throw error;
      return json({ run_id: data });
    }

    if (action === "claim") {
      const workerId = clean(body.worker_id || `gha:${claims.run_id ?? "unknown"}`, 200);
      const { data, error } = await db.rpc("af_claim_task", { p_worker_id: workerId });
      if (error) throw error;
      const task = Array.isArray(data) ? data[0] ?? null : data ?? null;
      if (!task) return json({ task: null });
      const { data: run, error: runError } = await db.from("af_runs").select("*").eq("id", task.run_id).single();
      if (runError) throw runError;
      return json({ task, run });
    }

    if (action === "heartbeat") {
      const runId = uuid(body.run_id, "run_id");
      const { error } = await db.rpc("af_touch_run", { p_run_id: runId });
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "learning_context") {
      const limit = Math.max(1, Math.min(Number(body.limit) || 20, 30));
      const [lessonResult, incidentResult] = await Promise.all([
        db.from("af_lessons")
          .select("id,run_id,incident_id,lesson_class,status,statement,generalization,regression_eval_ref,candidate_change,created_at,decided_at")
          .in("status", ["CANDIDATE", "PROMOTED", "SUPERSEDED"])
          .order("created_at", { ascending: false })
          .limit(Math.min(limit * 2, 40)),
        db.from("af_incidents")
          .select("id,run_id,task_id,severity,status,summary,root_cause,affected_invariants,negative_action_id,regression_eval_ref,created_at,resolved_at")
          .order("created_at", { ascending: false })
          .limit(Math.min(limit, 30)),
      ]);
      if (lessonResult.error) throw lessonResult.error;
      if (incidentResult.error) throw incidentResult.error;
      return json({
        lessons: lessonResult.data ?? [],
        incidents: incidentResult.data ?? [],
        memory_policy: { candidate_non_binding: true, superseded_inactive: true, current_evidence_wins: true, root_of_trust_override: false },
      });
    }

    if (action === "event") {
      const runId = uuid(body.run_id, "run_id");
      const taskId = optionalUuid(body.task_id, "task_id");
      const evidenceClass = clean(body.evidence_class || "OBSERVED", 32);
      if (!EVIDENCE_CLASSES.has(evidenceClass)) return json({ error: "invalid_evidence_class" }, 400);
      const { error } = await db.from("af_events").insert({
        run_id: runId, task_id: taskId, event_type: clean(body.event_type || "WORKER_EVENT", 120),
        source: "github-actions-worker", evidence_class: evidenceClass, payload: body.payload ?? {}, provenance,
      });
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "checkpoint") {
      const { error } = await db.from("af_checkpoints").insert({
        run_id: uuid(body.run_id, "run_id"), task_id: optionalUuid(body.task_id, "task_id"),
        state: clean(body.state || "WORKING", 64), snapshot: body.snapshot ?? {},
      });
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "incident") {
      const severity = clean(body.severity || "UNDESIRABLE", 32);
      if (!SEVERITIES.has(severity)) return json({ error: "invalid_severity" }, 400);
      const record = {
        run_id: uuid(body.run_id, "run_id"), task_id: optionalUuid(body.task_id, "task_id"), severity,
        summary: clean(body.summary || "unspecified incident", 4000), evidence: body.evidence ?? {}, root_cause: body.root_cause ?? null,
        affected_invariants: stringArray(body.affected_invariants, 20, 160), repair: body.repair ?? null,
        negative_action_id: nullableClean(body.negative_action_id, 160), regression_eval_ref: nullableClean(body.regression_eval_ref, 500),
      };
      const { data, error } = await db.from("af_incidents").insert(record).select("id").single();
      if (error) throw error;
      await db.from("af_events").insert({ run_id: record.run_id, task_id: record.task_id, event_type: "INCIDENT_OPENED", source: "github-actions-worker", evidence_class: severity === "CATASTROPHIC" ? "BLOCKER" : "OBSERVED", payload: { incident_id: data.id, severity, summary: record.summary }, provenance });
      return json({ incident_id: data.id });
    }

    if (action === "lesson") {
      const record = {
        run_id: uuid(body.run_id, "run_id"), lesson_class: clean(body.lesson_class || "PATTERN", 120), statement: clean(body.statement || "", 6000),
        generalization: body.generalization ?? {}, regression_eval_ref: nullableClean(body.regression_eval_ref, 500),
        candidate_change: body.candidate_change ?? null, provenance,
      };
      if (record.statement.length < 5) return json({ error: "lesson_statement_required" }, 400);
      const { data, error } = await db.from("af_lessons").insert(record).select("id").single();
      if (error) throw error;
      await db.from("af_events").insert({ run_id: record.run_id, event_type: "LESSON_CANDIDATE_CREATED", source: "github-actions-worker", evidence_class: "DERIVED", payload: { lesson_id: data.id, lesson_class: record.lesson_class }, provenance });
      return json({ lesson_id: data.id });
    }

    if (action === "finish") {
      const status = clean(body.status || "FAILED", 16);
      if (!TERMINAL.has(status)) return json({ error: "invalid_terminal_status" }, 400);
      const { data, error } = await db.rpc("af_finish_task", {
        p_task_id: uuid(body.task_id, "task_id"), p_status: status, p_result: body.result ?? {},
        p_activated_agents: stringArray(body.activated_agents, 3, 32), p_selected_skills: stringArray(body.selected_skills, 8, 120),
      });
      if (error) throw error;
      return json({ run_id: data, status });
    }

    if (action === "recover") {
      const minutes = Math.max(5, Math.min(Number(body.stale_minutes) || 20, 1440));
      const { data, error } = await db.rpc("af_recover_stale", { p_stale_minutes: minutes });
      if (error) throw error;
      return json({ recovery: data });
    }

    if (action === "seed_regression_evals") {
      const limit = Math.max(1, Math.min(Number(body.limit) || 20, 100));
      const { data, error } = await db.rpc("af_seed_regression_eval_candidates", { p_limit: limit });
      if (error) throw error;
      return json({ seeded: Number(data || 0) });
    }

    if (action === "improvement_claim") {
      const workerId = clean(body.worker_id || `a4:${claims.run_id ?? "unknown"}`, 200);
      const { data, error } = await db.rpc("af_claim_improvement_candidate", { p_worker_id: workerId });
      if (error) throw error;
      const candidate = Array.isArray(data) ? data[0] ?? null : data ?? null;
      return json({ candidate });
    }

    if (action === "improvement_record") {
      const lessonId = uuid(body.lesson_id, "lesson_id");
      const evalId = optionalUuid(body.regression_eval_id, "regression_eval_id");
      const decisionAction = clean(body.status || "REVIEW_REQUIRED", 32);
      const risk = clean(body.risk_class || "MEDIUM", 32);
      const targetType = clean(body.target_type || "MEMORY_GUIDANCE", 32);
      if (!new Set(["LOW","MEDIUM","HIGH","ROOT_OR_CATASTROPHIC"]).has(risk)) return json({ error: "invalid_risk_class" }, 400);
      if (!new Set(["MEMORY_GUIDANCE","ROUTING_HEURISTIC","SKILL_PATCH","WORKFLOW_PATCH"]).has(targetType)) return json({ error: "invalid_target_type" }, 400);

      let evalStatus = "CANDIDATE";
      let patchStatus = "REVIEW_REQUIRED";
      let lessonStatus = "EVALUATING";
      if (decisionAction === "PROMOTE") { evalStatus = "PASS"; patchStatus = "READY"; }
      else if (decisionAction === "REJECT") { evalStatus = "FAIL"; patchStatus = "REJECTED"; lessonStatus = "REJECTED"; }

      if (evalId) {
        const evaluation = body.evaluation ?? {};
        const { error: evalError } = await db.from("af_regression_evals").update({
          lesson_id: lessonId, status: evalStatus,
          baseline_result: objectOrEmpty(evaluation.baseline_result), candidate_result: objectOrEmpty(evaluation.candidate_result),
          score: finiteNumber(evaluation.score), provenance, completed_at: evalStatus === "CANDIDATE" ? null : new Date().toISOString(),
        }).eq("id", evalId);
        if (evalError) throw evalError;
      }

      const patchRecord = {
        lesson_id: lessonId, incident_id: optionalUuid(body.incident_id, "incident_id"), regression_eval_id: evalId,
        target_type: targetType, target_ref: nullableClean(body.target_ref, 500), patch: body.patch ?? {}, risk_class: risk,
        status: patchStatus, rollback: body.rollback ?? {}, provenance, decided_at: patchStatus === "READY" ? null : new Date().toISOString(),
      };
      const { data: patchData, error: patchError } = await db.from("af_patch_candidates").upsert(patchRecord, { onConflict: "lesson_id" }).select("id,status").single();
      if (patchError) throw patchError;
      const { error: lessonError } = await db.from("af_lessons").update({ status: lessonStatus, decided_at: lessonStatus === "REJECTED" ? new Date().toISOString() : null }).eq("id", lessonId);
      if (lessonError) throw lessonError;
      return json({ patch_candidate_id: patchData.id, patch_status: patchData.status, eval_status: evalStatus, lesson_status: lessonStatus });
    }

    if (action === "improvement_promote") {
      const { data, error } = await db.rpc("af_promote_low_risk_memory", {
        p_lesson_id: uuid(body.lesson_id, "lesson_id"),
        p_patch_candidate_id: uuid(body.patch_candidate_id, "patch_candidate_id"),
        p_regression_eval_id: uuid(body.regression_eval_id, "regression_eval_id"),
        p_evidence: body.evidence ?? {}, p_decision: body.decision ?? {},
        p_rollback_ref: clean(body.rollback_ref, 500),
      });
      if (error) throw error;
      return json({ promotion_id: data, status: "ACTIVE" });
    }

    if (action === "promotion_context") {
      const limit = Math.max(1, Math.min(Number(body.limit) || 20, 30));
      const { data: promotions, error: pError } = await db.from("af_promotions")
        .select("id,lesson_id,patch_candidate_id,regression_eval_id,status,rollback_ref,promoted_at,evidence,decision")
        .eq("status", "ACTIVE").order("promoted_at", { ascending: true }).limit(limit);
      if (pError) throw pError;
      const out = [];
      for (const promotion of promotions ?? []) {
        const { data: events, error: eError } = await db.from("af_events")
          .select("run_id,event_type,payload,occurred_at")
          .eq("event_type", "LEARNING_CONTEXT_APPLIED")
          .gte("occurred_at", promotion.promoted_at)
          .contains("payload", { memory_refs: [promotion.lesson_id] })
          .order("occurred_at", { ascending: true }).limit(20);
        if (eError) throw eError;
        const runIds = [...new Set((events ?? []).map((e) => e.run_id).filter(Boolean))];
        let runs: unknown[] = [];
        if (runIds.length) {
          const { data: rData, error: rError } = await db.from("af_runs").select("id,status,output,completed_at").in("id", runIds);
          if (rError) throw rError;
          runs = rData ?? [];
        }
        const { data: observations, error: oError } = await db.from("af_promotion_observations")
          .select("id,run_id,outcome,regression_detected,evidence,created_at")
          .eq("promotion_id", promotion.id).order("created_at", { ascending: true });
        if (oError) throw oError;
        out.push({ ...promotion, applied_events: events ?? [], runs, observations: observations ?? [] });
      }
      return json({ promotions: out });
    }

    if (action === "promotion_observe") {
      const outcome = clean(body.outcome || "INCONCLUSIVE", 32);
      if (!new Set(["PASS","REGRESSION","INCONCLUSIVE"]).has(outcome)) return json({ error: "invalid_observation_outcome" }, 400);
      const record = {
        promotion_id: uuid(body.promotion_id, "promotion_id"), run_id: optionalUuid(body.run_id, "run_id"), outcome,
        regression_detected: body.regression_detected === true, evidence: body.evidence ?? {},
      };
      const { data, error } = await db.from("af_promotion_observations").upsert(record, { onConflict: "promotion_id,run_id" }).select("id").single();
      if (error) throw error;
      return json({ observation_id: data.id });
    }

    if (action === "promotion_retain") {
      const { data, error } = await db.rpc("af_retain_promotion", {
        p_promotion_id: uuid(body.promotion_id, "promotion_id"), p_evidence: body.evidence ?? {},
      });
      if (error) throw error;
      return json({ lesson_id: data, status: "RETAINED" });
    }

    if (action === "promotion_rollback") {
      const { data, error } = await db.rpc("af_rollback_promotion", {
        p_promotion_id: uuid(body.promotion_id, "promotion_id"), p_evidence: body.evidence ?? {}, p_reason: clean(body.reason || "regression detected", 2000),
      });
      if (error) throw error;
      return json({ lesson_id: data, status: "ROLLED_BACK" });
    }

    return json({ error: "unsupported_action" }, 400);
  } catch (error) {
    const message = sanitizeError(error);
    const unauthorized = message.startsWith("oidc_");
    console.error(JSON.stringify({ event: "ai_factory_broker_error", error: message }));
    return json({ error: unauthorized ? "unauthorized" : "broker_error" }, unauthorized ? 401 : 500);
  }
});

async function authenticate(request: Request): Promise<GitHubClaims> {
  const token = (request.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new Error("oidc_missing_bearer_token");
  const { payload } = await jwtVerify(token, JWKS, { issuer: ISSUER, audience: AUDIENCE, algorithms: ["RS256"], clockTolerance: 10 });
  const claims = payload as GitHubClaims;
  if (claims.repository !== EXPECTED_REPOSITORY) throw new Error("oidc_repository_mismatch");
  if (claims.repository_id !== EXPECTED_REPOSITORY_ID) throw new Error("oidc_repository_id_mismatch");
  if (claims.ref !== EXPECTED_REF) throw new Error("oidc_ref_mismatch");
  if (!new Set(["schedule","workflow_dispatch","push"]).has(String(claims.event_name || ""))) throw new Error("oidc_event_not_allowed");
  const workflow = String(claims.job_workflow_ref ?? claims.workflow_ref ?? "");
  if (!ALLOWED_WORKFLOWS.has(workflow)) throw new Error("oidc_workflow_mismatch");
  return claims;
}

function workflowKind(claims: GitHubClaims) {
  const workflow = String(claims.job_workflow_ref ?? claims.workflow_ref ?? "");
  return workflow === SELF_IMPROVEMENT_WORKFLOW ? "self-improvement" : "autonomous";
}
function requireWorkflowKind(actual: string, expected: string) { if (actual !== expected) throw new Error("oidc_workflow_action_mismatch"); }
function runnerMetadata(claims: GitHubClaims, supplied?: Record<string, unknown>) {
  return { provider: "github-actions-oidc", repository: claims.repository, repository_id: claims.repository_id, ref: claims.ref, sha: claims.sha, event_name: claims.event_name, workflow_ref: claims.job_workflow_ref ?? claims.workflow_ref, run_id: claims.run_id, run_number: claims.run_number, run_attempt: claims.run_attempt, actor: claims.actor, actor_id: claims.actor_id, supplied: supplied ?? {}, authenticated_at: new Date().toISOString() };
}
function adminKey() {
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (keys) { try { const parsed = JSON.parse(keys); if (parsed.default) return String(parsed.default); } catch { /* legacy fallback */ } }
  return mustEnv("SUPABASE_SERVICE_ROLE_KEY");
}
function mustEnv(name: string) { const value = Deno.env.get(name); if (!value) throw new Error(`missing_env_${name}`); return value; }
function clean(value: unknown, max: number) { return String(value ?? "").replace(/[\u0000\r]+/g, " ").trim().slice(0, max); }
function nullableClean(value: unknown, max: number) { const v = clean(value, max); return v || null; }
function stringArray(value: unknown, maxItems: number, maxLen: number) { return Array.isArray(value) ? [...new Set(value.map((v) => clean(v, maxLen)).filter(Boolean))].slice(0, maxItems) : []; }
function uuid(value: unknown, name: string) { const text = String(value ?? ""); if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) throw new Error(`invalid_${name}`); return text; }
function optionalUuid(value: unknown, name: string) { return value ? uuid(value, name) : null; }
function objectOrEmpty(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function finiteNumber(value: unknown) { const n = Number(value); return Number.isFinite(n) ? n : null; }
async function safeJson<T>(request: Request): Promise<T> { try { return await request.json() as T; } catch { return {} as T; } }
function sanitizeError(error: unknown) { return (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, " ").slice(0, 1200); }
function json(payload: unknown, status = 200) { return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } }); }
