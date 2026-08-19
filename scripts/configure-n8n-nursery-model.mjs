import fs from 'node:fs/promises';

const endpoint = process.env.N8N_MCP_URL || 'https://thethr0ne7.app.n8n.cloud/mcp-server/http';
const token = process.env.N8N_MCP_TOKEN;
const agentId = 'tjPdLV47rjFQFHOV';
const targetModel = 'openai/gpt-5.6-sol';
if (!token) throw new Error('N8N_MCP_TOKEN is required');

function parsePayload(text, type='') {
  if (!text.trim()) return null;
  if (type.includes('text/event-stream')) {
    const chunks = text.split(/\r?\n\r?\n/).map((b) => b.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n')).filter(Boolean);
    for (let i = chunks.length - 1; i >= 0; i--) { try { return JSON.parse(chunks[i]); } catch {} }
    throw new Error('No JSON SSE payload');
  }
  return JSON.parse(text);
}
async function request(message) {
  const r = await fetch(endpoint, { method:'POST', headers:{ authorization:`Bearer ${token}`, 'content-type':'application/json', accept:'application/json, text/event-stream' }, body:JSON.stringify(message) });
  const text = await r.text();
  const payload = parsePayload(text, r.headers.get('content-type') || '');
  if (!r.ok || payload?.error) throw new Error(`MCP failure ${r.status}: ${JSON.stringify(payload).slice(0,1200)}`);
  return payload;
}
function structured(p) {
  if (p?.result?.structuredContent) return p.result.structuredContent;
  const t = p?.result?.content?.find?.((x) => x?.type === 'text')?.text;
  if (!t) return null;
  try { return JSON.parse(t); } catch { return { text:t }; }
}
function findKey(value, key) {
  if (!value || typeof value !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(value, key) && value[key] != null) return value[key];
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    const found = findKey(child, key);
    if (found != null) return found;
  }
  return null;
}

await request({ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', capabilities:{}, clientInfo:{ name:'ai-factory-nursery-model-config', version:'2.4.0' } } });
await request({ jsonrpc:'2.0', method:'notifications/initialized' });
let id = 2;
async function tool(name,args={}) { return request({ jsonrpc:'2.0', id:id++, method:'tools/call', params:{ name, arguments:args } }); }

const before = structured(await tool('get_agent',{ agentId }));
let configHash = findKey(before,'configHash');
if (!configHash) throw new Error('Agent configHash missing');
const currentModel = findKey(before,'model') || '';
let changed = false;
if (currentModel !== targetModel) {
  const mutation = structured(await tool('mutate_agent',{
    agentId,
    baseConfigHash: configHash,
    operation:{ type:'config.patch', patch:[{ op: currentModel ? 'replace' : 'add', path:'/model', value:targetModel }] }
  }));
  configHash = findKey(mutation,'configHash') || configHash;
  changed = true;
}
const validation = structured(await tool('validate_agent',{ agentId }));
const result = {
  checked_at:new Date().toISOString(),
  agent_id:agentId,
  target_model:targetModel,
  previous_model:currentModel || null,
  changed,
  validation_call_ok:Boolean(validation?.ok ?? false),
  validation_valid:Boolean(validation?.valid ?? false),
  missing:Array.isArray(validation?.missing) ? validation.missing : [],
  publication_attempted:false,
  execution_attempted:false,
  note:'Model selection only. Credential is never guessed, copied, or embedded; agent remains unpublished.'
};
await fs.mkdir('artifacts',{recursive:true});
await fs.writeFile('artifacts/n8n-nursery-model-config.json',JSON.stringify(result,null,2)+'\n');
console.log(`N8N_NURSERY_MODEL_CONFIG_OK model=${targetModel} changed=${changed} valid=${result.validation_valid} missing=${JSON.stringify(result.missing)}`);
