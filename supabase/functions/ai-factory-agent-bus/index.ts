import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "npm:jose@6";

type Claims = JWTPayload & { repository?: string; repository_id?: string; ref?: string; event_name?: string; workflow_ref?: string; job_workflow_ref?: string; actor_id?: string; run_id?: string; sha?: string };
type Body = { action?: string; worker?: string; limit?: number; stale_minutes?: number; message_id?: string; retry_seconds?: number; error?: unknown; result?: unknown; record?: Record<string, unknown>; correlation_id?: string; candidate_id?: string };

const SUPABASE_URL = mustEnv("SUPABASE_URL");
const db = createClient(SUPABASE_URL, adminKey(), { auth: { persistSession: false, autoRefreshToken: false } });
const ISSUER = "https://token.actions.githubusercontent.com";
const AUDIENCE = "aifactory-agent-bus";
const EXPECTED_REPOSITORY = "thethr0ne7/aifactory";
const EXPECTED_REPOSITORY_ID = "1334997374";
const OWNER_ACTOR_ID = "124492332";
const MAIN_REF = "refs/heads/main";
const ACCEPTANCE_REF = "refs/pull/42/merge";
const WORKFLOW_PATH = "thethr0ne7/aifactory/.github/workflows/agent-message-bus.yml@";
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks`));
const EVIDENCE = new Set(["CONFIRMED","OBSERVED","MEASURED","DERIVED","ASSUMPTION","UNKNOWN","BLOCKER"]);
const STAGES = new Set(["RESEARCH","EVIDENCE","BUILD","AUDIT","BIRTH","CONTROL"]);
const STATES = new Set(["DRAFT","SPAWNED","TRAINING","EVALUATING","REPAIRING","CANDIDATE","PROMOTED","REJECTED","QUARANTINED"]);
const AUTONOMY = new Set(["A0","A1","A2","A3"]);
const RELATIONS = new Set(["PARENT","MENTOR","SUPERVISOR","SUBAGENT","EVALUATOR"]);

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const claims = await authenticate(request);
    const body = await safeJson<Body>(request);
    const action = clean(body.action, 80);
    if (!action) return json({ error: "action_required" }, 400);
    const provenance = { provider: "github-actions-oidc", repository: claims.repository, ref: claims.ref, sha: claims.sha, workflow_ref: claims.job_workflow_ref ?? claims.workflow_ref, run_id: claims.run_id, authenticated_at: new Date().toISOString() };

    if (action === "claim") {
      const worker = clean(body.worker, 200);
      const limit = Math.max(1, Math.min(Number(body.limit) || 4, 6));
      const { data, error } = await db.rpc("af_bus_claim", { p_worker: worker, p_limit: limit });
      if (error) throw error;
      return json({ messages: data ?? [] });
    }
    if (action === "complete") {
      const { data, error } = await db.rpc("af_bus_complete", { p_message_id: uuid(body.message_id, "message_id"), p_worker: clean(body.worker, 200), p_result: objectOrEmpty(body.result) });
      if (error) throw error;
      return json({ completed: data === true });
    }
    if (action === "fail") {
      const retry = Math.max(5, Math.min(Number(body.retry_seconds) || 30, 3600));
      const { data, error } = await db.rpc("af_bus_fail", { p_message_id: uuid(body.message_id, "message_id"), p_worker: clean(body.worker, 200), p_error: objectOrEmpty(body.error), p_retry_seconds: retry });
      if (error) throw error;
      return json({ status: data });
    }
    if (action === "recover") {
      const minutes = Math.max(5, Math.min(Number(body.stale_minutes) || 10, 1440));
      const { data, error } = await db.rpc("af_bus_recover_stale", { p_stale_minutes: minutes });
      if (error) throw error;
      return json({ recovered: data ?? 0 });
    }
    if (action === "block") {
      const id = uuid(body.message_id, "message_id");
      const worker = clean(body.worker, 200);
      const { data, error } = await db.from("af_agent_messages").update({ status: "BLOCKED", result: objectOrEmpty(body.result), locked_at: null, locked_by: null, updated_at: new Date().toISOString() }).eq("id", id).eq("status", "CLAIMED").eq("locked_by", worker).select("id").maybeSingle();
      if (error) throw error;
      return json({ blocked: Boolean(data?.id) });
    }
    if (action === "read_correlation") {
      const correlation = uuid(body.correlation_id, "correlation_id");
      const [m,e,h,b] = await Promise.all([
        db.from("af_agent_messages").select("id,correlation_id,causation_id,from_agent_ref,to_agent_ref,kind,stage,payload,status,priority,attempts,max_attempts,result,created_at").eq("correlation_id", correlation).order("created_at").limit(100),
        db.from("af_shared_evidence").select("id,correlation_id,message_id,producer_agent_ref,stage,evidence_class,claim,source_refs,payload,created_at").eq("correlation_id", correlation).order("created_at").limit(120),
        db.from("af_agent_handoffs").select("id,correlation_id,from_stage,to_stage,from_agent_ref,to_agent_ref,message_id,evidence_refs,gate_status,summary,created_at").eq("correlation_id", correlation).order("created_at").limit(40),
        db.from("af_agent_birth_proposals").select("id,correlation_id,proposed_candidate_id,proposed_name,proposed_role,generation,autonomy_level,parent_refs,sponsor_agent_refs,evidence_refs,blueprint,audit_result,status,n8n_agent_id,production_authority_granted,publication_attempted,created_at,updated_at").eq("correlation_id", correlation).limit(10),
      ]);
      for (const r of [m,e,h,b]) if (r.error) throw r.error;
      return json({ messages: m.data ?? [], evidence: e.data ?? [], handoffs: h.data ?? [], births: b.data ?? [] });
    }
    if (action === "get_candidate") {
      const id = candidateId(body.candidate_id);
      const { data, error } = await db.from("af_agent_candidates").select("candidate_id,n8n_agent_id,name,generation,role,state,autonomy_level,parent_refs,skills,tools,model,metadata").eq("candidate_id", id).maybeSingle();
      if (error) throw error;
      return json({ candidate: data ?? null });
    }
    if (action === "seed_message") {
      const r = requireRecord(body.record);
      const correlation = uuid(r.correlation_id, "correlation_id");
      const { data: existing, error: qError } = await db.from("af_agent_messages").select("id,stage,status").eq("correlation_id", correlation).limit(1);
      if (qError) throw qError;
      if (existing?.length) return json({ seeded: false, existing: existing[0] });
      const record = messageRecord(r, provenance);
      const { data, error } = await db.from("af_agent_messages").insert(record).select("id,stage,status").single();
      if (error) throw error;
      return json({ seeded: true, message: data });
    }
    if (action === "add_message") {
      const { data, error } = await db.from("af_agent_messages").insert(messageRecord(requireRecord(body.record), provenance)).select("id,stage,status").single();
      if (error) throw error;
      return json({ message: data });
    }
    if (action === "add_evidence") {
      const r = requireRecord(body.record);
      const evidenceClass = clean(r.evidence_class, 32); if (!EVIDENCE.has(evidenceClass)) return json({ error: "invalid_evidence_class" }, 400);
      const stage = clean(r.stage, 16); if (!STAGES.has(stage)) return json({ error: "invalid_stage" }, 400);
      const record = { correlation_id: uuid(r.correlation_id,"correlation_id"), message_id: optionalUuid(r.message_id,"message_id"), producer_agent_ref: candidateId(r.producer_agent_ref), stage, evidence_class: evidenceClass, claim: clean(r.claim, 4000), source_refs: arrayOrEmpty(r.source_refs).slice(0,40), payload: objectOrEmpty(r.payload) };
      const { data, error } = await db.from("af_shared_evidence").insert(record).select("id").single(); if (error) throw error; return json({ evidence_id: data.id });
    }
    if (action === "add_handoff") {
      const r = requireRecord(body.record); const fromStage=clean(r.from_stage,16), toStage=clean(r.to_stage,16); if(!STAGES.has(fromStage)||!STAGES.has(toStage))return json({error:"invalid_stage"},400);
      const gate=clean(r.gate_status,16); if(!new Set(["PASS","BLOCK","REPAIR","PENDING"]).has(gate))return json({error:"invalid_gate"},400);
      const record={correlation_id:uuid(r.correlation_id,"correlation_id"),from_stage:fromStage,to_stage:toStage,from_agent_ref:candidateId(r.from_agent_ref),to_agent_ref:candidateId(r.to_agent_ref),message_id:optionalUuid(r.message_id,"message_id"),evidence_refs:arrayOrEmpty(r.evidence_refs).slice(0,40),gate_status:gate,summary:objectOrEmpty(r.summary)};
      const {data,error}=await db.from("af_agent_handoffs").insert(record).select("id").single(); if(error)throw error; return json({handoff_id:data.id});
    }
    if (action === "sync_candidate") {
      const r=requireRecord(body.record); const id=candidateId(r.candidate_id); const autonomy=clean(r.autonomy_level,2); if(!AUTONOMY.has(autonomy))return json({error:"invalid_autonomy"},400); const incomingState=clean(r.state,32); if(!STATES.has(incomingState))return json({error:"invalid_state"},400);
      const {data:existing,error:qError}=await db.from("af_agent_candidates").select("state").eq("candidate_id",id).maybeSingle(); if(qError)throw qError;
      const state=stateRank(existing?.state)>=stateRank(incomingState)?existing!.state:incomingState;
      const record={candidate_id:id,n8n_agent_id:nullableClean(r.n8n_agent_id,200),name:clean(r.name,240),generation:Math.max(0,Math.min(Number(r.generation)||0,12)),role:clean(r.role,160),state,autonomy_level:autonomy,parent_refs:arrayOrEmpty(r.parent_refs).slice(0,8),skills:arrayOrEmpty(r.skills).slice(0,40),tools:arrayOrEmpty(r.tools).slice(0,40),model:objectOrEmpty(r.model),mutation_summary:nullableClean(r.mutation_summary,4000),provenance:{...objectOrEmpty(r.provenance),broker:provenance},metadata:objectOrEmpty(r.metadata),updated_at:new Date().toISOString()};
      const {error}=await db.from("af_agent_candidates").upsert(record,{onConflict:"candidate_id"}); if(error)throw error; return json({candidate_id:id,state});
    }
    if (action === "sync_relationship") {
      const r=requireRecord(body.record); const relation=clean(r.relation_type,32); if(!RELATIONS.has(relation))return json({error:"invalid_relation"},400);
      const record={parent_candidate_id:candidateId(r.parent_candidate_id),child_candidate_id:candidateId(r.child_candidate_id),relation_type:relation,use_when:nullableClean(r.use_when,2000),active:r.active!==false,provenance:{...objectOrEmpty(r.provenance),broker:provenance}};
      const {error}=await db.from("af_agent_relationships").upsert(record,{onConflict:"parent_candidate_id,child_candidate_id,relation_type"}); if(error)throw error; return json({ok:true});
    }
    if (action === "upsert_birth") {
      const r=requireRecord(body.record); if(r.production_authority_granted===true||r.publication_attempted===true)return json({error:"birth_authority_expansion_denied"},400); const autonomy=clean(r.autonomy_level||"A2",2); if(!AUTONOMY.has(autonomy)||Number(autonomy.slice(1))>2)return json({error:"birth_autonomy_must_be_A2_or_lower"},400);
      const status=clean(r.status,32); if(!new Set(["PROPOSED","EVALUATING","APPROVED_FOR_SPAWN","SPAWNED","REJECTED","BLOCKED"]).has(status))return json({error:"invalid_birth_status"},400);
      const record={correlation_id:uuid(r.correlation_id,"correlation_id"),proposed_candidate_id:candidateId(r.proposed_candidate_id),proposed_name:clean(r.proposed_name,240),proposed_role:clean(r.proposed_role,160),generation:Math.max(1,Math.min(Number(r.generation)||3,12)),autonomy_level:autonomy,parent_refs:arrayOrEmpty(r.parent_refs).slice(0,8),sponsor_agent_refs:arrayOrEmpty(r.sponsor_agent_refs).slice(0,8),evidence_refs:arrayOrEmpty(r.evidence_refs).slice(0,120),blueprint:objectOrEmpty(r.blueprint),audit_result:objectOrEmpty(r.audit_result),status,n8n_agent_id:nullableClean(r.n8n_agent_id,200),production_authority_granted:false,publication_attempted:false,updated_at:new Date().toISOString()};
      const {error}=await db.from("af_agent_birth_proposals").upsert(record,{onConflict:"correlation_id,proposed_candidate_id"}); if(error)throw error; return json({ok:true,status});
    }
    if (action === "add_lifecycle") {
      const r=requireRecord(body.record); const evidenceClass=clean(r.evidence_class,32); if(!EVIDENCE.has(evidenceClass))return json({error:"invalid_evidence_class"},400); const to=clean(r.to_state,32); if(!STATES.has(to))return json({error:"invalid_state"},400);
      const record={candidate_id:candidateId(r.candidate_id),from_state:nullableClean(r.from_state,32),to_state:to,event_type:clean(r.event_type,160),evidence_class:evidenceClass,payload:objectOrEmpty(r.payload),provenance:{...objectOrEmpty(r.provenance),broker:provenance}};
      const {data,error}=await db.from("af_agent_lifecycle_events").insert(record).select("id").single(); if(error)throw error; return json({event_id:data.id});
    }
    return json({ error: "unsupported_action" }, 400);
  } catch (error) {
    const message=sanitizeError(error); const unauthorized=message.startsWith("oidc_"); console.error(JSON.stringify({event:"agent_bus_broker_error",error:message})); return json({error:unauthorized?"unauthorized":"broker_error"},unauthorized?401:500);
  }
});

function messageRecord(r:Record<string,unknown>, provenance:Record<string,unknown>){const stage=clean(r.stage,16);if(!STAGES.has(stage))throw new Error("invalid_stage");const kind=clean(r.kind||"HANDOFF",32);if(!new Set(["TASK","HANDOFF","EVIDENCE","REVIEW","RESULT","INCIDENT","BIRTH_PROPOSAL"]).has(kind))throw new Error("invalid_kind");return{correlation_id:uuid(r.correlation_id,"correlation_id"),causation_id:optionalUuid(r.causation_id,"causation_id"),from_agent_ref:candidateId(r.from_agent_ref),to_agent_ref:candidateId(r.to_agent_ref),kind,stage,payload:{...objectOrEmpty(r.payload),broker_provenance:provenance},status:"QUEUED",priority:Math.max(0,Math.min(Number(r.priority)||100,1000)),max_attempts:Math.max(1,Math.min(Number(r.max_attempts)||3,5))};}
async function authenticate(request:Request):Promise<Claims>{const token=(request.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1];if(!token)throw new Error("oidc_missing_bearer_token");const{payload}=await jwtVerify(token,JWKS,{issuer:ISSUER,audience:AUDIENCE,algorithms:["RS256"],clockTolerance:10});const c=payload as Claims;if(c.repository!==EXPECTED_REPOSITORY)throw new Error("oidc_repository_mismatch");if(c.repository_id!==EXPECTED_REPOSITORY_ID)throw new Error("oidc_repository_id_mismatch");const ref=String(c.ref||"");const event=String(c.event_name||"");const workflow=String(c.job_workflow_ref??c.workflow_ref??"");const expectedWorkflow=`${WORKFLOW_PATH}${ref}`;if(workflow!==expectedWorkflow)throw new Error("oidc_workflow_mismatch");const main=ref===MAIN_REF&&new Set(["schedule","workflow_dispatch","push"]).has(event);const acceptance=ref===ACCEPTANCE_REF&&event==="pull_request"&&String(c.actor_id||"")===OWNER_ACTOR_ID;if(!main&&!acceptance)throw new Error("oidc_ref_or_event_not_allowed");return c;}
function stateRank(v:unknown){return["DRAFT","SPAWNED","TRAINING","EVALUATING","REPAIRING","CANDIDATE","PROMOTED"].indexOf(String(v||""));}
function candidateId(v:unknown){const s=clean(v,120);if(!/^[a-z0-9][a-z0-9-]{2,119}$/.test(s))throw new Error("invalid_candidate_id");return s;}
function uuid(v:unknown,n:string){const s=String(v??"");if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s))throw new Error(`invalid_${n}`);return s;}
function optionalUuid(v:unknown,n:string){return v?uuid(v,n):null;}function objectOrEmpty(v:unknown){return v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:{};}function arrayOrEmpty(v:unknown){return Array.isArray(v)?v:[];}function requireRecord(v:unknown){if(!v||typeof v!=="object"||Array.isArray(v))throw new Error("record_required");return v as Record<string,unknown>;}function clean(v:unknown,max:number){return String(v??"").replace(/[\u0000\r]+/g," ").trim().slice(0,max);}function nullableClean(v:unknown,max:number){const s=clean(v,max);return s||null;}async function safeJson<T>(r:Request){try{return await r.json() as T;}catch{return{} as T;}}function adminKey(){const keys=Deno.env.get("SUPABASE_SECRET_KEYS");if(keys){try{const p=JSON.parse(keys);if(p.default)return String(p.default);}catch{}}return mustEnv("SUPABASE_SERVICE_ROLE_KEY");}function mustEnv(n:string){const v=Deno.env.get(n);if(!v)throw new Error(`missing_env_${n}`);return v;}function sanitizeError(e:unknown){return(e instanceof Error?e.message:String(e)).replace(/[\r\n]+/g," ").slice(0,1200);}function json(p:unknown,s=200){return new Response(JSON.stringify(p),{status:s,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"}});}
