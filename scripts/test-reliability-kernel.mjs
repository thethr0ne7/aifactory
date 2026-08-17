#!/usr/bin/env node

import assert from 'node:assert/strict';
import { parseStructuredObject } from '../runtime/structured-output.mjs';
import { normalizeToolRequests, boundToolContext, toolRequestFingerprint } from '../runtime/tool-runtime.mjs';
import { selectExecutableMemory, executableMemoryRefs } from '../runtime/executable-memory.mjs';

const policy = {
  maxToolRequestsPerWorkerTurn: 3,
  tools: [
    { id: 'factory.repo.read_file', autoExecute: true, minimumAutonomy: 'A3', riskClass: 'LOW' },
    { id: 'factory.repo.list_files', autoExecute: true, minimumAutonomy: 'A3', riskClass: 'LOW' },
  ],
};

{
  const broken = `{"status":"COMPLETE","decision":"line one
line two","output":{}}`;
  const parsed = parseStructuredObject(broken);
  assert.equal(parsed.value.status, 'COMPLETE');
  assert.equal(parsed.value.decision, 'line one\nline two');
  assert.equal(parsed.repaired, true);
}

{
  const wrapped = 'noise before ```json\n{"status":"COMPLETE","decision":"ok",}\n``` noise after';
  const parsed = parseStructuredObject(wrapped);
  assert.equal(parsed.value.status, 'COMPLETE');
  assert.equal(parsed.value.decision, 'ok');
}

{
  const prior = {
    requests: [{
      id: 'r1',
      tool_id: 'factory.repo.read_file',
      request_key: 'audit.capabilities',
      status: 'EXECUTED',
      arguments: { path: 'registry/capabilities.json', max_chars: 20000 },
      result: { path: 'registry/capabilities.json', git_blob_sha: 'abc', content: 'x'.repeat(2000) },
      created_at: '2026-08-17T00:00:00Z',
      completed_at: '2026-08-17T00:00:01Z',
    }],
  };
  const bounded = boundToolContext(prior, 1800);
  assert.ok(bounded.known_request_keys.includes('audit.capabilities'));
  assert.ok(bounded.known_request_fingerprints.includes(toolRequestFingerprint('factory.repo.read_file', { path: 'registry/capabilities.json', max_chars: 20000 })));

  const normalized = normalizeToolRequests([
    {
      tool_id: 'factory.repo.read_file',
      request_key: 'audit.capabilities.again',
      arguments: { path: 'registry/capabilities.json', max_chars: 20000 },
      reason: 'repeat same evidence with a new key',
    },
  ], policy, 'A3', bounded);
  assert.equal(normalized.length, 0, 'semantic duplicate must be rejected even with a new request_key');
}

{
  const memory = selectExecutableMemory(
    { objective: 'unrelated marketing task', kind: 'general', payload: {} },
    {
      lessons: [],
      incidents: [],
      critical_incidents: [{
        id: '11111111-1111-4111-8111-111111111111',
        run_id: '22222222-2222-4222-8222-222222222222',
        severity: 'FORBIDDEN',
        status: 'OPEN',
        summary: 'Root of Trust mutation attempt',
        affected_invariants: ['ROOT-001','ROOT-007'],
        created_at: '2026-08-17T00:00:00Z',
      }],
    },
  );
  assert.equal(memory.critical_incidents.length, 1);
  const refs = executableMemoryRefs(memory);
  assert.ok(refs.critical_incident_ids.includes('11111111-1111-4111-8111-111111111111'));
}

console.log('AI Factory Reliability Kernel tests OK');
