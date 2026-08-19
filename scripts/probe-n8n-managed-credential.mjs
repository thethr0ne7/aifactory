const endpoint = process.env.N8N_MCP_URL || 'https://thethr0ne7.app.n8n.cloud/mcp-server/http';
const token = process.env.N8N_MCP_TOKEN;
const agentId = 'tjPdLV47rjFQFHOV';
if (!token) throw new Error('N8N_MCP_TOKEN is required');
function parse(t,ct=''){if(ct.includes('text/event-stream')){for(const b of t.split(/\r?\n\r?\n/).reverse()){const s=b.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(s)try{return JSON.parse(s)}catch{}}throw new Error('No SSE JSON')}return JSON.parse(t)}
async function req(m){const r=await fetch(endpoint,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify(m)});const p=parse(await r.text(),r.headers.get('content-type')||'');if(!r.ok||p?.error)throw new Error(JSON.stringify(p).slice(0,1000));return p}
function s(p){return p?.result?.structuredContent||JSON.parse(p?.result?.content?.find?.(x=>x.type==='text')?.text||'null')}
function find(v,k){if(!v||typeof v!=='object')return null;if(Object.prototype.hasOwnProperty.call(v,k)&&v[k]!=null)return v[k];for(const c of Array.isArray(v)?v:Object.values(v)){const x=find(c,k);if(x!=null)return x}return null}
await req({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'ai-factory-managed-credential-probe',version:'2.4.0'}}});await req({jsonrpc:'2.0',method:'notifications/initialized'});let id=2;const tool=(name,args={})=>req({jsonrpc:'2.0',id:id++,method:'tools/call',params:{name,arguments:args}});
let a=s(await tool('get_agent',{agentId}));let h=find(a,'configHash');if(!h)throw new Error('configHash missing');
const beforeCredential=find(a,'credential');let kept=false;let probeResult=null;
if(!beforeCredential){
  s(await tool('mutate_agent',{agentId,baseConfigHash:h,operation:{type:'config.patch',patch:[{op:'add',path:'/credential',value:'managed'}]}}));
  probeResult=s(await tool('validate_agent',{agentId}));
  if(probeResult?.valid===true){kept=true}else{
    a=s(await tool('get_agent',{agentId}));h=find(a,'configHash');
    s(await tool('mutate_agent',{agentId,baseConfigHash:h,operation:{type:'config.patch',patch:[{op:'remove',path:'/credential'}]}}));
  }
}else{probeResult=s(await tool('validate_agent',{agentId}));kept=true}
const finalValidation=s(await tool('validate_agent',{agentId}));
console.log(`N8N_MANAGED_CREDENTIAL_PROBE_OK existing=${Boolean(beforeCredential)} managed_kept=${kept} final_valid=${Boolean(finalValidation?.valid)} missing=${JSON.stringify(finalValidation?.missing||[])}`);
