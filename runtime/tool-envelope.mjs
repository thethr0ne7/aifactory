import crypto from 'node:crypto';

const REQUEST_KEY_RE = /^[a-z0-9][a-z0-9._:-]{2,119}$/;
const TRANSPORTS = new Set(['native', 'mcp', 'http', 'connector']);
const TERMINAL = new Set(['EXECUTED', 'DENIED', 'FAILED']);
const EVIDENCE = new Set(['MEASURED','OBSERVED','CONFIRMED','DERIVED','INFERRED','ASSUMPTION','UNKNOWN','BLOCKER']);

export function normalizeToolEnvelope(raw = {}, context = {}) {
  const policy = object(context.policy);
  const adapterRegistry = object(context.adapters);
  const tools = new Map((Array.isArray(policy.tools) ? policy.tools : []).map((tool) => [String(tool.id), tool]));
  const transport = clean(raw.transport || 'native', 32).toLowerCase();
  if (!TRANSPORTS.has(transport)) throw contractError('UNSUPPORTED_TRANSPORT');

  const adapter = resolveAdapter(adapterRegistry, transport, raw.adapter_id);
  if (!adapter || adapter.normalizationEnabled !== true) throw contractError('ADAPTER_NOT_ENABLED');

  const external = object(raw.external);
  let canonicalToolId = clean(raw.canonical_tool_id || raw.tool_id, 160);
  let mapping = null;

  if (transport === 'mcp') {
    const server = clean(external.server || raw.server, 300);
    const tool = clean(external.tool || raw.external_tool, 300);
    if (!server || !tool) throw contractError('MCP_EXTERNAL_IDENTITY_REQUIRED');
    mapping = findMcpMapping(adapter, server, tool);
    if (!mapping) throw contractError('MCP_TOOL_UNMAPPED');
    canonicalToolId = clean(mapping.canonical_tool_id, 160);
  }

  const spec = tools.get(canonicalToolId);
  if (!spec) throw contractError('CANONICAL_TOOL_NOT_ALLOWLISTED');

  const requestKey = clean(raw.request_key, 120).toLowerCase();
  if (!REQUEST_KEY_RE.test(requestKey)) throw contractError('INVALID_REQUEST_KEY');
  const idempotencyKey = clean(raw.idempotency_key || requestKey, 160).toLowerCase();
  if (!idempotencyKey) throw contractError('IDEMPOTENCY_KEY_REQUIRED');

  const args = object(raw.arguments);
  if (JSON.stringify(args).length > 120000) throw contractError('TOOL_ARGUMENTS_TOO_LARGE');

  const trace = normalizeTrace(object(raw.trace), context);
  const executionPermitted = adapter.executionEnabled === true && mappingExecutionEnabled(mapping);

  return {
    schema_version: '1.0.0',
    canonical_tool_id: canonicalToolId,
    request_key: requestKey,
    idempotency_key: idempotencyKey,
    transport,
    adapter_id: adapter.id,
    external: transport === 'mcp' ? {
      server: clean(external.server || raw.server, 300),
      tool: clean(external.tool || raw.external_tool, 300),
    } : null,
    arguments: args,
    required_autonomy: String(spec.minimumAutonomy || ''),
    risk_class: String(spec.riskClass || ''),
    execution_permitted: executionPermitted,
    trace,
    provenance: {
      adapter_id: adapter.id,
      transport,
      normalized_at: new Date().toISOString(),
      mapping_id: mapping?.id || null,
      authority_source: 'registry/tool-runtime.json',
    },
  };
}

export function normalizeToolResultEnvelope(raw = {}, requestEnvelope = {}) {
  const status = clean(raw.status || raw.outcome, 16).toUpperCase();
  if (!TERMINAL.has(status)) throw contractError('INVALID_TOOL_TERMINAL_STATUS');
  const evidenceClass = clean(raw.evidence_class || (status === 'EXECUTED' ? 'CONFIRMED' : 'BLOCKER'), 32).toUpperCase();
  if (!EVIDENCE.has(evidenceClass)) throw contractError('INVALID_EVIDENCE_CLASS');

  const requestTrace = object(requestEnvelope.trace);
  const traceId = uuid(requestTrace.trace_id, 'TRACE_ID_REQUIRED');
  const parentSpanId = uuid(requestTrace.span_id, 'REQUEST_SPAN_ID_REQUIRED');
  const spanId = crypto.randomUUID();

  return {
    schema_version: '1.0.0',
    canonical_tool_id: clean(requestEnvelope.canonical_tool_id, 160),
    request_key: clean(requestEnvelope.request_key, 120),
    status,
    result: object(raw.result),
    error: raw.error == null ? null : object(raw.error),
    evidence_class: evidenceClass,
    trace: {
      trace_id: traceId,
      span_id: spanId,
      parent_span_id: parentSpanId,
      traceparent: w3cTraceparent(traceId, spanId),
    },
    provenance: {
      adapter_id: clean(requestEnvelope.adapter_id, 160),
      transport: clean(requestEnvelope.transport, 32),
      completed_at: new Date().toISOString(),
    },
  };
}

export function w3cTraceparent(traceId, spanId) {
  const traceHex = uuid(traceId, 'TRACE_ID_REQUIRED').replaceAll('-', '').toLowerCase();
  const spanHex = uuid(spanId, 'SPAN_ID_REQUIRED').replaceAll('-', '').slice(0, 16).toLowerCase();
  return `00-${traceHex}-${spanHex}-01`;
}

function normalizeTrace(trace, context) {
  const traceId = uuid(trace.trace_id || context.traceId || context.runId, 'TRACE_ID_REQUIRED');
  const spanId = trace.span_id ? uuid(trace.span_id, 'INVALID_SPAN_ID') : crypto.randomUUID();
  const parent = trace.parent_span_id || context.parentSpanId || null;
  const parentSpanId = parent ? uuid(parent, 'INVALID_PARENT_SPAN_ID') : null;
  return {
    trace_id: traceId,
    span_id: spanId,
    parent_span_id: parentSpanId,
    traceparent: w3cTraceparent(traceId, spanId),
  };
}

function resolveAdapter(registry, transport, requestedId) {
  const adapters = Array.isArray(registry.adapters) ? registry.adapters : [];
  const requested = clean(requestedId, 160);
  if (requested) return adapters.find((adapter) => adapter.id === requested && adapter.transport === transport) || null;
  return adapters.find((adapter) => adapter.transport === transport) || null;
}

function findMcpMapping(adapter, server, tool) {
  const mappings = Array.isArray(adapter?.mappings) ? adapter.mappings : [];
  return mappings.find((mapping) => mapping?.enabled === true && mapping.server === server && mapping.tool === tool) || null;
}

function mappingExecutionEnabled(mapping) {
  if (!mapping) return true;
  return mapping.executionEnabled !== false;
}

function uuid(value, code) {
  const text = String(value || '').trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(text)) throw contractError(code);
  return text;
}

function contractError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function clean(value, max) { return String(value ?? '').replace(/[\u0000\r\n]+/g, ' ').trim().slice(0, max); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
