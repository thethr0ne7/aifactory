#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const registry = JSON.parse(fs.readFileSync(path.join(root, 'registry/external-runtimes.json'), 'utf8'));
const runtime = registry.runtimes.find((item) => item.id === 'n8n-agent-nursery');
if (!runtime) throw new Error('n8n-agent-nursery runtime is not registered');

const instanceUrl = String(process.env.N8N_INSTANCE_URL || runtime.instanceUrl || '').replace(/\/$/, '');
const apiKey = String(process.env.N8N_API_KEY || '');
const workflowPath = path.join(root, runtime.deployment.workflowSource);
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

if (!/^https:\/\//.test(instanceUrl)) throw new Error('N8N_INSTANCE_URL must use HTTPS');
if (!apiKey) throw new Error('N8N_API_KEY is required and must be supplied from a secret store');

const headers = {
  'Content-Type': 'application/json',
  'X-N8N-API-KEY': apiKey,
};

const payload = {
  name: workflow.name,
  nodes: workflow.nodes,
  connections: workflow.connections,
  settings: workflow.settings || {},
};

const apiBase = `${instanceUrl}${runtime.apiBasePath || '/api/v1'}`;

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text.slice(0, 2000) }; }
  if (!response.ok) {
    const message = body?.message || body?.error || body?.raw || `HTTP ${response.status}`;
    throw new Error(`n8n API ${response.status}: ${String(message).slice(0, 1200)}`);
  }
  return body;
}

const list = await request(`${apiBase}/workflows?limit=250`);
const workflows = Array.isArray(list) ? list : Array.isArray(list?.data) ? list.data : [];
const existing = workflows.find((item) => item?.name === workflow.name);

let deployed;
let operation;
if (existing?.id) {
  deployed = await request(`${apiBase}/workflows/${encodeURIComponent(existing.id)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  operation = 'updated';
} else {
  deployed = await request(`${apiBase}/workflows`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  operation = 'created';
}

const workflowId = deployed?.id || existing?.id || null;
if (!workflowId) throw new Error('n8n returned no workflow id after deployment');

console.log(JSON.stringify({
  ok: true,
  operation,
  workflow_id: workflowId,
  name: workflow.name,
  instance_url: instanceUrl,
  active: deployed?.active === true,
  activation_policy: 'manual-after-auth-and-factory-gateway-verification',
}, null, 2));
