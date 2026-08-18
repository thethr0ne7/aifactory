#!/usr/bin/env node

import fs from 'node:fs';

const errors = [];
const read = (path) => {
  if (!fs.existsSync(path)) { errors.push(`missing file: ${path}`); return {}; }
  try { return JSON.parse(fs.readFileSync(path, 'utf8')); }
  catch (error) { errors.push(`invalid JSON ${path}: ${error.message}`); return {}; }
};

const policy = read('registry/tool-runtime.json');
const adapters = read('registry/tool-adapters.json');
const telemetry = read('registry/telemetry-policy.json');

const canonical = new Set((policy.tools || []).map((tool) => tool.id));
if (!canonical.size) errors.push('tool runtime has no canonical tools');
if (adapters.defaultPolicy !== 'deny-unmapped') errors.push('tool adapters must default to deny-unmapped');

const native = (adapters.adapters || []).find((x) => x.id === 'native-factory');
if (!native || native.transport !== 'native' || native.executionEnabled !== true) errors.push('native-factory adapter contract invalid');

const mcp = (adapters.adapters || []).find((x) => x.id === 'mcp-bridge');
if (!mcp || mcp.transport !== 'mcp') errors.push('mcp-bridge adapter missing');
if (mcp?.executionEnabled !== false) errors.push('mcp-bridge execution must default false');
for (const mapping of mcp?.mappings || []) {
  if (mapping.enabled === true && !canonical.has(mapping.canonical_tool_id)) {
    errors.push(`MCP mapping targets non-canonical tool: ${mapping.canonical_tool_id}`);
  }
}

for (const field of ['event_id','run_id','trace_id','span_id','event_type','occurred_at','source','evidence_class']) {
  if (!(telemetry.requiredFields || []).includes(field)) errors.push(`telemetry required field missing: ${field}`);
}
if (telemetry.rules?.unmappedMcpToolsMayNotExecute !== true) errors.push('telemetry policy must deny unmapped MCP execution');
if (telemetry.rules?.toolResultMustContinueRequestTrace !== true) errors.push('tool result trace continuation rule missing');

for (const file of [
  'runtime/tool-envelope.mjs',
  'evals/runtime/tool-envelope.test.mjs',
  'docs/TOOL-NORMALIZATION-AND-TRACING.md',
  'infra/supabase/migrations/20260818_284_tool_trace_observability.sql'
]) {
  if (!fs.existsSync(file)) errors.push(`missing observability artifact: ${file}`);
}

const migration = fs.existsSync('infra/supabase/migrations/20260818_284_tool_trace_observability.sql')
  ? fs.readFileSync('infra/supabase/migrations/20260818_284_tool_trace_observability.sql','utf8') : '';
for (const token of ['af_trace_timeline','af_run_observability','security_invoker = true','trace_id','parent_span_id']) {
  if (!migration.includes(token)) errors.push(`observability migration missing token: ${token}`);
}

if (errors.length) {
  console.error('Tool normalization / observability validation FAILED');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log(`Tool normalization / observability validation OK: ${canonical.size} canonical tools; MCP execution default denied`);
