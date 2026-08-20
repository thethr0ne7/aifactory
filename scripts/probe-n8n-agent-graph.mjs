const endpoint = process.env.N8N_MCP_URL || 'https://thethr0ne7.app.n8n.cloud/mcp-server/http';
const token = process.env.N8N_MCP_TOKEN;
const supervisorId = 'tjPdLV47rjFQFHOV';
if (!token) throw new Error('N8N_MCP_TOKEN required');
function parse(text,type=''){if(!text.trim())return null;if(!type.includes('text/event-stream'))return JSON.parse(text);const chunks=text.split(/\r?\n\r?\n/).map(b=>b.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n')).filter(Boolean);for(let i=chunks.length-1;i>=0;i--){try{return JSON.parse(chunks[i]);}catch{}}throw new Error('No JSON SSE payload');}
async function req(message){const r=await fetch(endpoint,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify(message)});const p=parse(await r.text(),r.headers.get('content-type')||'');if(!r.ok||p?.error)throw new Error(`MCP ${r.status}: ${JSON.stringify(p).slice(0,1200)}`);return p;}
function structured(p){if(p?.result?.structuredContent)return p.result.structuredContent;const t=p?.result?.content?.find?.(x=>x?.type==='text')?.text;if(!t)return null;try{return JSON.parse(t);}catch{return{text:t}}}
function walk(v,path='$',out=[]){if(!v||typeof v!=='object')return out;for(const [k,val] of Object.entries(v)){const p=`${path}.${k}`;if(/sub.?agents?|configHash|agentId|tools|memory|config/i.test(k)){out.push({path:p,type:Array.isArray(val)?'array':typeof val,keys:val&&typeof val==='object'&&!Array.isArray(val)?Object.keys(val):undefined,length:Array.isArray(val)?val.length:undefined});}if(val&&typeof val==='object')walk(val,p,out);}return out;}
await req({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'ai-factory-agent-graph-probe',version:'1.0.0'}}});
await req({jsonrpc:'2.0',method:'notifications/initialized'});
const list=await req({jsonrpc:'2.0',id:2,method:'tools/list',params:{}});
const tools=list?.result?.tools||[];
const relevant=tools.filter(t=>['get_agent','mutate_agent','validate_agent'].includes(t.name)).map(t=>({name:t.name,description:t.description,inputSchema:t.inputSchema}));
const agent=structured(await req({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'get_agent',arguments:{agentId:supervisorId}}}));
console.log(JSON.stringify({relevant_tools:relevant,supervisor_shape:walk(agent)},null,2));
