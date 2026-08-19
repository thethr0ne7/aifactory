import fs from 'node:fs/promises';

const endpoint = process.env.N8N_MCP_URL || 'https://thethr0ne7.app.n8n.cloud/mcp-server/http';
const token = process.env.N8N_MCP_TOKEN;
const agentId = 'tjPdLV47rjFQFHOV';
const projectId = 'FP3HOvN6NpEDN0PB';
const targetModel = 'openai/gpt-5.6-sol';
const targetCredentialName = 'AI Factory OpenAI';
if (!token) throw new Error('N8N_MCP_TOKEN is required');

function parsePayload(text, type = '') {
  if (!text.trim()) return null;
  if (type.includes('text/event-stream')) {
    const chunks = text
      .split(/\r?\n\r?\n/)
      .map((block) => block.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n'))
      .filter(Boolean);
    for (let i = chunks.length - 1; i >= 0; i -= 1) {
      try { return JSON.parse(chunks[i]); } catch {}
    }
    throw new Error('No JSON SSE payload');
  }
  return JSON.parse(text);
}

async function request(message) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(message),
  });
  const text = await response.text();
  const payload = parsePayload(text, response.headers.get('content-type') || '');
  if (!response.ok || payload?.error) {
    throw new Error(`MCP failure ${response.status}: ${JSON.stringify(payload).slice(0, 1200)}`);
  }
  return payload;
}

function structured(payload) {
  if (payload?.result?.structuredContent) return payload.result.structuredContent;
  const text = payload?.result?.content?.find?.((item) => item?.type === 'text')?.text;
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { text }; }
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

await request({
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'ai-factory-nursery-model-config', version: '2.4.0' } },
});
await request({ jsonrpc: '2.0', method: 'notifications/initialized' });
let id = 2;
async function tool(name, args = {}) {
  return request({ jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name, arguments: args } });
}

async function listCredentials(args = {}) {
  const payload = structured(await tool('list_credentials', { limit: 200, ...args }));
  return Array.isArray(payload?.data) ? payload.data : [];
}

const globalRows = await listCredentials({ query: targetCredentialName });
const projectRows = await listCredentials({ projectId, query: targetCredentialName });
const allGlobalRows = globalRows.length ? globalRows : await listCredentials({});
const visibleRows = [...globalRows, ...projectRows, ...allGlobalRows]
  .filter((row, index, array) => row?.id && array.findIndex((candidate) => candidate?.id === row.id) === index);
const exactMatches = visibleRows.filter((row) => row?.name === targetCredentialName);
if (exactMatches.length !== 1) {
  const visibleSummary = visibleRows.map((row) => ({ name: row?.name || null, type: row?.type || null })).slice(0, 30);
  throw new Error(`Expected exactly one credential named ${targetCredentialName}; found ${exactMatches.length}; visible=${JSON.stringify(visibleSummary)}`);
}
const credential = exactMatches[0];
const credentialId = credential.id;
if (!credentialId) throw new Error('Matched OpenAI credential has no id');
const credentialType = String(credential.type || '');
if (credentialType && !/openai/i.test(credentialType)) {
  throw new Error(`Credential ${targetCredentialName} has unexpected type ${credentialType}`);
}

const before = structured(await tool('get_agent', { agentId }));
let configHash = findKey(before, 'configHash');
if (!configHash) throw new Error('Agent configHash missing');
const currentModel = findKey(before, 'model') || '';
const currentCredential = findKey(before, 'credential') || '';
const patch = [];
if (currentModel !== targetModel) patch.push({ op: currentModel ? 'replace' : 'add', path: '/model', value: targetModel });
if (currentCredential !== credentialId) patch.push({ op: currentCredential ? 'replace' : 'add', path: '/credential', value: credentialId });

let changed = false;
if (patch.length) {
  const mutation = structured(await tool('mutate_agent', {
    agentId,
    baseConfigHash: configHash,
    operation: { type: 'config.patch', patch },
  }));
  configHash = findKey(mutation, 'configHash') || configHash;
  changed = true;
}

const validation = structured(await tool('validate_agent', { agentId }));
const result = {
  checked_at: new Date().toISOString(),
  agent_id: agentId,
  target_model: targetModel,
  credential_name: targetCredentialName,
  credential_type: credentialType || null,
  credential_found: true,
  credential_bound: true,
  changed,
  validation_call_ok: Boolean(validation?.ok ?? false),
  validation_valid: Boolean(validation?.valid ?? false),
  missing: Array.isArray(validation?.missing) ? validation.missing : [],
  publication_attempted: false,
  execution_attempted: false,
  note: 'Exact-name credential binding only. Secret values are never read, logged, copied, or persisted. Agent remains unpublished.',
};
await fs.mkdir('artifacts', { recursive: true });
await fs.writeFile('artifacts/n8n-nursery-model-config.json', JSON.stringify(result, null, 2) + '\n');
console.log(`N8N_NURSERY_MODEL_CONFIG_OK model=${targetModel} credential=${targetCredentialName} changed=${changed} valid=${result.validation_valid} missing=${JSON.stringify(result.missing)}`);
