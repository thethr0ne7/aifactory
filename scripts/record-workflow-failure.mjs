#!/usr/bin/env node

const audience = 'aifactory-supabase-runtime';
const sink = process.env.FACTORY_FAULT_SINK_URL || 'https://hgivyjjethjwswjrvroy.supabase.co/functions/v1/ai-factory-fault-sink';
const scope = process.env.FACTORY_FAILURE_SCOPE || 'unknown-factory-workflow';
const summary = process.env.FACTORY_FAILURE_SUMMARY || `AI Factory workflow failure: ${scope}`;

try {
  const token = await getOidcToken(audience);
  const response = await fetch(sink, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: 'FACTORY_WORKFLOW_FAILURE',
      scope,
      summary,
      affected_invariants: ['durable-error-memory','terminal-state-integrity'],
      evidence: {
        repository: process.env.GITHUB_REPOSITORY,
        ref: process.env.GITHUB_REF,
        sha: process.env.GITHUB_SHA,
        run_id: process.env.GITHUB_RUN_ID,
        run_attempt: process.env.GITHUB_RUN_ATTEMPT,
        workflow: process.env.GITHUB_WORKFLOW,
        job: process.env.GITHUB_JOB,
      },
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`fault sink failed: ${response.status} ${text.slice(0, 800)}`);
  console.log(`AI Factory failure memory recorded: ${text.slice(0, 1000)}`);
} catch (error) {
  console.error(`AI Factory failure memory WARNING: ${safeError(error)}`);
  process.exitCode = 0;
}

async function getOidcToken(aud) {
  const base = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const token = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!base || !token) throw new Error('GitHub OIDC environment unavailable');
  const url = new URL(base);
  url.searchParams.set('audience', aud);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`OIDC token request failed: ${response.status}`);
  const body = await response.json();
  if (!body.value) throw new Error('OIDC token response missing value');
  return body.value;
}
function safeError(error) { return (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, ' ').slice(0, 1200); }
