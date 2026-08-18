import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeToolEnvelope, normalizeToolResultEnvelope, w3cTraceparent } from '../../runtime/tool-envelope.mjs';

const policy = JSON.parse(fs.readFileSync(new URL('../../registry/tool-runtime.json', import.meta.url), 'utf8'));
const adapters = JSON.parse(fs.readFileSync(new URL('../../registry/tool-adapters.json', import.meta.url), 'utf8'));
const runId = '11111111-1111-4111-8111-111111111111';

test('native Factory tools normalize to canonical policy authority', () => {
  const envelope = normalizeToolEnvelope({
    tool_id: 'factory.repo.read_file',
    request_key: 'repo.read.agents',
    arguments: { path: 'AGENTS.md' },
    risk_class: 'ROOT_OR_CATASTROPHIC',
    required_autonomy: 'A7'
  }, { policy, adapters, runId });

  assert.equal(envelope.canonical_tool_id, 'factory.repo.read_file');
  assert.equal(envelope.transport, 'native');
  assert.equal(envelope.adapter_id, 'native-factory');
  assert.equal(envelope.risk_class, 'LOW');
  assert.equal(envelope.required_autonomy, 'A3');
  assert.equal(envelope.execution_permitted, true);
  assert.equal(envelope.trace.trace_id, runId);
  assert.match(envelope.trace.traceparent, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
});

test('unmapped MCP tools are denied by default', () => {
  assert.throws(() => normalizeToolEnvelope({
    transport: 'mcp',
    adapter_id: 'mcp-bridge',
    server: 'example-server',
    external_tool: 'read_anything',
    request_key: 'mcp.example.read',
    arguments: {}
  }, { policy, adapters, runId }), /MCP_TOOL_UNMAPPED/);
});

test('reviewed MCP mapping can normalize but cannot silently gain execution authority', () => {
  const mapped = structuredClone(adapters);
  const bridge = mapped.adapters.find((x) => x.id === 'mcp-bridge');
  bridge.mappings.push({
    id: 'example-read-file',
    enabled: true,
    executionEnabled: true,
    server: 'reviewed-server',
    tool: 'read_file',
    canonical_tool_id: 'factory.repo.read_file'
  });

  const envelope = normalizeToolEnvelope({
    transport: 'mcp',
    adapter_id: 'mcp-bridge',
    server: 'reviewed-server',
    external_tool: 'read_file',
    request_key: 'mcp.reviewed.read',
    arguments: { path: 'README.md' },
    risk_class: 'LOW',
    required_autonomy: 'A0'
  }, { policy, adapters: mapped, runId });

  assert.equal(envelope.canonical_tool_id, 'factory.repo.read_file');
  assert.equal(envelope.risk_class, 'LOW');
  assert.equal(envelope.required_autonomy, 'A3');
  assert.equal(envelope.execution_permitted, false);
  assert.deepEqual(envelope.external, { server: 'reviewed-server', tool: 'read_file' });
});

test('result envelope continues the same trace with child span', () => {
  const request = normalizeToolEnvelope({
    tool_id: 'factory.repo.list_files',
    request_key: 'repo.list.skills',
    arguments: { prefix: 'skills/' }
  }, { policy, adapters, runId });

  const result = normalizeToolResultEnvelope({
    status: 'EXECUTED',
    result: { count: 2 },
    evidence_class: 'CONFIRMED'
  }, request);

  assert.equal(result.trace.trace_id, request.trace.trace_id);
  assert.equal(result.trace.parent_span_id, request.trace.span_id);
  assert.notEqual(result.trace.span_id, request.trace.span_id);
  assert.equal(result.status, 'EXECUTED');
});

test('W3C traceparent is deterministic for supplied ids', () => {
  const span = '22222222-2222-4222-8222-222222222222';
  assert.equal(w3cTraceparent(runId, span), '00-11111111111141118111111111111111-2222222222224222-01');
});
