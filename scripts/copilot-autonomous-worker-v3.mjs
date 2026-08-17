#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const audience = 'aifactory-supabase-runtime';
const criticalMemoryUrl = process.env.FACTORY_CRITICAL_MEMORY_URL || 'https://hgivyjjethjwswjrvroy.supabase.co/functions/v1/ai-factory-critical-memory';
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aifactory-critical-memory-'));
const memoryPath = path.join(tempDir, 'critical-memory.json');

try {
  const token = await getOidcToken(audience);
  const response = await fetch(criticalMemoryUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit: 100 }),
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
  if (!response.ok) throw new Error(`critical memory fetch failed: ${response.status} ${text.slice(0, 500)}`);

  const critical = Array.isArray(body.critical_incidents) ? body.critical_incidents : [];
  fs.writeFileSync(memoryPath, JSON.stringify({ critical_incidents: critical, provenance: body.provenance || {} }), 'utf8');
  process.env.FACTORY_CRITICAL_MEMORY_FILE = memoryPath;
  console.log(`AI Factory: preloaded mandatory critical memory incidents=${critical.length}`);

  await import('./copilot-autonomous-worker-v2.mjs');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

async function getOidcToken(aud) {
  const base = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const token = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!base || !token) throw new Error('GitHub OIDC environment unavailable; id-token: write is required');
  const url = new URL(base);
  url.searchParams.set('audience', aud);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`OIDC token request failed: ${response.status}`);
  const body = await response.json();
  if (!body.value) throw new Error('OIDC token response missing value');
  return body.value;
}
