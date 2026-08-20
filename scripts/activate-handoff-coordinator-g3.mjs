import fs from 'node:fs/promises';
const endpoint=process.env.N8N_MCP_URL||'https://thethr0ne7.app.n8n.cloud/mcp-server/http';
const token=process.env.N8N_MCP_TOKEN;
const projectId='FP3HOvN6NpEDN0PB';
const childName='AI Factory Handoff Coordinator G3';
if(!token)throw new Error('N8N_MCP_TOKEN required');
const parents=[
  ['AI Factory Research Scout G1','Use this child to preserve cross-cell correlation, evidence refs, constraints and expected outputs.'],
  ['AI Factory Evidence Apprentice G1','Use this child to preserve verified handoff context and provenance across cells.'],
  ['AI Factory Builder Apprentice G1','Use this child to carry bounded implementation context and blockers across cells.'],
  ['AI Factory Auditor Apprentice G1','Use this child to preserve audit gates, evidence refs and unresolved blockers across cells.'],
];
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
function parse(text,type=''){if(!text.trim())return null;if(!type.includes('text/event-stream'))return JSON.parse(text);const chunks=text.split(/\r?\n\r?\n/).map(b=>b.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n')).filter(Boolean);for(let i=chunks.length-1;i>=0;i--){try{return JSON.parse(chunks[i]);}catch{}}throw new Error('No JSON SSE payload');}
async function req(msg){for(let a=1;a<=6;a++){const r=await fetch(endpoint,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify(msg)});const raw=await r.text();if(r.status===429){await sleep(Math.min(12000,1000*2**(a-1)));continue;}const p=parse(raw,r.headers.get('content-type')||'');if(!r.ok||p?.error)throw new Error(`MCP ${r.status}: ${JSON.stringify(p).slice(0,1200)}`);await sleep(250);return p;}throw new Error('MCP retry exhausted');}
function structured(p){if(p?.result?.structuredContent)return p.result.structuredContent;const t=p?.result?.content?.find?.(x=>x?.type==='text')?.text;if(!t)return null;try{return JSON.parse(t);}catch{return{text:t};}}
await req({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'ai-factory-g3-activation',version:'1.0.0'}}});await req({jsonrpc:'2.0',method:'notifications/initialized'});let id=2;async function tool(name,args={}){return structured(await req({jsonrpc:'2.0',id:id++,method:'tools/call',params:{name,arguments:args}}));}
async function exact(name){const p=await tool('search_agents',{projectId,query:name,limit:50});const rows=Array.isArray(p?.data)?p.data:(Array.isArray(p?.agents)?p.agents:[]),x=rows.filter(r=>r?.name===name);if(x.length!==1)throw new Error(`Expected one ${name}; got ${x.length}`);return{id:x[0].id||x[0].agentId,name};}
async function validate(agent){const v=await tool('validate_agent',{agentId:agent.id});if(v?.valid!==true)throw new Error(`Invalid agent ${agent.name}: ${JSON.stringify(v).slice(0,800)}`);}
async function publish(agent){await validate(agent);await tool('publish_agent',{agentId:agent.id});}
const child=await exact(childName);await publish(child);
const graph=[];
for(const [parentName,useWhen] of parents){const parent=await exact(parentName);const before=await tool('get_agent',{agentId:parent.id});if(!before?.configHash||!before?.config)throw new Error(`Missing config ${parentName}`);const next=structuredClone(before.config);const existing=Array.isArray(next?.subAgents?.agents)?next.subAgents.agents:[];const filtered=existing.filter(x=>x?.agentId!==child.id);filtered.push({agentId:child.id,useWhen});next.subAgents={maxChildren:Math.min(20,Math.max(filtered.length,Number(next?.subAgents?.maxChildren)||4)),agents:filtered};await tool('mutate_agent',{agentId:parent.id,baseConfigHash:before.configHash,operation:{type:'config.replace',config:next}});const after=await tool('get_agent',{agentId:parent.id});const actual=after?.config?.subAgents?.agents||[];if(!actual.some(x=>x?.agentId===child.id))throw new Error(`G3 did not persist under ${parentName}`);await publish(parent);graph.push({parent:parentName,parent_id:parent.id,child_id:child.id,child_count:actual.length});}
const published=await tool('search_agents',{projectId,publishedOnly:true,query:childName,limit:50});const rows=Array.isArray(published?.data)?published.data:(Array.isArray(published?.agents)?published.agents:[]);if(!rows.some(r=>(r?.id||r?.agentId)===child.id))throw new Error('G3 child not visible as published');
const result={checked_at:new Date().toISOString(),child:{name:childName,agent_id:child.id,published:true,autonomy:'A2',production_write_authority:false},native_parent_edges:graph.length,parents:graph,external_publication:false,root_of_trust_mutation_attempted:false};await fs.mkdir('artifacts',{recursive:true});await fs.writeFile('artifacts/handoff-coordinator-g3-activation.json',JSON.stringify(result,null,2)+'\n');console.log(`G3_NATIVE_ACTIVATION_OK child=${child.id} published=true parents=${graph.length}`);
