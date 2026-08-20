import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "npm:jose@6";

type Claims = JWTPayload & { repository?: string; repository_id?: string; ref?: string; event_name?: string; workflow_ref?: string; job_workflow_ref?: string; run_id?: string };
type Body = { action?: string; worker?: string; task_id?: string; status?: string; result?: Record<string,unknown>; activated_agents?: string[]; selected_skills?: string[]; retry_seconds?: number };

const SUPABASE_URL = mustEnv("SUPABASE_URL");
const BOT_TOKEN = mustEnv("TELEGRAM_BOT_TOKEN");
const db = createClient(SUPABASE_URL, adminKey(), { auth: { persistSession:false, autoRefreshToken:false } });
const ISSUER = "https://token.actions.githubusercontent.com";
const AUDIENCE = "aifactory-telegram-native-agent";
const EXPECTED_REPOSITORY = "thethr0ne7/aifactory";
const EXPECTED_REPOSITORY_ID = "1334997374";
const EXPECTED_REF = "refs/heads/main";
const EXPECTED_WORKFLOW = "thethr0ne7/aifactory/.github/workflows/telegram-hq-fast-agent.yml@refs/heads/main";
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks`));

Deno.serve(async (request:Request) => {
  if (request.method !== "POST") return json({error:"method_not_allowed"},405);
  try {
    const claims = await authenticate(request);
    const body = await safeJson<Body>(request);
    const action = clean(body.action,40);
    const worker = clean(body.worker || `telegram-fast:${claims.run_id ?? "unknown"}`,200);

    if (action === "recover") {
      const {data,error}=await db.rpc("af_recover_stale",{p_stale_minutes:5});
      if(error)throw error;
      return json({recovered:data??0});
    }
    if (action === "claim") {
      const {data,error}=await db.rpc("af_claim_telegram_task",{p_worker_id:worker});
      if(error)throw error;
      const task=Array.isArray(data)?data[0]??null:data??null;
      if(!task)return json({task:null,run:null});
      const {data:run,error:runError}=await db.from("af_runs").select("id,objective,input,autonomy_level,status,created_at,updated_at").eq("id",task.run_id).single();
      if(runError)throw runError;
      return json({task,run});
    }
    if (action === "touch") {
      const id=uuid(body.task_id,"task_id");
      const {data:task,error:qError}=await db.from("af_tasks").select("run_id").eq("id",id).eq("status","WORKING").eq("locked_by",worker).maybeSingle();
      if(qError)throw qError;
      if(!task)return json({touched:false});
      const {error}=await db.rpc("af_touch_run",{p_run_id:task.run_id}); if(error)throw error;
      return json({touched:true});
    }
    if (action === "retry") {
      const id=uuid(body.task_id,"task_id");
      const seconds=Math.max(10,Math.min(Number(body.retry_seconds)||30,900));
      const {data:task,error:qError}=await db.from("af_tasks").select("id,run_id,attempts,max_attempts").eq("id",id).eq("status","WORKING").eq("locked_by",worker).maybeSingle();
      if(qError)throw qError;
      if(!task)return json({status:"NOT_OWNED"});
      if(Number(task.attempts)>=Number(task.max_attempts)) {
        const result={error:"telegram_native_agent_retry_budget_exhausted",detail:objectOrEmpty(body.result),output:{telegram_posts:[{agent:"nursery-supervisor-g0",text:"Не удалось получить ответ от агентной сети после ограниченного числа попыток. Ошибка сохранена; повторите сообщение."}]}};
        const {error}=await db.rpc("af_finish_task",{p_task_id:id,p_status:"FAILED",p_result:result,p_activated_agents:["nursery-supervisor-g0"],p_selected_skills:[]});
        if(error)throw error;
        await deliverByRun(task.run_id);
        return json({status:"FAILED"});
      }
      const available=new Date(Date.now()+seconds*1000).toISOString();
      const {error}=await db.from("af_tasks").update({status:"QUEUED",available_at:available,locked_at:null,locked_by:null,updated_at:new Date().toISOString(),result:objectOrEmpty(body.result)}).eq("id",id).eq("status","WORKING").eq("locked_by",worker);
      if(error)throw error;
      return json({status:"QUEUED",available_at:available});
    }
    if (action === "finish") {
      const id=uuid(body.task_id,"task_id");
      const status=clean(body.status||"COMPLETE",16);
      if(!new Set(["COMPLETE","BLOCKED","FAILED"]).has(status))return json({error:"invalid_status"},400);
      const agents=uniqueStrings(body.activated_agents,6,120);
      const skills=uniqueStrings(body.selected_skills,20,160);
      const {data:runId,error}=await db.rpc("af_finish_task",{p_task_id:id,p_status:status,p_result:objectOrEmpty(body.result),p_activated_agents:agents,p_selected_skills:skills});
      if(error)throw error;
      const delivery=await deliverByRun(runId);
      return json({run_id:runId,status,delivery});
    }
    if (action === "deliver") {
      const id=uuid(body.task_id,"task_id");
      const {data:task,error}=await db.from("af_tasks").select("run_id").eq("id",id).maybeSingle(); if(error)throw error;
      return json({delivery:task?await deliverByRun(task.run_id):{state:"TASK_NOT_FOUND"}});
    }
    return json({error:"unsupported_action"},400);
  } catch(error) {
    console.error(JSON.stringify({event:"telegram_native_agent_broker_error",error:safeError(error)}));
    const unauthorized=safeError(error).startsWith("oidc_");
    return json({error:unauthorized?"unauthorized":"broker_error",detail:safeError(error)},unauthorized?401:500);
  }
});

async function deliverByRun(runId:string){
  const {data:message,error:mError}=await db.from("af_telegram_messages").select("update_id,telegram_chat_id,telegram_thread_id,telegram_message_id,status,delivery_attempts").eq("run_id",runId).eq("status","QUEUED").maybeSingle();
  if(mError)throw mError;
  if(!message)return {state:"NO_QUEUED_MESSAGE"};
  const {data:claimed,error:cError}=await db.from("af_telegram_messages").update({status:"SENDING",delivery_attempts:Number(message.delivery_attempts||0)+1,last_delivery_attempt_at:new Date().toISOString()}).eq("update_id",message.update_id).eq("status","QUEUED").select("update_id").maybeSingle();
  if(cError)throw cError;
  if(!claimed)return {state:"ALREADY_CLAIMED"};
  try {
    const {data:run,error:rError}=await db.from("af_runs").select("status,output").eq("id",runId).single(); if(rError)throw rError;
    const posts=extractPosts(run.output,run.status);
    let count=0;
    for(const post of posts.slice(0,6)){
      const label=post.agent?`🤖 ${post.agent}\n\n`:"";
      for(const chunk of splitText(`${label}${post.text}`,3800)){
        await telegram("sendMessage",{chat_id:message.telegram_chat_id,message_thread_id:message.telegram_thread_id||undefined,text:chunk,disable_web_page_preview:true,reply_parameters:count===0?{message_id:message.telegram_message_id,allow_sending_without_reply:true}:undefined});
        count+=1;
      }
    }
    await db.from("af_telegram_messages").update({status:"DELIVERED",delivered_at:new Date().toISOString(),delivered_post_count:count,delivery_error:null}).eq("update_id",message.update_id).eq("status","SENDING");
    return {state:"DELIVERED",posts:count};
  }catch(error){
    await db.from("af_telegram_messages").update({status:"QUEUED",delivery_error:{summary:safeError(error)},last_delivery_attempt_at:new Date().toISOString()}).eq("update_id",message.update_id).eq("status","SENDING");
    throw error;
  }
}
function extractPosts(output:unknown,status:string){
  const o=objectOrEmpty(output); const nested=objectOrEmpty(o.output); const raw=Array.isArray(nested.telegram_posts)?nested.telegram_posts:[];
  const posts=raw.map((x:any)=>({agent:clean(x?.agent,120),text:clean(x?.text,12000)})).filter((x)=>x.text);
  if(posts.length)return posts;
  const fallback=clean(o.decision||o.next_action||o.error||`AI Factory run ${status}`,12000);
  return [{agent:"nursery-supervisor-g0",text:fallback}];
}
async function telegram(method:string,payload:Record<string,unknown>){const r=await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});const body=await r.json().catch(()=>({}));if(!r.ok||body?.ok!==true)throw new Error(`telegram_${method}_${r.status}`);return body;}
function splitText(text:string,max:number){const out=[];let rest=text.trim();while(rest.length>max){let cut=rest.lastIndexOf("\n",max);if(cut<Math.floor(max*.6))cut=rest.lastIndexOf(" ",max);if(cut<Math.floor(max*.6))cut=max;out.push(rest.slice(0,cut).trim());rest=rest.slice(cut).trim();}if(rest)out.push(rest);return out;}
async function authenticate(request:Request):Promise<Claims>{const token=(request.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1];if(!token)throw new Error("oidc_missing_bearer");const{payload}=await jwtVerify(token,JWKS,{issuer:ISSUER,audience:AUDIENCE,algorithms:["RS256"],clockTolerance:10});const c=payload as Claims;if(c.repository!==EXPECTED_REPOSITORY||c.repository_id!==EXPECTED_REPOSITORY_ID)throw new Error("oidc_repository_mismatch");if(c.ref!==EXPECTED_REF)throw new Error("oidc_ref_mismatch");const workflow=String(c.job_workflow_ref??c.workflow_ref??"");if(workflow!==EXPECTED_WORKFLOW)throw new Error("oidc_workflow_mismatch");if(!new Set(["schedule","workflow_dispatch","push"]).has(String(c.event_name||"")))throw new Error("oidc_event_mismatch");return c;}
function adminKey(){const keys=Deno.env.get("SUPABASE_SECRET_KEYS");if(keys){try{const p=JSON.parse(keys);if(p.default)return String(p.default);}catch{}}return mustEnv("SUPABASE_SERVICE_ROLE_KEY");}
function mustEnv(n:string){const v=Deno.env.get(n);if(!v)throw new Error(`missing_env_${n}`);return v;}function clean(v:unknown,max:number){return String(v??"").replace(/[\u0000\r]+/g," ").trim().slice(0,max);}function objectOrEmpty(v:unknown){return v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,any>:{};}function uniqueStrings(v:unknown,maxItems:number,maxLen:number){return Array.isArray(v)?[...new Set(v.map((x)=>clean(x,maxLen)).filter(Boolean))].slice(0,maxItems):[];}function uuid(v:unknown,n:string){const s=String(v??"");if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s))throw new Error(`invalid_${n}`);return s;}async function safeJson<T>(r:Request){try{return await r.json() as T;}catch{return{} as T;}}function safeError(e:unknown){return(e instanceof Error?e.message:String(e)).replace(/[\r\n]+/g," ").slice(0,1200);}function json(p:unknown,s=200){return new Response(JSON.stringify(p),{status:s,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});}
