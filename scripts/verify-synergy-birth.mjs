import fs from 'node:fs/promises';
const brokerUrl=process.env.FACTORY_BUS_BROKER_URL||'https://hgivyjjethjwswjrvroy.supabase.co/functions/v1/ai-factory-agent-bus';
const correlationId=process.env.FACTORY_SYNERGY_CORRELATION_ID||'a1f4c7e0-2026-4820-8420-000000000001';
let token;
async function oidc(){if(token)return token;const u=process.env.ACTIONS_ID_TOKEN_REQUEST_URL,t=process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;if(!u||!t)throw new Error('GitHub OIDC environment unavailable');const url=new URL(u);url.searchParams.set('audience','aifactory-agent-bus');const r=await fetch(url,{headers:{Authorization:`Bearer ${t}`}}),p=await r.json();if(!r.ok||!p?.value)throw new Error(`OIDC token request failed ${r.status}`);token=p.value;return token;}
async function broker(action,fields={}){const r=await fetch(brokerUrl,{method:'POST',headers:{authorization:`Bearer ${await oidc()}`,'content-type':'application/json'},body:JSON.stringify({action,...fields})});const p=await r.json().catch(()=>({}));if(!r.ok||p?.error)throw new Error(`Agent bus broker ${action} ${r.status}: ${JSON.stringify(p).slice(0,1000)}`);return p;}
function responseText(row){return String(row?.payload?.response||row?.claim||'').trim();}
function providerFailure(text){return /execution_failed|AI_APICallError|rate limit reached|too many requests|insufficient quota|provider.*timeout|service unavailable/i.test(String(text||''));}
const ctx=await broker('read_correlation',{correlation_id:correlationId});
const messages=ctx.messages||[],evidence=ctx.evidence||[],handoffs=ctx.handoffs||[],births=ctx.births||[];
const validEvidence=evidence.filter((x)=>!providerFailure(responseText(x)));
const childResult=await broker('get_candidate',{candidate_id:'handoff-coordinator-g3'}),child=childResult.candidate;
const requiredStages=['RESEARCH','EVIDENCE','BUILD','AUDIT','BIRTH'];
for(const stage of requiredStages)if(!messages.some((x)=>x.stage===stage&&x.status==='DELIVERED'))throw new Error(`Missing delivered ${stage} message`);
for(const [from,to] of [['RESEARCH','EVIDENCE'],['EVIDENCE','BUILD'],['BUILD','AUDIT'],['AUDIT','BIRTH']])if(!handoffs.some((x)=>x.from_stage===from&&x.to_stage===to&&x.gate_status==='PASS'))throw new Error(`Missing PASS handoff ${from}→${to}`);
const producers=new Set(validEvidence.map((x)=>x.producer_agent_ref));
const routing=JSON.parse(await fs.readFile('registry/agent-routing.json','utf8'));
const expectedOperational=Object.values(routing.cells).flatMap((cell)=>[cell.lead.candidateId,...cell.specialists.map((x)=>x.candidateId)]);
for(const id of expectedOperational)if(!producers.has(id))throw new Error(`Operational agent has no valid non-provider-error evidence: ${id}`);
for(const cell of Object.values(routing.cells)){
  const stage=Object.entries(routing.cells).find(([,v])=>v===cell)?.[0];
  const leadRows=validEvidence.filter((x)=>x.stage===stage&&x.producer_agent_ref===cell.lead.candidateId);
  if(!leadRows.some((x)=>responseText(x).includes(`${stage}_GATE=PASS`)))throw new Error(`Missing valid ${stage}_GATE=PASS lead evidence`);
}
if(!births.length||births[0].status!=='SPAWNED'||!births[0].n8n_agent_id)throw new Error('Audited synergy birth not SPAWNED');
if(births[0].production_authority_granted!==false||births[0].publication_attempted!==false)throw new Error('Synergy birth crossed authority/publication boundary');
if(!child||child.state!=='SPAWNED'||child.autonomy_level!=='A2'||child.generation!==3)throw new Error('Synergy child candidate state invalid');
if(!Array.isArray(child.tools)||child.tools.length!==0)throw new Error('Synergy child must start with zero tools');
const result={checked_at:new Date().toISOString(),correlation_id:correlationId,delivered_stages:requiredStages,pass_handoffs:handoffs.filter((x)=>x.gate_status==='PASS').length,valid_evidence_producers:producers.size,provider_failure_rows:evidence.length-validEvidence.length,expected_operational_contributors:expectedOperational.length,child:{candidate_id:child.candidate_id,name:child.name,generation:child.generation,role:child.role,state:child.state,autonomy_level:child.autonomy_level},production_authority_granted:false,publication_attempted:false};
await fs.mkdir('artifacts',{recursive:true});await fs.writeFile('artifacts/synergy-birth.json',JSON.stringify(result,null,2)+'\n');
console.log(`SYNERGY_BIRTH_OK stages=${requiredStages.length} handoffs=4 valid_contributors=${producers.size} child=${child.candidate_id}`);
