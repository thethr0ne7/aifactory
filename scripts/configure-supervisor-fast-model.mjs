import fs from 'node:fs/promises';
const endpoint=process.env.N8N_MCP_URL||'https://thethr0ne7.app.n8n.cloud/mcp-server/http';
const token=process.env.N8N_MCP_TOKEN;
const agentId='tjPdLV47rjFQFHOV';
const targetModel='groq/openai/gpt-oss-20b';
const targetInstructions=[
  'You are AI Factory Nursery Supervisor, a bounded A3 coordinator over the persistent native n8n specialist network.',
  'Use attached native subAgents when delegation materially improves the answer. Never pretend a subAgent ran if it did not.',
  'Never invent people, employee names, departments, SOC teams, task owners, schedules, deadlines, meetings, resource allocations, approvals, incidents, budgets, deployments, or completed actions. Such claims require explicit user/context evidence or an actual tool/subAgent result from this turn.',
  'Never impersonate CEO, CFO, COO, CIO, CMO, CRO or attribute statements to them unless the caller explicitly asks for those roles and the corresponding real agent was actually invoked.',
  'Preserve evidence classes and uncertainty. Missing evidence means UNKNOWN/BLOCKER, not a plausible story.',
  'Root of Trust is immutable. Never self-promote, expand autonomy, production writes, secret scope, publication authority, or security authority.',
  'For Telegram HQ requests, return one plain user-facing answer only. Do not emit JSON, YAML, XML, markdown code fences, telegram_posts, agent fields, internal envelopes, chain-of-thought, or synthetic meeting minutes.',
  'Do not promise external actions unless an available tool actually completed them. If an action was not executed, say so explicitly.',
  'Prefer concise Russian when the user writes in Russian.'
].join(' ');
if(!token)throw new Error('N8N_MCP_TOKEN required');
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
function parse(text,type=''){if(!text.trim())return null;if(!type.includes('text/event-stream'))return JSON.parse(text);const chunks=text.split(/\r?\n\r?\n/).map(b=>b.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n')).filter(Boolean);for(let i=chunks.length-1;i>=0;i--){try{return JSON.parse(chunks[i]);}catch{}}throw new Error('No JSON SSE payload');}
async function req(msg){for(let a=1;a<=6;a++){const r=await fetch(endpoint,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify(msg)});const raw=await r.text();if(r.status===429){await sleep(Math.min(12000,1000*2**(a-1)));continue;}const p=parse(raw,r.headers.get('content-type')||'');if(!r.ok||p?.error)throw new Error(`MCP ${r.status}: ${JSON.stringify(p).slice(0,1000)}`);await sleep(300);return p;}throw new Error('MCP retry exhausted');}
function structured(p){if(p?.result?.structuredContent)return p.result.structuredContent;const t=p?.result?.content?.find?.(x=>x?.type==='text')?.text;if(!t)return null;try{return JSON.parse(t);}catch{return{text:t};}}
await req({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'ai-factory-supervisor-grounding',version:'1.1.0'}}});await req({jsonrpc:'2.0',method:'notifications/initialized'});let id=2;async function tool(name,args={}){return structured(await req({jsonrpc:'2.0',id:id++,method:'tools/call',params:{name,arguments:args}}));}
const before=await tool('get_agent',{agentId});
if(!before?.configHash||!before?.config)throw new Error('Supervisor config unavailable');
const patch=[];
if(before.config.model!==targetModel)patch.push({op:before.config.model?'replace':'add',path:'/model',value:targetModel});
if(before.config.instructions!==targetInstructions)patch.push({op:before.config.instructions?'replace':'add',path:'/instructions',value:targetInstructions});
let changed=false;
if(patch.length){await tool('mutate_agent',{agentId,baseConfigHash:before.configHash,operation:{type:'config.patch',patch}});changed=true;}
const after=await tool('get_agent',{agentId});
const validation=await tool('validate_agent',{agentId});
if(after?.config?.model!==targetModel||after?.config?.instructions!==targetInstructions||validation?.valid!==true)throw new Error('Supervisor grounding validation failed');
await fs.mkdir('artifacts',{recursive:true});
await fs.writeFile('artifacts/supervisor-fast-model.json',JSON.stringify({checked_at:new Date().toISOString(),agent_id:agentId,model:targetModel,instructions_contract:'grounded-telegram-plain-text-v2',changed,valid:true,publication_attempted:false},null,2)+'\n');
console.log(`SUPERVISOR_GROUNDING_OK model=${targetModel} changed=${changed} valid=true`);
