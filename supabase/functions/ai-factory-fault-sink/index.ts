import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "npm:jose@6";

type Claims = JWTPayload & { repository?:string; repository_id?:string; ref?:string; event_name?:string; workflow_ref?:string; job_workflow_ref?:string; run_id?:string; run_number?:string; run_attempt?:string; actor?:string; sha?:string };
const url = mustEnv("SUPABASE_URL");
const db = createClient(url, adminKey(), { auth:{persistSession:false,autoRefreshToken:false} });
const issuer = "https://token.actions.githubusercontent.com";
const audience = "aifactory-supabase-runtime";
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks`));
const allowedWorkflows = new Set([
  "thethr0ne7/aifactory/.github/workflows/factory-autonomous-worker.yml@refs/heads/main",
  "thethr0ne7/aifactory/.github/workflows/factory-self-improvement.yml@refs/heads/main",
  "thethr0ne7/aifactory/.github/workflows/factory-tool-executor.yml@refs/heads/main",
  "thethr0ne7/aifactory/.github/workflows/factory-watchdog.yml@refs/heads/main"
]);

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({error:"method_not_allowed"},405);
  try {
    const claims = await auth(request);
    const body = await safeJson(request);
    const summary = clean(body?.summary || "AI Factory workflow failed before a truthful terminal state was confirmed.", 4000);
    const affected = strings(body?.affected_invariants, 20, 160);
    const evidence = {
      code: clean(body?.code || "FACTORY_WORKFLOW_FAILURE",120),
      scope: clean(body?.scope || "unknown",160),
      details: object(body?.evidence),
      github_run_id: claims.run_id,
      run_number: claims.run_number,
      run_attempt: claims.run_attempt,
      sha: claims.sha,
      workflow_ref: claims.job_workflow_ref ?? claims.workflow_ref,
      event_name: claims.event_name,
      actor: claims.actor,
      actions_url: claims.run_id ? `https://github.com/thethr0ne7/aifactory/actions/runs/${claims.run_id}` : null
    };
    const { data, error } = await db.from("af_incidents").insert({
      run_id: null,
      task_id: null,
      severity: "UNDESIRABLE",
      summary,
      evidence,
      root_cause: {status:"UNKNOWN",requires_reproduction:true},
      affected_invariants: affected.length ? affected : ["durable-error-memory","terminal-state-integrity"],
      repair: {action:"maintenance crew must inspect the failed workflow run, reproduce the failure, cluster it by fingerprint and prove a regression repair"}
    }).select("id,fingerprint,occurrence_count").single();
    if (error) throw error;
    return json({incident_id:data.id,fingerprint:data.fingerprint,occurrence_count:data.occurrence_count});
  } catch (error) {
    const message = sanitize(error);
    const unauthorized = message.startsWith("oidc_");
    console.error(JSON.stringify({event:"factory_fault_sink_error",error:message}));
    return json({error:unauthorized?"unauthorized":"fault_sink_error"},unauthorized?401:500);
  }
});

async function auth(request:Request):Promise<Claims>{
  const token=(request.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1];
  if(!token) throw new Error("oidc_missing_bearer_token");
  const {payload}=await jwtVerify(token,jwks,{issuer,audience,algorithms:["RS256"],clockTolerance:10});
  const c=payload as Claims;
  if(c.repository!=="thethr0ne7/aifactory"||c.repository_id!=="1334997374") throw new Error("oidc_repository_mismatch");
  if(c.ref!=="refs/heads/main") throw new Error("oidc_ref_mismatch");
  if(!new Set(["schedule","workflow_dispatch","push"]).has(String(c.event_name||""))) throw new Error("oidc_event_not_allowed");
  const workflow=String(c.job_workflow_ref??c.workflow_ref??"");
  if(!allowedWorkflows.has(workflow)) throw new Error("oidc_workflow_mismatch");
  return c;
}
function adminKey(){const keys=Deno.env.get("SUPABASE_SECRET_KEYS");if(keys){try{const p=JSON.parse(keys);if(p.default)return String(p.default);}catch{}}return mustEnv("SUPABASE_SERVICE_ROLE_KEY");}
function mustEnv(name:string){const v=Deno.env.get(name);if(!v)throw new Error(`missing_env_${name}`);return v;}
async function safeJson(r:Request){try{return await r.json();}catch{return {};}}
function clean(v:unknown,n:number){return String(v??"").replace(/[\u0000\r]+/g," ").trim().slice(0,n);}
function strings(v:unknown,n:number,m:number){return Array.isArray(v)?[...new Set(v.map(x=>clean(x,m)).filter(Boolean))].slice(0,n):[];}
function object(v:unknown){return v&&typeof v==="object"&&!Array.isArray(v)?v:{};}
function sanitize(e:unknown){return(e instanceof Error?e.message:String(e)).replace(/[\r\n]+/g," ").slice(0,1200);}
function json(p:unknown,status=200){return new Response(JSON.stringify(p),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});}
