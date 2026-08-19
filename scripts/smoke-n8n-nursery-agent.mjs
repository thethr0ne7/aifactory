import fs from 'node:fs/promises';

const endpoint = process.env.N8N_MCP_URL || 'https://thethr0ne7.app.n8n.cloud/mcp-server/http';
const token = process.env.N8N_MCP_TOKEN;
const agentId = 'tjPdLV47rjFQFHOV';
const marker = 'NURSERY_SUPERVISOR_SMOKE_OK';
if (!token) throw new Error('N8N_MCP_TOKEN is required');

function parsePayload(text, type = '') {
  if (!text.trim()) return null;
  if (type.includes('text/event-stream')) {
    const chunks = text.split(/\r?\n\r?\n/).map((block) => block.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')).filter(Boolean);
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
  if (!response.ok || payload?.error) throw new Error(`MCP failure ${response.status}: ${JSON.stringify(payload).slice(0, 1200)}`);
  return payload;
}

function structured(payload) {
  if (payload?.result?.structuredContent) return payload.result.structuredContent;
  const text = payload?.result?.content?.find?.((item) => item?.type === 'text')?.text;
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { text }; }
}

function collectStrings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => collectStrings(item, out));
  return out;
}

await request({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'ai-factory-nursery-smoke', version: '2.4.0' } } });
await request({ jsonrpc: '2.0', method: 'notifications/initialized' });
const call = await request({
  jsonrpc: '2.0', id: 2, method: 'tools/call',
  params: {
    name: 'call_agent',
    arguments: {
      agentId,
      request: {
        type: 'message',
        message: `Reply with exactly ${marker}. Do not call tools and do not add any other text.`,
      },
    },
  },
});
const result = structured(call);
const strings = collectStrings(result);
const matched = strings.some((text) => text.includes(marker));
const sanitized = {
  checked_at: new Date().toISOString(),
  agent_id: agentId,
  marker_expected: marker,
  marker_observed: matched,
  preview_call_ok: true,
  publication_attempted: false,
  external_tool_calls_requested: false,
  note: 'Preview-only model/credential smoke. No agent publication and no external tools requested.',
};
await fs.mkdir('artifacts', { recursive: true });
await fs.writeFile('artifacts/n8n-nursery-agent-smoke.json', JSON.stringify(sanitized, null, 2) + '\n');
if (!matched) throw new Error(`Agent preview completed but did not return expected marker; response=${JSON.stringify(result).slice(0, 1200)}`);
console.log(`N8N_NURSERY_AGENT_SMOKE_OK agent_id=${agentId} marker=${marker}`);
