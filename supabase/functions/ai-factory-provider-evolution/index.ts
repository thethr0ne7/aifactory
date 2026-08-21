import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "npm:jose@6";

type Claims = JWTPayload & { repository?: string; repository_id?: string; ref?: string; event_name?: string; workflow_ref?: string; job_workflow_ref?: string; run_id?: string; actor?: string; sha?: string; };
type Body = { action?: string; capability_id?: string; context_key?: string; benchmark_key?: string; benchmark_id?: string; provider_id?: string; record?: Record<string, unknown>; records?: Record<string, unknown>[]; };

const SUPABASE_URL = mustEnv("SUPABASE_URL");
const db = createClient(SUPABASE_URL, adminKey(), { auth: { persistSession: false, autoRefreshToken: false } });
const ISSUER = "https://token.actions.githubusercontent.com";
const AUDIENCE = "aifactory-provider-evolution";
const EXPECTED_REPOSITORY = "thethr0ne7/aifactory";
const EXPECTED_REPOSITORY_ID = "1334997374";
const EXPECTED_REF = "refs/heads/main";
const PROVIDER_WORKFLOW = "thethr0ne7/aifactory/.github/workflows/provider-evolution.yml@refs/heads/main";
const TOOL_WORKFLOW = "thethr0ne7/aifactory/.github/workflows/factory-tool-executor.yml@refs/heads/main";
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks`));
const WRITE_EVENTS = new Set(["push", "schedule", "workflow_dispatch"]);
const PRODUCTION_READY = new Set(["crawl4ai", "native-fetch", "factory-memory", "factory-agent-org", "factory-document-chain", "factory-repo-search", "factory-shield", "supabase-realtime", "github-actions-workspace"]);
const ADMITTED_PROVIDERS = new Map<string, Set<string>>([
  ["WEB_EVIDENCE", new Set(["crawl4ai", "native-fetch", "firecrawl"])],
  ["WEB_OPERATOR", new Set(["browser-use", "stagehand", "firecrawl-interact"])],
  ["MEMORY", new Set(["factory-memory", "supermemory", "mem0"])],
  ["ORCHESTRATION_RUNTIME", new Set(["factory-agent-org", "microsoft-agent-framework", "crewai", "autogen"])],
  ["DOCUMENT_NORMALIZATION", new Set(["factory-document-chain", "markitdown"])],
  ["REPO_SEMANTIC_SEARCH", new Set(["factory-repo-search", "claude-context"])],
  ["SUPPLY_CHAIN_AUDIT", new Set(["factory-shield", "bumblebee"])],
]);
const HARD_GATES = ["correctness", "evidence_fidelity", "safety_compliance"];

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const claims = await authenticate(request);
    const body = await safeJson<Body>(request);
    const action = clean(body.action, 80);
    const workflow = claims.job_workflow_ref ?? claims.workflow_ref ?? "";
    const writer = workflow === PROVIDER_WORKFLOW && WRITE_EVENTS.has(String(claims.event_name || ""));
    const reader = writer || workflow === TOOL_WORKFLOW;
    const provenance = { provider: "github-actions-oidc", repository: claims.repository, ref: claims.ref, workflow_ref: workflow, github_run_id: claims.run_id, github_sha: claims.sha, actor: claims.actor, authenticated_at: new Date().toISOString() };

    if (action === "route") {
      if (!reader) return json({ error: "workflow_not_allowed" }, 403);
      const capability = capabilityId(body.capability_id);
      const context = ident(body.context_key || "general", "context_key");
      const exact = await activeChampion(capability, context);
      const general = exact || (context !== "general" ? await activeChampion(capability, "general") : null);
      if (general && !isAdmitted(capability, general.provider_id)) return json({ error: "stored_champion_capability_mismatch" }, 409);
      return json({ champion: general, exact_context: Boolean(exact), requested_context: context });
    }

    if (!writer) return json({ error: "write_workflow_required" }, 403);

    if (action === "start_benchmark") {
      const capability = capabilityId(body.capability_id);
      const context = ident(body.context_key || "general", "context_key");
      const key = clean(body.benchmark_key, 180);
      if (!key) return json({ error: "benchmark_key_required" }, 400);
      const row = { capability_id: capability, context_key: context, benchmark_key: key, status: "RUNNING", spec: object(body.record), provenance };
      const { data, error } = await db.from("af_provider_benchmarks").upsert(row, { onConflict: "capability_id,context_key,benchmark_key" }).select("*").single();
      if (error) throw error;
      return json({ benchmark: data });
    }

    if (action === "record_trials") {
      const benchmarkId = uuid(body.benchmark_id, "benchmark_id");
      const benchmark = await getBenchmark(benchmarkId);
      if (benchmark.status !== "RUNNING") return json({ error: "benchmark_not_running" }, 409);
      const records = Array.isArray(body.records) ? body.records.slice(0, 100) : [];
      if (!records.length) return json({ error: "records_required" }, 400);
      const rows = records.map((input) => {
        const r = object(input);
        const capability = capabilityId(r.capability_id);
        const context = ident(r.context_key || "general", "context_key");
        const provider = ident(r.provider_id, "provider_id");
        if (capability !== benchmark.capability_id || context !== benchmark.context_key) throw new Error("trial_benchmark_scope_mismatch");
        if (!isAdmitted(capability, provider)) throw new Error("provider_capability_mismatch");
        return {
          benchmark_id: benchmarkId,
          capability_id: capability,
          context_key: context,
          provider_id: provider,
          case_key: ident(r.case_key, "case_key"),
          attempt: boundedInt(r.attempt, 1, 1, 20),
          outcome: outcome(r.outcome),
          scores: scores(r.scores),
          raw_metrics: object(r.raw_metrics),
          evidence: object(r.evidence),
          provenance: { ...object(r.provenance), broker: provenance }
        };
      });
      const { data, error } = await db.from("af_provider_trials").upsert(rows, { onConflict: "benchmark_id,provider_id,case_key,attempt" }).select("id,provider_id,case_key,outcome,scores");
      if (error) throw error;
      return json({ trials: data ?? [] });
    }

    if (action === "set_champion") {
      const benchmarkId = uuid(body.benchmark_id, "benchmark_id");
      const benchmark = await getBenchmark(benchmarkId);
      if (benchmark.status !== "RUNNING") return json({ error: "benchmark_not_running" }, 409);
      const capability = capabilityId(body.capability_id);
      const context = ident(body.context_key || "general", "context_key");
      const provider = ident(body.provider_id, "provider_id");
      if (capability !== benchmark.capability_id || context !== benchmark.context_key) return json({ error: "champion_benchmark_scope_mismatch" }, 409);
      if (!isAdmitted(capability, provider)) return json({ error: "provider_capability_mismatch" }, 409);
      if (!PRODUCTION_READY.has(provider)) return json({ error: "provider_not_production_ready" }, 409);
      const { data: allTrials, error: allTrialError } = await db.from("af_provider_trials").select("provider_id,outcome,scores").eq("benchmark_id", benchmarkId).eq("capability_id", capability).eq("context_key", context);
      if (allTrialError) throw allTrialError;
      const allRows = allTrials ?? [];
      const distinctProviders = new Set(allRows.map((x) => x.provider_id));
      if (distinctProviders.size < 2) return json({ error: "competition_required", provider_count: distinctProviders.size }, 409);
      const rows = allRows.filter((x) => x.provider_id === provider);
      if (rows.length < 3) return json({ error: "insufficient_trials", trial_count: rows.length }, 409);
      const passRate = rows.filter((x) => x.outcome === "PASS").length / rows.length;
      if (passRate < 0.8) return json({ error: "pass_rate_gate", pass_rate: passRate }, 409);
      const aggregate: Record<string, number> = {};
      for (const key of HARD_GATES) aggregate[key] = average(rows.map((x) => number(object(x.scores)[key])));
      if (HARD_GATES.some((key) => aggregate[key] < 80)) return json({ error: "hard_gate_failed", aggregate }, 409);
      const snapshot = object(body.record);
      if (snapshot.authority_expanded === true) return json({ error: "authority_expansion_forbidden" }, 409);
      const { data, error } = await db.rpc("af_set_provider_champion", { p_capability_id: capability, p_context_key: context, p_provider_id: provider, p_fitness_snapshot: snapshot, p_benchmark_id: benchmarkId, p_production_ready: true, p_provenance: provenance });
      if (error) throw error;
      return json({ champion_id: data, provider_id: provider, authority_expanded: false });
    }

    if (action === "complete_benchmark") {
      const benchmarkId = uuid(body.benchmark_id, "benchmark_id");
      const status = String(object(body.record).status || "COMPLETE").toUpperCase();
      if (!new Set(["COMPLETE", "FAILED"]).has(status)) return json({ error: "invalid_status" }, 400);
      const { data, error } = await db.from("af_provider_benchmarks").update({ status, completed_at: new Date().toISOString(), provenance }).eq("id", benchmarkId).select("*").single();
      if (error) throw error;
      return json({ benchmark: data });
    }

    if (action === "snapshot") {
      const benchmarkId = uuid(body.benchmark_id, "benchmark_id");
      const [{ data: benchmark, error: e1 }, { data: trials, error: e2 }] = await Promise.all([
        db.from("af_provider_benchmarks").select("*").eq("id", benchmarkId).single(),
        db.from("af_provider_trials").select("*").eq("benchmark_id", benchmarkId).order("created_at", { ascending: true })
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      const { data: champions, error: e3 } = await db.from("af_provider_champions").select("*").eq("capability_id", benchmark.capability_id).eq("context_key", benchmark.context_key).order("activated_at", { ascending: false });
      if (e3) throw e3;
      return json({ benchmark, trials: trials ?? [], champions: champions ?? [] });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (error) {
    console.error(error);
    return json({ error: safeError(error) }, 500);
  }
});

async function activeChampion(capability: string, context: string) {
  const { data, error } = await db.from("af_provider_champions").select("provider_id,fitness_snapshot,benchmark_id,production_ready,activated_at,authority_expanded").eq("capability_id", capability).eq("context_key", context).eq("state", "ACTIVE_CHAMPION").maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function getBenchmark(id: string) {
  const { data, error } = await db.from("af_provider_benchmarks").select("id,capability_id,context_key,status").eq("id", id).single();
  if (error) throw error;
  return data;
}

function capabilityId(value: unknown) {
  const v = ident(value, "capability_id");
  if (!ADMITTED_PROVIDERS.has(v)) throw new Error("unknown_capability");
  return v;
}
function isAdmitted(capability: string, provider: string) { return ADMITTED_PROVIDERS.get(capability)?.has(provider) === true; }

async function authenticate(request: Request) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) throw new Error("missing_bearer");
  const { payload } = await jwtVerify(token, JWKS, { issuer: ISSUER, audience: AUDIENCE });
  const claims = payload as Claims;
  if (claims.repository !== EXPECTED_REPOSITORY || claims.repository_id !== EXPECTED_REPOSITORY_ID) throw new Error("repository_mismatch");
  if (claims.ref !== EXPECTED_REF) throw new Error("main_ref_required");
  const workflow = claims.job_workflow_ref ?? claims.workflow_ref ?? "";
  if (workflow !== PROVIDER_WORKFLOW && workflow !== TOOL_WORKFLOW) throw new Error("workflow_mismatch");
  return claims;
}

function adminKey() { return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || mustEnv("SB_SERVICE_ROLE_KEY"); }
function mustEnv(name: string) { const value = Deno.env.get(name); if (!value) throw new Error(`missing_env_${name}`); return value; }
async function safeJson<T>(request: Request): Promise<T> { try { return await request.json(); } catch { return {} as T; } }
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } }); }
function object(value: unknown): Record<string, any> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}; }
function clean(value: unknown, max = 240) { return String(value ?? "").replace(/[\u0000\r\n]+/g, " ").trim().slice(0, max); }
function ident(value: unknown, name: string) { const v = clean(value, 160); if (!/^[A-Za-z0-9_.:-]+$/.test(v)) throw new Error(`invalid_${name}`); return v; }
function uuid(value: unknown, name: string) { const v = clean(value, 80); if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)) throw new Error(`invalid_${name}`); return v; }
function outcome(value: unknown) { const v = String(value || "").toUpperCase(); if (!new Set(["PASS", "FAIL", "BLOCKED"]).has(v)) throw new Error("invalid_outcome"); return v; }
function boundedInt(value: unknown, fallback: number, min: number, max: number) { const n = Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : fallback; }
function number(value: unknown) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
function average(values: number[]) { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0; }
function scores(value: unknown) { const v = object(value); const out: Record<string, number> = {}; for (const [key, raw] of Object.entries(v)) { const n = Number(raw); if (Number.isFinite(n)) out[key] = Math.max(0, Math.min(100, n)); } return out; }
function safeError(error: unknown) { return (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, " ").slice(0, 1200); }
