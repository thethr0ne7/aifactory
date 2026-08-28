import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL=mustEnv("SUPABASE_URL");
const BOT_TOKEN=mustEnv("TELEGRAM_BOT_TOKEN");
const N8N_MCP_URL="https://thethr0ne7.app.n8n.cloud/mcp-server/http";
const N8N_PROJECT_ID="FP3HOvN6NpEDN0PB";
const GROQ_CHAT_URL="https://api.groq.com/openai/v1/chat/completions";
const db=createClient(SUPABASE_URL,adminKey(),{auth:{persistSession:false,autoRefreshToken:false}});

type Body={task_id?:string};
class TransportUnavailableError extends Error{}

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return json({error:"method_not_allowed"},405);
  try{
    await authenticateInternal(req);
    const body=await safeJson<Body>(req);
    const taskId=uuid(body.task_id,"task_id");
    const worker=`edge-hot:${crypto.randomUUID()}`;
    EdgeRuntime.waitUntil(runTask(taskId,worker).catch((error)=>console.error(JSON.stringify({event:"hot_runtime_failure",task_id:taskId,error:safeError(error)}))));
    return json({ok:true,accepted:true,task_id:taskId});
  }catch(error){const msg=safeError(error);return json({error:msg.startsWith("auth_")?"unauthorized":"hot_runtime_rejected",detail:msg},msg.startsWith("auth_")?401:400);}
});

async function runTask(taskId:string,worker:string){
  const {data:claimed,error:cError}=await db.rpc("af_claim_agent_task_by_id",{p_task_id:taskId,p_worker:worker});
  if(cError)throw cError;
  const task=Array.isArray(claimed)?claimed[0]??null:claimed??null;
  if(!task)return;
  try{
    const {data:working,error:wError}=await db.from("af_agent_tasks").update({status:"WORKING",updated_at:new Date().toISOString()}).eq("id",task.id).eq("status","CLAIMED").eq("locked_by",worker).select("*").maybeSingle();
    if(wError)throw wError;if(!working)return;
    const ctx=await context(working);
    await activity(working.session_id,working.id,"TASK_STARTED",working.assigned_agent_ref,null,"Задача взята в работу",`${working.assigned_agent_ref} начал: ${clean(working.objective,1000)}`);
    await deliverActivity(working.session_id);

    const execution=await executeAgent(ctx,taskPrompt(ctx));
    const parsed=extractJson(execution.text);
    const message=clean(parsed.message,1800);if(!message)throw new Error("agent_message_required");
    const status=String(parsed.status||"DONE").toUpperCase();if(!new Set(["DONE","DELEGATE","BLOCKED","WAIT_OWNER"]).has(status))throw new Error("invalid_agent_status");
    const evidenceClass=clean(parsed.evidence_class||"DERIVED",32).toUpperCase();
    await activity(working.session_id,working.id,status==="BLOCKED"?"BLOCKER":"AGENT_MESSAGE",working.assigned_agent_ref,null,ctx.agent?.name||working.assigned_agent_ref,message,{evidence_class:evidenceClass,status,executor:execution.executor,model:execution.model});

    let created=0,ownerGates=0;
    for(const d of (Array.isArray(parsed.delegations)?parsed.delegations:[]).slice(0,2)){
      const child=await createDelegation(ctx,working,d);if(!child)continue;created+=1;if(child.requires_owner_approval)ownerGates+=1;
      await activity(working.session_id,child.id,child.requires_owner_approval?"OWNER_GATE":"DELEGATED",working.assigned_agent_ref,child.assigned_agent_ref,child.requires_owner_approval?"Нужно решение владельца":"Агент передал задачу коллеге",`${working.assigned_agent_ref} → ${child.assigned_agent_ref}\n${clean(child.objective,1200)}`,{parent_task_id:working.id,executor:execution.executor});
    }

    const finalStatus=status==="BLOCKED"?"BLOCKED":status==="WAIT_OWNER"?"WAIT_OWNER":"DONE";
    const {data:finished,error:fError}=await db.rpc("af_finish_agent_task",{p_task_id:working.id,p_worker:worker,p_status:finalStatus,p_result:{status:finalStatus,message,evidence_class:evidenceClass,delegations_created:created,owner_gates:ownerGates,owner_question:clean(parsed.owner_question,1200),executor:execution.executor,model:execution.model},p_error:null});
    if(fError)throw fError;if(finished!==true)throw new Error("task_finish_lost_lock");
    await activity(working.session_id,working.id,finalStatus==="DONE"?"TASK_DONE":finalStatus==="WAIT_OWNER"?"OWNER_GATE":"BLOCKER",working.assigned_agent_ref,null,finalStatus==="DONE"?"Задача завершена":finalStatus==="WAIT_OWNER"?"Ожидается владелец":"Задача заблокирована",finalStatus==="DONE"?`Готово. Создано следующих задач: ${created}.`:(clean(parsed.owner_question,1200)||message),{status:finalStatus,executor:execution.executor});
    await deliverActivity(working.session_id);
  }catch(error){
    const detail=safeError(error);
    if(error instanceof TransportUnavailableError){
      const {data:deferred,error:dError}=await db.rpc("af_defer_agent_task",{p_task_id:task.id,p_worker:worker,p_reason:{message:detail,executor:"supabase-edge-hot"},p_retry_seconds:300});
      if(dError)throw dError;
      if(deferred===true){
        await activity(task.session_id,task.id,"TASK_FAILED",task.assigned_agent_ref,null,"Runtime временно недоступен","Задача сохранена без расходования попытки и будет автоматически повторена после восстановления модельного транспорта.",{executor:"supabase-edge-hot",transport_deferred:true}).catch(()=>{});
        await deliverActivity(task.session_id).catch(()=>{});
      }
      return;
    }
    const retrySeconds=/rate limit|429|timeout|temporar|service unavailable/i.test(detail)?45:15;
    await db.rpc("af_fail_agent_task",{p_task_id:task.id,p_worker:worker,p_error:{message:detail,executor:"supabase-edge-hot"},p_retry_seconds:retrySeconds});
    await activity(task.session_id,task.id,"TASK_FAILED",task.assigned_agent_ref,null,"Быстрый runtime не завершил задачу",`Задача сохранена в очереди для повторной попытки/recovery. ${detail.slice(0,500)}`,{executor:"supabase-edge-hot"}).catch(()=>{});
    await deliverActivity(task.session_id).catch(()=>{});
  }
}

async function context(task:any){
  const [{data:session,error:sError},{data:events,error:eError},{data:tasks,error:tError},{data:candidates,error:cError}]=await Promise.all([
    db.from("af_agent_sessions").select("*").eq("id",task.session_id).single(),
    db.from("af_agent_activity").select("event_type,agent_ref,target_agent_ref,message,metadata,created_at").eq("session_id",task.session_id).order("created_at",{ascending:false}).limit(16),
    db.from("af_agent_tasks").select("id,assigned_agent_ref,domain,objective,status,priority,depth,result,created_at").eq("session_id",task.session_id).order("created_at",{ascending:false}).limit(16),
    db.from("af_agent_candidates").select("candidate_id,n8n_agent_id,name,role,state,autonomy_level,model").in("state",["SPAWNED","TRAINING","EVALUATING","REPAIRING","CANDIDATE","PROMOTED"]).order("generation").limit(40)
  ]);
  if(sError)throw sError;if(eError)throw eError;if(tError)throw tError;if(cError)throw cError;
  const agent=(candidates??[]).find((x:any)=>x.candidate_id===task.assigned_agent_ref);if(!agent)throw new Error(`agent_not_found_${task.assigned_agent_ref}`);
  return{task,session,events:(events??[]).reverse(),tasks:(tasks??[]).reverse(),candidates:candidates??[],agent};
}

function taskPrompt(ctx:any){return[
  "You are a real bounded AI Factory agent working inside a visible Telegram workroom.",
  `YOUR_AGENT=${ctx.task.assigned_agent_ref}; ROLE=${ctx.agent?.role||"unknown"}; AUTONOMY=${ctx.agent?.autonomy_level||"A1"}.`,
  `SESSION_STATE=${ctx.session.state}; INITIATIVE_MODE=${ctx.session.initiative_mode}; TASK_DEPTH=${ctx.task.depth}/${ctx.session.max_task_depth}.`,
  `ROOT_OBJECTIVE=${clean(ctx.session.root_objective,2200)}`,
  `CURRENT_TASK=${clean(ctx.task.objective,2200)}`,
  ctx.task.rationale?`RATIONALE=${clean(ctx.task.rationale,1200)}`:"",
  `RECENT_ACTIVITY=${JSON.stringify(ctx.events).slice(0,6000)}`,
  `RECENT_TASKS=${JSON.stringify(ctx.tasks).slice(0,6000)}`,
  `AVAILABLE_AGENTS=${JSON.stringify(ctx.candidates.map((x:any)=>({candidate_id:x.candidate_id,role:x.role,name:x.name}))).slice(0,6000)}`,
  "Work only with supplied context. Do not claim external browsing, writes, deployments, messages, purchases or tool execution unless evidence is supplied.",
  "You may create up to 2 LOW-risk internal follow-up tasks. Publication, production writes, money, credentials, permissions, external messaging or irreversible side effects must require owner approval.",
  "Return ONLY valid JSON with this exact shape:",
  JSON.stringify({message:"concise visible message",status:"DONE|DELEGATE|BLOCKED|WAIT_OWNER",evidence_class:"DERIVED",delegations:[{assigned_agent_ref:"candidate-id",domain:"domain",objective:"specific task",rationale:"why",expected_value:70,priority:600,risk_class:"LOW",requires_owner_approval:false}],owner_question:null})
].filter(Boolean).join("\n\n");}

async function executeAgent(ctx:any,prompt:string){
  const provider=String(ctx.agent?.model?.provider||"").toLowerCase();
  const model=String(ctx.agent?.model?.id||"");
  const failures:string[]=[];
  if(provider==="groq"&&model){
    const key=await runtimeSecretOptional("groq_api_key");
    if(key){
      try{return{text:await callGroq(key,model,prompt),executor:"groq-direct",model};}
      catch(error){failures.push(`groq:${safeError(error)}`);}
    }else failures.push("groq:credential_not_configured");
  }else failures.push(`provider:unsupported_${provider||"missing"}`);

  const n8n=await runtimeSecretOptional("n8n_mcp_token");
  if(n8n){
    try{return{text:await callN8nAgent(n8n,ctx.task.assigned_agent_ref,prompt),executor:"n8n-mcp-fallback",model};}
    catch(error){failures.push(`n8n:${safeError(error)}`);}
  }else failures.push("n8n:credential_not_configured");
  throw new TransportUnavailableError(`transport_unavailable ${failures.join(" | ")}`);
}

async function callGroq(key:string,model:string,prompt:string){
  const response=await fetch(GROQ_CHAT_URL,{method:"POST",headers:{authorization:`Bearer ${key}`,"content-type":"application/json"},body:JSON.stringify({model,messages:[{role:"user",content:prompt}],response_format:{type:"json_object"},reasoning_effort:"low",temperature:0.2,max_completion_tokens:2400})});
  const text=await response.text();let payload:any;try{payload=JSON.parse(text);}catch{throw new Error(`groq_invalid_json_${response.status}`);}
  if(!response.ok)throw new Error(`groq_http_${response.status}_${clean(payload?.error?.message||"request_failed",300)}`);
  const content=payload?.choices?.[0]?.message?.content;if(typeof content!=="string"||!content.trim())throw new Error("groq_empty_response");
  return content.slice(0,14000);
}

async function callN8nAgent(token:string,candidateId:string,prompt:string){
  const {data:row,error}=await db.from("af_agent_candidates").select("n8n_agent_id,name").eq("candidate_id",candidateId).single();if(error)throw error;
  let rpc=1;
  async function mcp(message:any){const r=await fetch(N8N_MCP_URL,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json",accept:"application/json, text/event-stream"},body:JSON.stringify(message)});const text=await r.text();if(/^\s*<!doctype html/i.test(text)||/^\s*<html/i.test(text))throw new Error(`n8n_mcp_html_${r.status}`);const payload=parsePayload(text,r.headers.get("content-type")||"");if(!r.ok||payload?.error)throw new Error(`MCP_${r.status}_${JSON.stringify(payload).slice(0,800)}`);return payload;}
  await mcp({jsonrpc:"2.0",id:rpc++,method:"initialize",params:{protocolVersion:"2025-06-18",capabilities:{},clientInfo:{name:"ai-factory-edge-hot-runtime",version:"1.1.0"}}});
  await mcp({jsonrpc:"2.0",method:"notifications/initialized"});
  let agentId=row.n8n_agent_id;
  if(!agentId){const found=structured(await mcp({jsonrpc:"2.0",id:rpc++,method:"tools/call",params:{name:"search_agents",arguments:{projectId:N8N_PROJECT_ID,query:row.name,limit:20}}}));const rows=Array.isArray(found?.data)?found.data:Array.isArray(found?.agents)?found.agents:[];const exact=rows.filter((x:any)=>x?.name===row.name);if(exact.length!==1)throw new Error(`n8n_agent_resolution_${candidateId}_${exact.length}`);agentId=exact[0].id||exact[0].agentId;}
  const called=structured(await mcp({jsonrpc:"2.0",id:rpc++,method:"tools/call",params:{name:"call_agent",arguments:{agentId,request:{type:"message",message:prompt}}}}));
  const text=strings(called).join("\n").trim();if(!text)throw new Error("empty_agent_response");return text.slice(0,14000);
}

async function createDelegation(ctx:any,parent:any,d:any){
  const assigned=clean(d?.assigned_agent_ref,120);if(!assigned||assigned===parent.assigned_agent_ref)return null;
  const candidate=ctx.candidates.find((x:any)=>x.candidate_id===assigned);if(!candidate||["REJECTED","QUARANTINED"].includes(String(candidate.state)))return null;
  const objective=clean(d?.objective,4000);if(!objective)return null;
  const expected=Math.max(0,Math.min(Number(d?.expected_value)||50,100));if(expected<35)return null;
  const risk=ownerGateText(`${objective}\n${clean(d?.rationale,2000)}`)?"HIGH":new Set(["LOW","MEDIUM","HIGH","ROOT"]).has(String(d?.risk_class||"LOW").toUpperCase())?String(d.risk_class||"LOW").toUpperCase():"HIGH";
  const requires=risk!=="LOW"||ctx.session.initiative_mode!=="AUTO_INTERNAL"||d?.requires_owner_approval===true;
  if(Number(parent.depth)+1>Number(ctx.session.max_task_depth)||Number(ctx.session.auto_task_count)>=Number(ctx.session.max_auto_tasks))return null;
  const fp=await fingerprint(`${parent.session_id}|${assigned}|${objective.toLowerCase()}`);
  const {data,error}=await db.from("af_agent_tasks").insert({session_id:parent.session_id,correlation_id:parent.correlation_id,parent_task_id:parent.id,created_by_agent_ref:parent.assigned_agent_ref,assigned_agent_ref:assigned,domain:clean(d?.domain||"general",120),objective,rationale:clean(d?.rationale,3000),expected_value:expected,risk_class:risk,requires_owner_approval:requires,status:requires?"WAIT_OWNER":"QUEUED",priority:Math.max(0,Math.min(Number(d?.priority)||500,1000)),depth:Number(parent.depth)+1,fingerprint:fp,provenance:{source:"edge-hot-delegation"}}).select("*").single();
  if(error){if(String(error.code)==="23505")return null;throw error;}
  await db.from("af_agent_sessions").update({auto_task_count:Number(ctx.session.auto_task_count)+1,last_activity_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",parent.session_id);
  return data;
}

async function activity(sessionId:string,taskId:string|null,eventType:string,agentRef:string|null,target:string|null,title:string,message:string,metadata:any={}){const {error}=await db.from("af_agent_activity").insert({session_id:sessionId,task_id:taskId,event_type:eventType,agent_ref:agentRef,target_agent_ref:target,title,message:clean(message,6000),metadata:{...metadata,source:"supabase-edge-hot"}});if(error)throw error;}
async function deliverActivity(sessionId:string){const worker=`edge-delivery:${crypto.randomUUID()}`;const {data:rows,error}=await db.rpc("af_claim_agent_activity_for_session",{p_session_id:sessionId,p_worker:worker,p_limit:20});if(error)throw error;for(const row of rows??[]){try{const {data:session,error:sError}=await db.from("af_agent_sessions").select("telegram_chat_id,telegram_thread_id,state").eq("id",row.session_id).single();if(sError)throw sError;const sent=await sendTelegram(Number(session.telegram_chat_id),Number(session.telegram_thread_id),formatActivity(row));const {error:dError}=await db.rpc("af_complete_agent_activity",{p_activity_id:row.id,p_worker:worker,p_telegram_message_id:sent});if(dError)throw dError;}catch(error){await db.rpc("af_fail_agent_activity",{p_activity_id:row.id,p_worker:worker,p_error:{message:safeError(error)}});}}}
function formatActivity(row:any){const emoji:any={TASK_STARTED:"▶️",DELEGATED:"🔁",OWNER_GATE:"🟠",BLOCKER:"🚧",TASK_DONE:"✅",TASK_FAILED:"⚠️",AGENT_MESSAGE:"💬"};return `${emoji[row.event_type]||"💬"} ${row.agent_ref||"AI Factory"}${row.target_agent_ref?` → ${row.target_agent_ref}`:""}\n${row.title?`${row.title}\n`:""}${clean(row.message,5000)}${row.task_id?`\n\nTask: ${row.task_id}`:""}`;}
async function sendTelegram(chatId:number,threadId:number,text:string){const payload:any={chat_id:chatId,text,disable_web_page_preview:true};if(threadId>1)payload.message_thread_id=threadId;const r=await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});const p=await r.json().catch(()=>({}));if(!r.ok||p?.ok!==true)throw new Error(`telegram_${r.status}`);return Number(p?.result?.message_id)||null;}

async function authenticateInternal(req:Request){const supplied=req.headers.get("x-factory-hot-runtime-token")||"";const expected=await runtimeSecret("gi_scheduler_token");if(!supplied||!constantTimeEqual(supplied,expected))throw new Error("auth_invalid_hot_runtime_token");}
async function runtimeSecret(name:string){const {data,error}=await db.rpc("af_get_runtime_secret",{p_name:name});if(error)throw error;return String(data||"");}
async function runtimeSecretOptional(name:string){const {data,error}=await db.rpc("af_get_runtime_secret",{p_name:name});if(error){if(String(error.message||"").includes("runtime_secret_not_configured"))return null;throw error;}const value=String(data||"");return value||null;}
function parsePayload(text:string,type:string){if(!type.includes("text/event-stream"))return JSON.parse(text||"{}");const chunks=text.split(/\r?\n\r?\n/).map(b=>b.split(/\r?\n/).filter(l=>l.startsWith("data:")).map(l=>l.slice(5).trimStart()).join("\n")).filter(Boolean);for(let i=chunks.length-1;i>=0;i--){try{return JSON.parse(chunks[i]);}catch{}}throw new Error("mcp_no_json_payload");}
function structured(p:any){if(p?.result?.structuredContent)return p.result.structuredContent;const t=p?.result?.content?.find?.((x:any)=>x?.type==="text")?.text;if(!t)return null;try{return JSON.parse(t);}catch{return{text:t};}}
function strings(v:any,o:string[]=[]){if(typeof v==="string")o.push(v);else if(Array.isArray(v))v.forEach(x=>strings(x,o));else if(v&&typeof v==="object")Object.values(v).forEach(x=>strings(x,o));return o;}
function extractJson(text:string){const raw=String(text).trim();try{return JSON.parse(raw);}catch{}const fenced=raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];if(fenced){try{return JSON.parse(fenced);}catch{}}const s=raw.indexOf("{"),e=raw.lastIndexOf("}");if(s>=0&&e>s)return JSON.parse(raw.slice(s,e+1));throw new Error("agent_response_not_json");}
function ownerGateText(text:string){return /\b(publish|publication|deploy|production write|prod write|purchase|procure|spend|payment|credential|secret|permission|autonomy|root of trust|delete production|send email|send message externally|external side effect|merge to main)\b/i.test(text);}
async function fingerprint(v:string){const h=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));return [...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,"0")).join("");}
function adminKey(){const modern=Deno.env.get("SUPABASE_SECRET_KEYS");if(modern){try{const p=JSON.parse(modern);if(p?.default)return String(p.default);}catch{}}return mustEnv("SUPABASE_SERVICE_ROLE_KEY");}
function mustEnv(n:string){const v=Deno.env.get(n);if(!v)throw new Error(`missing_env_${n}`);return v;}
function clean(v:any,max=4000){return String(v??"").replace(/[\u0000\r]+/g," ").trim().slice(0,max);}
function uuid(v:any,n:string){const s=String(v??"");if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s))throw new Error(`invalid_${n}`);return s;}
function constantTimeEqual(a:string,b:string){if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0;}
async function safeJson<T>(r:Request){try{return await r.json() as T;}catch{return{} as T;}}
function safeError(e:any){return(e instanceof Error?e.message:String(e)).replace(/[\r\n]+/g," ").slice(0,1200);}
function json(v:any,s=200){return new Response(JSON.stringify(v),{status:s,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});}
