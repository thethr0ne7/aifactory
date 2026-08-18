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

type IncidentCluster = {
  fingerprint?: string;
  canonical_incident_id?: string;
  severity?: string;
  status?: string;
  occurrence_count?: number;
  first_seen_at?: string;
  last_seen_at?: string;
  last_summary?: string;
  affected_invariants?: string[];
  metadata?: Record<string, unknown>;
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

    const { data: clusterRows, error: clusterError } = await db.from("af_incident_clusters")
      .select("fingerprint,canonical_incident_id,severity,status,occurrence_count,first_seen_at,last_seen_at,last_summary,affected_invariants,metadata")
      .in("severity", ["FORBIDDEN", "CATASTROPHIC"])
      .in("status", ["OPEN", "REPAIRING", "BLOCKED"])
      .order("last_seen_at", { ascending: false })
      .limit(limit);
    if (clusterError) throw clusterError;

    const clusters = (clusterRows ?? []) as IncidentCluster[];
    const canonicalIds = [...new Set(clusters.map((row) => row.canonical_incident_id).filter(Boolean))] as string[];
    let incidentRows: any[] = [];
    if (canonicalIds.length) {
      const { data, error } = await db.from("af_incidents")
        .select("id,run_id,task_id,severity,status,summary,root_cause,affected_invariants,negative_action_id,regression_eval_ref,fingerprint,occurrence_count,last_seen_at,created_at,resolved_at")
        .in("id", canonicalIds);
      if (error) throw error;
      incidentRows = data ?? [];
    }

    const byId = new Map(incidentRows.map((row) => [String(row.id), row]));
    const critical = clusters.map((cluster) => {
      const canonical = cluster.canonical_incident_id ? byId.get(String(cluster.canonical_incident_id)) : null;
      return {
        ...(canonical ?? {}),
        id: canonical?.id ?? cluster.canonical_incident_id ?? null,
        severity: cluster.severity ?? canonical?.severity ?? "FORBIDDEN",
        status: cluster.status ?? canonical?.status ?? "OPEN",
        summary: cluster.last_summary ?? canonical?.summary ?? "Canonical critical incident cluster",
        affected_invariants: cluster.affected_invariants ?? canonical?.affected_invariants ?? [],
        fingerprint: cluster.fingerprint ?? canonical?.fingerprint ?? null,
        occurrence_count: Number(cluster.occurrence_count || canonical?.occurrence_count || 1),
        last_seen_at: cluster.last_seen_at ?? canonical?.last_seen_at ?? null,
        cluster: {
          canonical: true,
          fingerprint: cluster.fingerprint ?? null,
          canonical_incident_id: cluster.canonical_incident_id ?? null,
          occurrence_count: Number(cluster.occurrence_count || 1),
          first_seen_at: cluster.first_seen_at ?? null,
          last_seen_at: cluster.last_seen_at ?? null,
          metadata: cluster.metadata ?? {},
        },
      };
    });

    return json({
      critical_incidents: critical,
      policy: {
        mandatory: true,
        relevance_filtering_allowed: false,
        application_scope_required: true,
        unrelated_read_only_block: false,
        current_evidence_wins: true,
        root_of_trust_override: false,
      },
      provenance: {
        source: "public.af_incident_clusters + public.af_incidents",
        canonical_clusters: true,
        cluster_count: critical.length,
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
