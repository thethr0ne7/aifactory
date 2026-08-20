import fs from 'node:fs/promises';

const endpoint=process.env.N8N_MCP_URL||'https://thethr0ne7.app.n8n.cloud/mcp-server/http';
const token=process.env.N8N_MCP_TOKEN;
const projectId='FP3HOvN6NpEDN0PB';
const targetModel='groq/openai/gpt-oss-20b';
if(!token)throw new Error('N8N_MCP_TOKEN required');
const routing=JSON.parse(await fs.readFile('registry/agent-routing.json','utf8'));

function parse(text,type=''){if(!text.trim())return null;if(!type.includes('text/event-stream'))return JSON.parse(text);const chunks=text.split(/\r?\n\r?\n/).map(b=>b.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n')).filter(Boolean);for(let i=chunks.length-1;i>=0;i--){try{return JSON.parse(chunks[i]);}catch{}}throw new Error('No JSON SSE payload');}
async function request(message){const r=await fetch(endpoint,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify(message)});const p=parse(await r.text(),r.headers.get('content-type')||'');if(!r.ok||p?.error)throw new Error(`MCP ${r.status}: ${JSON.stringify(p).slice(0,1200)}`);return p;}
function structured(p){if(p?.result?.structuredContent)return p.result.structuredContent;const text=p?.result?.content?.find?.(x=>x?.type==='text')?.text;if(!text)return null;try{return JSON.parse(text);}catch{return{text};}}
await request({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'ai-factory-operational-model-pool',version:'1.0.0'}}});await request({jsonrpc:'2.0',method:'notifications/initialized'});let id=2;async function tool(name,args={}){return structured(await request({jsonrpc:'2.0',id:id++,method:'tools/call',params:{name,arguments:args}}));}
const members=Object.values(routing.cells).flatMap(cell=>[cell.lead,...cell.specialists]);
if(members.length!==20||new Set(members.map(x=>x.candidateId)).size!==20)throw new Error(`Expected 20 unique operational members; got ${members.length}`);
const results=[];
for(const member of members){
  const search=await tool('search_agents',{projectId,query:member.name,limit:50});const rows=Array.isArray(search?.data)?search.data:(Array.isArray(search?.agents)?search.agents:[]);const exact=rows.filter(r=>r?.name===member.name);if(exact.length!==1)throw new Error(`Expected one ${member.name}; got ${exact.length}`);const agentId=exact[0].id||exact[0].agentId;
  const before=await tool('get_agent',{agentId});if(!before?.configHash||!before?.config)throw new Error(`Missing config for ${member.name}`);const current=before.config.model;let changed=false;
  if(current!==targetModel){await tool('mutate_agent',{agentId,baseConfigHash:before.configHash,operation:{type:'config.patch',patch:[{op:current?'replace':'add',path:'/model',value:targetModel}]}});changed=true;}
  const after=await tool('get_agent',{agentId});const validation=await tool('validate_agent',{agentId});if(after?.config?.model!==targetModel||validation?.valid!==true)throw new Error(`Model pool validation failed ${member.name}`);
  results.push({candidate_id:member.candidateId,agent_id:agentId,model:targetModel,changed,valid:true});
}
await fs.mkdir('artifacts',{recursive:true});await fs.writeFile('artifacts/operational-model-pool.json',JSON.stringify({checked_at:new Date().toISOString(),target_model:targetModel,count:results.length,results,publication_attempted:false},null,2)+'\n');
console.log(`OPERATIONAL_MODEL_POOL_OK count=${results.length} model=${targetModel} valid=${results.every(x=>x.valid)} publication_attempted=false`);
