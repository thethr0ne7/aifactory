import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "npm:jose@6";

type Claims = JWTPayload & { repository?:string; repository_id?:string; ref?:string; event_name?:string; workflow_ref?:string; job_workflow_ref?:string; run_id?:string; sha?:string };
type Body = { action?:string; worker?:string; task_id?:string; session_id?:string; limit?:number; retry_seconds?:number; record?:Record<string,unknown>; result?:Record<string,unknown>; error?:Record<string,unknown> };

const SUPABASE_URL=mustEnv("SUPABASE_URL");
const db=createClient(SUPABASE_URL,adminKey(),{auth:{persistSession:false,autoRefreshToken:false}});
const ISSUER="https://token.actions.githubusercontent.com";
const AUDIENCE="aifactory-agent-org";
const EXPECTED_REPOSITORY="thethr0ne7/aifactory";
const EXPECTED_REPOSITORY_ID="1334997374";
const EXPECTED_REF="refs/heads/main";
const EXPECTED_WORKFLOW="thethr0ne7/aifactory/.github/workflows/agent-organization.yml@refs/heads/main";
const JWKS=createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks`));
const EVENTS=new Set(["schedule","workflow_dispatch","push"]);
const ACTIVITY_TYPES=new Set(["SESSION_STARTED","OWNER_DIRECTIVE","TASK_CREATED","TASK_PROPOSED","TASK_APPROVED","TASK_REJECTED","TASK_STARTED","AGENT_MESSAGE","DELEGATED","EVIDENCE","BLOCKER","OWNER_GATE","TASK_DONE","TASK_FAILED","INITIATIVE","SESSION_PAUSED","SESSION_RESUMED","SESSION_STOPPED","SESSION_COMPLETE","SYSTEM"]);
const TASK_STATUS=new Set(["DONE","BLOCKED","WAIT_OWNER","FAILED"]);
const EVIDENCE_CLASSES=new Set(["CONFIRMED","OBSERVED","MEASURED","DERIVED","ASSUMPTION","UNKNOWN","BLOCKER"]);

Deno.serve(async(request:Request)=>{
  if(request.method!=="POST")return json({error:"method_not_allowed"},405);
  try{
    const claims=await authenticate(request);
    const body=await safeJson<Body>(request);
    const action=clean(body.action,80);
    const provenance={provider:"github-actions-oidc",repository:claims.repository,ref:claims.ref,workflow_ref:claims.job_workflow_ref??claims.workflow_ref,github_run_id:claims.run_id,github_sha:claims.sha,authenticated_at:new Date().toISOString()};

    if(action==="recover"){
      const {data,error}=await db.rpc("af_recover_agent_org",{p_stale_minutes:10});if(error)throw error;return json({recovered:data});
    }
    if(action==="claim"){
      const worker=clean(body.worker||`agent-org:${claims.run_id||"unknown"}`,200);
      const limit=Math.max(1,Math.min(Number(body.limit)||4,8));
      const {data,error}=await db.rpc("af_claim_agent_tasks",{p_worker:worker,p_limit:limit});if(error)throw error;
      return json({tasks:data??[]});
    }
    if(action==="mark_working"){
      const id=uuid(body.task_id,"task_id"),worker=clean(body.worker,200);
      const {data,error}=await db.from("af_agent_tasks").update({status:"WORKING",updated_at:new Date().toISOString()}).eq("id",id).eq("status","CLAIMED").eq("locked_by",worker).select("id").maybeSingle();
      if(error)throw error;return json({working:Boolean(data?.id)});
    }
    if(action==="context"){
      const id=uuid(body.task_id,"task_id");
      const {data:task,error:tError}=await db.from("af_agent_tasks").select("*").eq("id",id).single();if(tError)throw tError;
      const [{data:session,error:sError},{data:events,error:eError},{data:tasks,error:qError}]=await Promise.all([
        db.from("af_agent_sessions").select("*").eq("id",task.session_id).single(),
        db.from("af_agent_activity").select("event_type,agent_ref,target_agent_ref,message,metadata,created_at").eq("session_id",task.session_id).order("created_at",{ascending:false}).limit(20),
        db.from("af_agent_tasks").select("id,created_by_agent_ref,assigned_agent_ref,domain,objective,status,priority,depth,result,created_at").eq("session_id",task.session_id).order("created_at",{ascending:false}).limit(20)
      ]);
      if(sError)throw sError;if(eError)throw eError;if(qError)throw qError;
      return json({task,session,events:(events??[]).reverse(),tasks:(tasks??[]).reverse()});
    }
    if(action==="candidates"){
      const {data,error}=await db.from("af_agent_candidates").select("candidate_id,n8n_agent_id,name,generation,role,state,autonomy_level,skills,tools,mutation_summary,metadata").in("state",["SPAWNED","TRAINING","EVALUATING","REPAIRING","CANDIDATE","PROMOTED"]).order("generation").order("candidate_id");
      if(error)throw error;return json({candidates:data??[]});
    }
    if(action==="add_event"){
      const r=record(body.record);const sessionId=uuid(r.session_id,"session_id"),eventType=clean(r.event_type,40);
      if(!ACTIVITY_TYPES.has(eventType))return json({error:"invalid_event_type"},400);
      const taskId=r.task_id?uuid(r.task_id,"task_id"):null;
      const message=clean(r.message,6000);if(!message)return json({error:"message_required"},400);
      await assertSession(sessionId);
      if(taskId)await assertTaskSession(taskId,sessionId);
      const {data,error}=await db.from("af_agent_activity").insert({session_id:sessionId,task_id:taskId,event_type:eventType,agent_ref:nullable(r.agent_ref,120),target_agent_ref:nullable(r.target_agent_ref,120),title:nullable(r.title,240),message,metadata:{...object(r.metadata),broker:provenance}}).select("id").single();
      if(error)throw error;
      await db.from("af_agent_sessions").update({last_activity_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",sessionId);
      return json({activity_id:data.id});
    }
    if(action==="create_task"){
      const r=record(body.record);const sessionId=uuid(r.session_id,"session_id");
      const {data:session,error:sError}=await db.from("af_agent_sessions").select("*").eq("id",sessionId).single();if(sError)throw sError;
      if(session.state!=="RUNNING")return json({error:"session_not_running"},409);
      const assigned=candidateId(r.assigned_agent_ref),creator=candidateId(r.created_by_agent_ref);
      await assertAgent(assigned);await assertAgent(creator);
      const objective=clean(r.objective,5000);if(!objective)return json({error:"objective_required"},400);
      const expected=Math.max(0,Math.min(Number(r.expected_value)||0,100));
      if(expected<35)return json({error:"expected_value_below_threshold"},400);
      const depth=Math.max(0,Math.min(Number(r.depth)||0,12));if(depth>Number(session.max_task_depth))return json({error:"task_depth_limit"},400);
      const requestedRisk=clean(r.risk_class||"LOW",16).toUpperCase();
      const forcedGate=ownerGateText(`${objective}\n${clean(r.rationale,3000)}`);
      const risk=forcedGate?"HIGH":new Set(["LOW","MEDIUM","HIGH","ROOT"]).has(requestedRisk)?requestedRisk:"HIGH";
      const requiresOwner=forcedGate||risk!=="LOW"||session.initiative_mode!=="AUTO_INTERNAL"||r.requires_owner_approval===true;
      if(session.initiative_mode==="OFF")return json({error:"initiative_mode_off"},409);
      if(Number(session.auto_task_count)>=Number(session.max_auto_tasks))return json({error:"auto_task_budget_exhausted"},409);
      const fp=clean(r.fingerprint,160)||await fingerprint(`${sessionId}|${assigned}|${objective.toLowerCase()}`);
      const status=requiresOwner?"WAIT_OWNER":"QUEUED";
      const {data,error}=await db.from("af_agent_tasks").insert({session_id:sessionId,correlation_id:session.correlation_id,parent_task_id:r.parent_task_id?uuid(r.parent_task_id,"parent_task_id"):null,created_by_agent_ref:creator,assigned_agent_ref:assigned,domain:clean(r.domain||"general",120),objective,rationale:nullable(r.rationale,4000),expected_value:expected,risk_class:risk,requires_owner_approval:requiresOwner,status,priority:Math.max(0,Math.min(Number(r.priority)||500,1000)),depth,fingerprint:fp,provenance:{...object(r.provenance),broker:provenance}}).select("*").single();
      if(error){if(String(error.code)==="23505")return json({created:false,duplicate:true});throw error;}
      await db.from("af_agent_sessions").update({auto_task_count:Number(session.auto_task_count)+1,last_activity_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",sessionId);
      return json({created:true,task:data,owner_gate:requiresOwner});
    }
    if(action==="complete"){
      const id=uuid(body.task_id,"task_id"),worker=clean(body.worker,200);const r=record(body.result);const status=clean(r.status||"DONE",24).toUpperCase();
      if(!TASK_STATUS.has(status))return json({error:"invalid_finish_status"},400);
      if(r.evidence_class&&!EVIDENCE_CLASSES.has(clean(r.evidence_class,32).toUpperCase()))return json({error:"invalid_evidence_class"},400);
      const {data:task,error:qError}=await db.from("af_agent_tasks").select("session_id").eq("id",id).single();if(qError)throw qError;
      const {data,error}=await db.rpc("af_finish_agent_task",{p_task_id:id,p_worker:worker,p_status:status,p_result:{...r,broker:provenance},p_error:null});if(error)throw error;
      if(data===true&&status==="WAIT_OWNER")await db.from("af_agent_sessions").update({last_activity_at:new Date().toISOString()}).eq("id",task.session_id);
      return json({completed:data===true,status});
    }
    if(action==="fail"){
      const id=uuid(body.task_id,"task_id"),worker=clean(body.worker,200),seconds=Math.max(5,Math.min(Number(body.retry_seconds)||30,3600));
      const {data,error}=await db.rpc("af_fail_agent_task",{p_task_id:id,p_worker:worker,p_error:object(body.error),p_retry_seconds:seconds});if(error)throw error;return json({status:data});
    }
    if(action==="claim_idle_session"){
      const {data,error}=await db.from("af_agent_sessions").select("*").eq("state","RUNNING").eq("initiative_mode","AUTO_INTERNAL").lt("auto_task_count",16).order("last_activity_at",{ascending:true}).limit(20);
      if(error)throw error;
      const rows=data??[];let chosen:any=null;
      for(const row of rows){
        if(Number(row.auto_task_count)>=Number(row.max_auto_tasks))continue;
        const last=row.last_initiative_at?Date.parse(row.last_initiative_at):0;if(last&&Date.now()-last<15*60*1000)continue;
        const {count,error:cError}=await db.from("af_agent_tasks").select("id",{count:"exact",head:true}).eq("session_id",row.id).in("status",["QUEUED","CLAIMED","WORKING","WAIT_OWNER","PROPOSED"]);if(cError)throw cError;
        if((count??0)>0)continue;
        chosen=row;break;
      }
      if(!chosen)return json({session:null});
      const {data:updated,error:uError}=await db.from("af_agent_sessions").update({last_initiative_at:new Date().toISOString(),initiative_cursor:Number(chosen.initiative_cursor||0)+1,updated_at:new Date().toISOString()}).eq("id",chosen.id).eq("initiative_cursor",chosen.initiative_cursor).select("*").maybeSingle();if(uError)throw uError;
      return json({session:updated??null});
    }
    return json({error:"unsupported_action"},400);
  }catch(error){const msg=safeError(error),unauthorized=msg.startsWith("oidc_");console.error(JSON.stringify({event:"agent_org_broker_error",error:msg}));return json({error:unauthorized?"unauthorized":"broker_error",detail:msg},unauthorized?401:500);}
});

async function assertSession(id:string){const{data,error}=await db.from("af_agent_sessions").select("id").eq("id",id).maybeSingle();if(error)throw error;if(!data)throw new Error("session_not_found");}
async function assertTaskSession(taskId:string,sessionId:string){const{data,error}=await db.from("af_agent_tasks").select("id").eq("id",taskId).eq("session_id",sessionId).maybeSingle();if(error)throw error;if(!data)throw new Error("task_session_mismatch");}
async function assertAgent(id:string){const{data,error}=await db.from("af_agent_candidates").select("candidate_id,state,autonomy_level").eq("candidate_id",id).maybeSingle();if(error)throw error;if(!data)throw new Error(`agent_not_found_${id}`);if(new Set(["REJECTED","QUARANTINED"]).has(String(data.state)))throw new Error(`agent_not_operational_${id}`);if(Number(String(data.autonomy_level||"A9").slice(1))>3)throw new Error(`agent_autonomy_out_of_bounds_${id}`);}
function ownerGateText(text:string){return /\b(publish|publication|deploy|production write|prod write|purchase|procure|spend|payment|credential|secret|permission|autonomy|root of trust|delete production|send email|send message externally|external side effect|merge to main)\b/i.test(text);}
async function authenticate(request:Request):Promise<Claims>{const token=(request.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1];if(!token)throw new Error("oidc_missing_bearer");const{payload}=await jwtVerify(token,JWKS,{issuer:ISSUER,audience:AUDIENCE,algorithms:["RS256"],clockTolerance:10});const c=payload as Claims;if(c.repository!==EXPECTED_REPOSITORY||c.repository_id!==EXPECTED_REPOSITORY_ID)throw new Error("oidc_repository_mismatch");if(c.ref!==EXPECTED_REF)throw new Error("oidc_ref_mismatch");if(String(c.job_workflow_ref??c.workflow_ref??"")!==EXPECTED_WORKFLOW)throw new Error("oidc_workflow_mismatch");if(!EVENTS.has(String(c.event_name||"")))throw new Error("oidc_event_mismatch");return c;}
function adminKey(){const keys=Deno.env.get("SUPABASE_SECRET_KEYS");if(keys){try{const p=JSON.parse(keys);if(p.default)return String(p.default);}catch{}}return mustEnv("SUPABASE_SERVICE_ROLE_KEY");}
function mustEnv(n:string){const v=Deno.env.get(n);if(!v)throw new Error(`missing_env_${n}`);return v;}
function clean(v:unknown,max:number){return String(v??"").replace(/[\u0000\r]+/g," ").trim().slice(0,max);}function nullable(v:unknown,max:number){const s=clean(v,max);return s||null;}function object(v:unknown){return v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:{};}function record(v:unknown){if(!v||typeof v!=="object"||Array.isArray(v))throw new Error("record_required");return v as Record<string,unknown>;}function uuid(v:unknown,n:string){const s=String(v??"");if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s))throw new Error(`invalid_${n}`);return s;}function candidateId(v:unknown){const s=clean(v,120);if(!/^[a-z0-9][a-z0-9-]{2,119}$/.test(s))throw new Error("invalid_candidate_id");return s;}async function fingerprint(v:string){const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,"0")).join("");}async function safeJson<T>(r:Request){try{return await r.json() as T;}catch{return{} as T;}}function safeError(e:unknown){return(e instanceof Error?e.message:String(e)).replace(/[\r\n]+/g," ").slice(0,1200);}function json(p:unknown,s=200){return new Response(JSON.stringify(p),{status:s,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"}});}
