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
  run_attempt?: string;
  actor?: string;
};

const SUPABASE_URL = mustEnv("SUPABASE_URL");
const db = createClient(SUPABASE_URL, adminKey(), { auth: { persistSession: false, autoRefreshToken: false } });
const ISSUER = "https://token.actions.githubusercontent.com";
const AUDIENCE = "aifactory-supabase-runtime";
const EXPECTED_REPOSITORY = "thethr0ne7/aifactory";
const EXPECTED_REPOSITORY_ID = "1334997374";
const EXPECTED_REF = "refs/heads/main";
const AUTONOMOUS_WORKFLOW = "thethr0ne7/aifactory/.github/workflows/factory-autonomous-worker.yml@refs/heads/main";
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks`));

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const claims = await authenticate(request);
    const body = await safeJson(request);
    const limit = Math.max(1, Math.min(Number(body?.limit) || 50, 100));

    const { data, error } = await db.from("af_incidents")
      .select("id,run_id,task_id,severity,status,summary,root_cause,affected_invariants,negative_action_id,regression_eval_ref,fingerprint,occurrence_count,last_seen_at,created_at,resolved_at")
      .in("severity", ["FORBIDDEN", "CATASTROPHIC"])
      .in("status", ["OPEN", "REPAIRING", "BLOCKED"])
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;

    return json({
      critical_incidents: data ?? [],
      policy: {
        mandatory: true,
        relevance_filtering_allowed: false,
        current_evidence_wins: true,
        root_of_trust_override: false,
      },
      provenance: {
        source: "public.af_incidents",
        repository: claims.repository,
        run_id: claims.run_id,
        run_attempt: claims.run_attempt,
        actor: claims.actor,
        fetched_at: new Date().toISOString(),
      },
    });
  } catch (error) {
    const message = sanitizeError(error);
    const unauthorized = message.startsWith("oidc_");
    console.error(JSON.stringify({ event: "critical_memory_error", error: message }));
    return json({ error: unauthorized ? "unauthorized" : "critical_memory_error" }, unauthorized ? 401 : 500);
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
  if (!new Set(["schedule", "workflow_dispatch", "push"]).has(String(claims.event_name || ""))) throw new Error("oidc_event_not_allowed");
  const workflow = String(claims.job_workflow_ref ?? claims.workflow_ref ?? "");
  if (workflow !== AUTONOMOUS_WORKFLOW) throw new Error("oidc_workflow_mismatch");
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
async function safeJson(request: Request) { try { return await request.json(); } catch { return {}; } }
function sanitizeError(error: unknown) { return (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, " ").slice(0, 1200); }
function json(payload: unknown, status = 200) { return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } }); }
