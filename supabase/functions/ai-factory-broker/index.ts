import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "npm:jose@6";

type Action = "enqueue" | "claim" | "heartbeat" | "learning_context" | "event" | "checkpoint" | "incident" | "lesson" | "finish" | "recover";
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
const EXPECTED_WORKFLOW = "thethr0ne7/aifactory/.github/workflows/factory-autonomous-worker.yml@refs/heads/main";
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks`));
const EVIDENCE_CLASSES = new Set(["MEASURED","OBSERVED","CONFIRMED","DERIVED","INFERRED","ASSUMPTION","UNKNOWN","BLOCKER"]);
const SEVERITIES = new Set(["UNDESIRABLE","FORBIDDEN","CATASTROPHIC"]);
const TERMINAL = new Set(["COMPLETE","BLOCKED","FAILED"]);

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const claims = await authenticate(request);
    const body = await safeJson<Body>(request);
    const action = body.action;
    if (!action) return json({ error: "action_required" }, 400);
    const provenance = runnerMetadata(claims, body.metadata);

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
        memory_policy: {
          candidate_non_binding: true,
          superseded_inactive: true,
          current_evidence_wins: true,
          root_of_trust_override: false,
        },
      });
    }

    if (action === "event") {
      const runId = uuid(body.run_id, "run_id");
      const taskId = optionalUuid(body.task_id, "task_id");
      const evidenceClass = clean(body.evidence_class || "OBSERVED", 32);
      if (!EVIDENCE_CLASSES.has(evidenceClass)) return json({ error: "invalid_evidence_class" }, 400);
      const { error } = await db.from("af_events").insert({
        run_id: runId,
        task_id: taskId,
        event_type: clean(body.event_type || "WORKER_EVENT", 120),
        source: "github-actions-worker",
        evidence_class: evidenceClass,
        payload: body.payload ?? {},
        provenance,
      });
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "checkpoint") {
      const { error } = await db.from("af_checkpoints").insert({
        run_id: uuid(body.run_id, "run_id"),
        task_id: optionalUuid(body.task_id, "task_id"),
        state: clean(body.state || "WORKING", 64),
        snapshot: body.snapshot ?? {},
      });
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "incident") {
      const severity = clean(body.severity || "UNDESIRABLE", 32);
      if (!SEVERITIES.has(severity)) return json({ error: "invalid_severity" }, 400);
      const record = {
        run_id: uuid(body.run_id, "run_id"),
        task_id: optionalUuid(body.task_id, "task_id"),
        severity,
        summary: clean(body.summary || "unspecified incident", 4000),
        evidence: body.evidence ?? {},
        root_cause: body.root_cause ?? null,
        affected_invariants: stringArray(body.affected_invariants, 20, 160),
        repair: body.repair ?? null,
        negative_action_id: nullableClean(body.negative_action_id, 160),
        regression_eval_ref: nullableClean(body.regression_eval_ref, 500),
      };
      const { data, error } = await db.from("af_incidents").insert(record).select("id").single();
      if (error) throw error;
      await db.from("af_events").insert({ run_id: record.run_id, task_id: record.task_id, event_type: "INCIDENT_OPENED", source: "github-actions-worker", evidence_class: severity === "CATASTROPHIC" ? "BLOCKER" : "OBSERVED", payload: { incident_id: data.id, severity, summary: record.summary }, provenance });
      return json({ incident_id: data.id });
    }

    if (action === "lesson") {
      const record = {
        run_id: uuid(body.run_id, "run_id"),
        lesson_class: clean(body.lesson_class || "PATTERN", 120),
        statement: clean(body.statement || "", 6000),
        generalization: body.generalization ?? {},
        regression_eval_ref: nullableClean(body.regression_eval_ref, 500),
        candidate_change: body.candidate_change ?? null,
        provenance,
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
        p_task_id: uuid(body.task_id, "task_id"),
        p_status: status,
        p_result: body.result ?? {},
        p_activated_agents: stringArray(body.activated_agents, 3, 32),
        p_selected_skills: stringArray(body.selected_skills, 8, 120),
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
  if (workflow !== EXPECTED_WORKFLOW) throw new Error("oidc_workflow_mismatch");
  return claims;
}

function runnerMetadata(claims: GitHubClaims, supplied?: Record<string, unknown>) {
  return { provider: "github-actions-oidc", repository: claims.repository, repository_id: claims.repository_id, ref: claims.ref, sha: claims.sha, event_name: claims.event_name, workflow_ref: claims.job_workflow_ref ?? claims.workflow_ref, run_id: claims.run_id, run_number: claims.run_number, run_attempt: claims.run_attempt, actor: claims.actor, actor_id: claims.actor_id, supplied: supplied ?? {}, authenticated_at: new Date().toISOString() };
}

function adminKey() {
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (keys) {
    try { const parsed = JSON.parse(keys); if (parsed.default) return String(parsed.default); } catch { /* legacy fallback */ }
  }
  return mustEnv("SUPABASE_SERVICE_ROLE_KEY");
}
function mustEnv(name: string) { const value = Deno.env.get(name); if (!value) throw new Error(`missing_env_${name}`); return value; }
function clean(value: unknown, max: number) { return String(value ?? "").replace(/[\u0000\r]+/g, " ").trim().slice(0, max); }
function nullableClean(value: unknown, max: number) { const v = clean(value, max); return v || null; }
function stringArray(value: unknown, maxItems: number, maxLen: number) { return Array.isArray(value) ? [...new Set(value.map((v) => clean(v, maxLen)).filter(Boolean))].slice(0, maxItems) : []; }
function uuid(value: unknown, name: string) { const text = String(value ?? ""); if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) throw new Error(`invalid_${name}`); return text; }
function optionalUuid(value: unknown, name: string) { return value ? uuid(value, name) : null; }
async function safeJson<T>(request: Request): Promise<T> { try { return await request.json() as T; } catch { return {} as T; } }
function sanitizeError(error: unknown) { return (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, " ").slice(0, 1200); }
function json(payload: unknown, status = 200) { return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } }); }
