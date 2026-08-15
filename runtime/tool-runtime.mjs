import path from 'node:path';

const AUTONOMY_ORDER = ['A0','A1','A2','A3','A4','A5','A6','A7'];

export function autonomyAtLeast(actual, required) {
  const a = AUTONOMY_ORDER.indexOf(String(actual || ''));
  const r = AUTONOMY_ORDER.indexOf(String(required || ''));
  return a >= 0 && r >= 0 && a >= r;
}

export function toolMap(policy = {}) {
  return new Map((policy.tools || []).map((tool) => [tool.id, tool]));
}

export function normalizeToolRequests(raw, policy, autonomyLevel) {
  const tools = toolMap(policy);
  const max = Math.max(0, Math.min(Number(policy?.maxToolRequestsPerWorkerTurn) || 3, 6));
  const source = Array.isArray(raw) ? raw : [];
  const out = [];
  const seen = new Set();

  for (const item of source) {
    if (out.length >= max) break;
    const toolId = String(item?.tool_id || '').trim();
    const requestKey = normalizeRequestKey(item?.request_key);
    if (!toolId || !requestKey || seen.has(requestKey)) continue;
    const spec = tools.get(toolId);
    if (!spec || spec.autoExecute !== true) continue;
    if (!autonomyAtLeast(autonomyLevel, spec.minimumAutonomy)) continue;
    const args = object(item?.arguments);
    if (JSON.stringify(args).length > 120000) continue;
    out.push({
      tool_id: toolId,
      request_key: requestKey,
      arguments: args,
      required_autonomy: spec.minimumAutonomy,
      risk_class: spec.riskClass,
      reason: clean(item?.reason, 1200),
    });
    seen.add(requestKey);
  }
  return out;
}

export function validateToolRequest(request, policy, autonomyLevel) {
  const spec = toolMap(policy).get(String(request?.tool_id || ''));
  if (!spec) return { ok: false, code: 'UNKNOWN_TOOL' };
  if (spec.autoExecute !== true) return { ok: false, code: 'TOOL_NOT_AUTO_EXECUTABLE', spec };
  if (!autonomyAtLeast(autonomyLevel, spec.minimumAutonomy)) return { ok: false, code: 'AUTONOMY_TOO_LOW', spec };
  if (String(request?.risk_class || '') !== String(spec.riskClass || '')) return { ok: false, code: 'RISK_CLASS_MISMATCH', spec };
  if (String(request?.required_autonomy || '') !== String(spec.minimumAutonomy || '')) return { ok: false, code: 'AUTONOMY_CONTRACT_MISMATCH', spec };
  return { ok: true, spec };
}

export function normalizeRepoPath(value) {
  const raw = String(value || '').replace(/\\/g, '/').trim();
  if (!raw || raw.startsWith('/') || raw.includes('\u0000')) return null;
  const normalized = path.posix.normalize(raw);
  if (normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) return null;
  if (normalized.startsWith('.git/')) return null;
  return normalized;
}

export function candidatePathDecision(value, toolSpec = {}) {
  const normalized = normalizeRepoPath(value);
  if (!normalized) return { ok: false, code: 'INVALID_PATH' };
  const allowed = (toolSpec.allowedPathPrefixes || []).some((prefix) => normalized.startsWith(String(prefix)));
  if (!allowed) return { ok: false, code: 'PATH_NOT_ALLOWLISTED', path: normalized };
  const protectedHit = (toolSpec.protectedPaths || []).find((entry) => {
    const target = String(entry);
    return target.endsWith('/') ? normalized.startsWith(target) : normalized === target;
  });
  if (protectedHit) return { ok: false, code: 'PROTECTED_PATH', path: normalized, protected_hit: protectedHit };
  return { ok: true, path: normalized };
}

export function boundToolContext(context = {}, maxChars = 30000) {
  const requests = Array.isArray(context.requests) ? context.requests : [];
  const safe = { requests: [] };
  let used = 0;
  for (const request of requests) {
    const item = {
      id: request.id,
      tool_id: request.tool_id,
      request_key: request.request_key,
      status: request.status,
      arguments: request.arguments,
      result: request.result,
      error: request.error,
      created_at: request.created_at,
      completed_at: request.completed_at,
    };
    const text = JSON.stringify(item);
    if (used + text.length > maxChars) break;
    safe.requests.push(item);
    used += text.length;
  }
  return safe;
}

export function formatToolContext(context = {}) {
  if (!Array.isArray(context.requests) || !context.requests.length) return 'TOOL RESULTS\nNo prior tool requests for this run.';
  return `TOOL RESULTS\n${JSON.stringify(context)}`;
}

function normalizeRequestKey(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._:-]{2,119}$/.test(raw)) return '';
  return raw;
}
function clean(value, max) { return String(value ?? '').replace(/[\u0000\r]+/g, ' ').trim().slice(0, max); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
