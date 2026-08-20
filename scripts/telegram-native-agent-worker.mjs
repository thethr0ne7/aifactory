import crypto from 'node:crypto';

const endpoint=process.env.N8N_MCP_URL||'https://thethr0ne7.app.n8n.cloud/mcp-server/http';
const token=process.env.N8N_MCP_TOKEN;
const brokerUrl=process.env.FACTORY_TELEGRAM_AGENT_BROKER_URL||'https://hgivyjjethjwswjrvroy.supabase.co/functions/v1/ai-factory-telegram-agent-broker';
const supervisorId='tjPdLV47rjFQFHOV';
const workerId=`telegram-native:${process.env.GITHUB_RUN_ID||crypto.randomUUID()}`;
if(!token)throw new Error('N8N_MCP_TOKEN required');

let oidcCache;
async function oidc(){if(oidcCache)return oidcCache;const base=process.env.ACTIONS_ID_TOKEN_REQUEST_URL,t=process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;if(!base||!t)throw new Error('GitHub OIDC environment unavailable');const u=new URL(base);u.searchParams.set('audience','aifactory-telegram-native-agent');const r=await fetch(u,{headers:{Authorization:`Bearer ${t}`}});const p=await r.json();if(!r.ok||!p?.value)throw new Error(`OIDC token request failed ${r.status}`);oidcCache=p.value;return oidcCache;}
async function broker(action,fields={}){const r=await fetch(brokerUrl,{method:'POST',headers:{authorization:`Bearer ${await oidc()}`,'content-type':'application/json'},body:JSON.stringify({action,worker:workerId,...fields})});const p=await r.json().catch(()=>({}));if(!r.ok||p?.error)throw new Error(`Telegram agent broker ${action} ${r.status}: ${JSON.stringify(p).slice(0,1000)}`);return p;}

function parse(text,type=''){if(!text.trim())return null;if(!type.includes('text/event-stream'))return JSON.parse(text);const chunks=text.split(/\r?\n\r?\n/).map(b=>b.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n')).filter(Boolean);for(let i=chunks.length-1;i>=0;i--){try{return JSON.parse(chunks[i]);}catch{}}throw new Error('No JSON SSE payload');}
async function mcp(message){let last;for(let attempt=1;attempt<=5;attempt++){const r=await fetch(endpoint,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify(message)});const raw=await r.text();if(r.status===429){last=new Error(`MCP 429 ${raw.slice(0,500)}`);await new Promise(x=>setTimeout(x,Math.min(10000,1000*2**(attempt-1))));continue;}const p=parse(raw,r.headers.get('content-type')||'');if(!r.ok||p?.error)throw new Error(`MCP ${r.status}: ${JSON.stringify(p).slice(0,1200)}`);return p;}throw last||new Error('MCP retry exhausted');}
function candidateStrings(v,out=[],key=''){if(typeof v==='string'){const s=v.trim();if(s)out.push({key,text:s});}else if(Array.isArray(v))v.forEach(x=>candidateStrings(x,out,key));else if(v&&typeof v==='object')for(const [k,x] of Object.entries(v))candidateStrings(x,out,k);return out;}
function stripFence(value){const s=String(value||'').trim();const m=s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);return(m?.[1]||s).trim();}
function parseMaybeJson(value){let current=stripFence(value);for(let i=0;i<3;i++){try{const parsed=JSON.parse(current);if(typeof parsed==='string'){current=stripFence(parsed);continue;}return parsed;}catch{return null;}}return null;}
function findTelegramEnvelope(value){if(!value||typeof value!=='object')return null;const posts=value?.output?.telegram_posts||value?.telegram_posts;if(Array.isArray(posts))return posts;if(Array.isArray(value)){for(const item of value){const hit=findTelegramEnvelope(item);if(hit)return hit;}}else{for(const item of Object.values(value)){const hit=findTelegramEnvelope(item);if(hit)return hit;}}return null;}
function inspectAgentResponse(rawPayload){
  const top=[];
  for(const item of rawPayload?.result?.content||[]){if(item?.type==='text'&&typeof item.text==='string')top.push(item.text.trim());}
  const structuredContent=rawPayload?.result?.structuredContent;
  if(structuredContent)top.push(JSON.stringify(structuredContent));
  for(const raw of top){
    const parsed=parseMaybeJson(raw);
    const envelope=findTelegramEnvelope(parsed);
    if(envelope){
      const texts=envelope.map(x=>String(x?.text||'').trim()).filter(Boolean);
      const agents=envelope.map(x=>String(x?.agent||'').trim()).filter(Boolean);
      return{protocolViolation:true,text:texts.join('\n\n').slice(0,12000),claimedAgents:[...new Set(agents)].slice(0,12)};
    }
  }
  const candidates=[];
  for(const raw of top){const parsed=parseMaybeJson(raw);if(parsed)candidateStrings(parsed,candidates);else if(raw)candidates.push({key:'content',text:raw});}
  const preferredKeys=/^(output|response|answer|message|text|content|final|result)$/i;
  const isNoise=(s)=>/^https?:\/\//i.test(s)||/^[A-Za-z0-9_-]{12,40}$/.test(s)||/^(completed|success|ok|running|queued)$/i.test(s);
  const ranked=candidates.filter(x=>!isNoise(x.text)).sort((a,b)=>{const ak=preferredKeys.test(a.key)?1:0,bk=preferredKeys.test(b.key)?1:0;if(ak!==bk)return bk-ak;return b.text.length-a.text.length;});
  let text=ranked[0]?.text||'';
  text=text.replace(/^completed\s*/i,'').replace(/^success\s*/i,'').trim();
  return{protocolViolation:false,text:text.slice(0,12000),claimedAgents:[]};
}
function providerFailure(text){return /execution_failed|AI_APICallError|rate limit reached|too many requests|insufficient quota|service unavailable|MCP 429/i.test(String(text));}
function retrySeconds(text){const m=String(text).match(/try again in\s+(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?/i);return Math.max(30,Math.min(600,Math.ceil((Number(m?.[1])||0)*60+(Number(m?.[2])||0)+30)||60));}
function compactContext(input){const rows=input?.telegram?.thread_context;if(!Array.isArray(rows))return'';return rows.slice(-4).map(x=>`USER: ${String(x?.user_message||'').slice(0,700)}\nFACTORY: ${String(x?.assistant_response||'').slice(0,900)}`).join('\n\n');}

await mcp({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'ai-factory-telegram-native-worker',version:'1.2.1'}}});await mcp({jsonrpc:'2.0',method:'notifications/initialized'});let rpcId=2;async function toolRaw(name,args={}){return mcp({jsonrpc:'2.0',id:rpcId++,method:'tools/call',params:{name,arguments:args}});}

await broker('recover').catch(()=>null);
const claimed=await broker('claim');
if(!claimed?.task){console.log('TELEGRAM_NATIVE_AGENT_IDLE');process.exit(0);}
const task=claimed.task,run=claimed.run;
const objective=String(run?.objective||task?.objective||'').trim();
const input=run?.input||{};
const context=compactContext(input);
const chat=input?.telegram?.chat_id??'unknown',thread=input?.telegram?.thread_id??1;
const sessionId=`telegram-${String(chat).replace(/[^0-9-]/g,'')}-${String(thread).replace(/[^0-9]/g,'')}`;
const groundingRules=[
  'Верни только обычный пользовательский текст. Никакого JSON, YAML, XML, code fence, telegram_posts, поля agent или внутреннего runtime-конверта.',
  'Не придумывай имена людей, сотрудников, отделы, SOC-команды, владельцев задач, расписания, дедлайны, встречи, бюджет, ресурсы, назначения или уже выполненные действия. Такие факты допустимы только если они прямо есть в сообщении пользователя/контексте либо реально получены от вызванного native subAgent/tool.',
  'Не выдавай себя за CEO/CFO/COO/CIO/CMO/CRO и не приписывай им реплики. Ты Nursery Supervisor. Если конкретный subAgent реально был вызван, можешь кратко назвать его фактическую специализацию, но не выдумывай участие.',
  'Если данных для фактического утверждения нет, прямо скажи, что это неизвестно или не проверено. Не заменяй неизвестность правдоподобной выдумкой.',
  'Не обещай развертывание, закрытие инцидентов, найм, оплату или другие внешние действия, если они реально не выполнены доступным инструментом.',
];
const prompt=[
  'Ты — главный координатор AI Factory в Telegram HQ.',
  'Отвечай пользователю по существу на русском языке, если он пишет по-русски.',
  'Используй своих native subAgents, когда это реально улучшает ответ. Для сложной задачи делегируй релевантным G1-лидам и синтезируй их результаты; не имитируй работу агента, которого фактически не вызывал.',
  'Не выдумывай выполненные действия, источники, проверки или полномочия. Не раскрывай секреты. Root of Trust не изменяется.',
  ...groundingRules,
  context?`Контекст темы:\n${context}`:'',
  `Новое сообщение пользователя:\n${objective}`
].filter(Boolean).join('\n\n');

try{
  await broker('touch',{task_id:task.id}).catch(()=>null);
  let rawResponse=await toolRaw('call_agent',{agentId:supervisorId,request:{type:'message',message:prompt,sessionId}});
  let inspected=inspectAgentResponse(rawResponse);
  if(inspected.protocolViolation){
    const correction=[
      'Предыдущий ответ нарушил Telegram-протокол: был возвращён внутренний JSON/telegram_posts и неподтверждённые роли.',
      'Перепиши ответ заново одним обычным текстом для пользователя.',
      'Удаляй любые выдуманные имена, должности, владельцев, расписания, ресурсные запросы и действия, которых нет во входном контексте и которые не были реально выполнены.',
      'Не используй JSON и не указывай поле agent.',
      `Исходный запрос пользователя: ${objective}`
    ].join('\n');
    rawResponse=await toolRaw('call_agent',{agentId:supervisorId,request:{type:'message',message:correction,sessionId}});
    inspected=inspectAgentResponse(rawResponse);
  }
  const text=inspected.text;
  if(inspected.protocolViolation)throw new Error(`agent_output_protocol_violation claimed_agents=${inspected.claimedAgents.join(',')||'unknown'}`);
  if(!text||providerFailure(text))throw new Error(text||'empty_agent_response');
  const result={
    decision:'Native n8n agent network completed Telegram turn.',
    evidence:[{class:'OBSERVED',claim:'Response produced by AI Factory Nursery Supervisor through n8n Agent runtime.'}],
    output:{telegram_posts:[{agent:'nursery-supervisor-g0',text}]},
    next_action:'Await the next Telegram HQ message.',
    risks:[],tool_requests:[],
    telegram_runtime:{transport:'n8n-native-agent',subagents_available:true,session_id:sessionId,output_protocol:'plain-text-v2'}
  };
  const finished=await broker('finish',{task_id:task.id,status:'COMPLETE',result,activated_agents:['nursery-supervisor-g0'],selected_skills:[]});
  console.log(`TELEGRAM_NATIVE_AGENT_COMPLETE task=${task.id} run=${finished.run_id} delivery=${finished?.delivery?.state||'unknown'} chars=${text.length}`);
}catch(error){
  const message=error instanceof Error?error.message:String(error);
  const retry=await broker('retry',{task_id:task.id,retry_seconds:retrySeconds(message),result:{error:'native_agent_turn_failed',summary:message.slice(0,900)}}).catch(e=>({status:'BROKER_RETRY_FAILED',error:String(e)}));
  console.error(`TELEGRAM_NATIVE_AGENT_RETRY task=${task.id} status=${retry.status} error=${message.slice(0,700)}`);
  if(retry.status==='BROKER_RETRY_FAILED')process.exitCode=1;
}
