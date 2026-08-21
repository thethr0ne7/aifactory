import path from 'node:path';

const AUTONOMY_ORDER = ['A0','A1','A2','A3','A4','A5','A6','A7'];
const TERMINAL_TOOL_STATUSES = new Set(['EXECUTED','DENIED','FAILED']);

export function autonomyAtLeast(actual, required) {
  const a = AUTONOMY_ORDER.indexOf(String(actual || ''));
  const r = AUTONOMY_ORDER.indexOf(String(required || ''));
  return a >= 0 && r >= 0 && a >= r;
}

export function toolMap(policy = {}) {
  return new Map((policy.tools || []).map((tool) => [tool.id, tool]));
}

export function normalizeToolRequests(raw, policy, autonomyLevel, priorContext = {}) {
  const tools = toolMap(policy);
  const max = Math.max(0, Math.min(Number(policy?.maxToolRequestsPerWorkerTurn) || 3, 6));
  const source = Array.isArray(raw) ? raw : [];
  const out = [];
  const seenKeys = new Set();
  const seenFingerprints = new Set();
  const prior = priorToolIndex(priorContext);

  for (const item of source) {
    if (out.length >= max) break;
    const toolId = String(item?.tool_id || '').trim();
    if (!toolId) continue;
    const spec = tools.get(toolId);
    if (!spec || spec.autoExecute !== true) continue;
    if (!autonomyAtLeast(autonomyLevel, spec.minimumAutonomy)) continue;
    const args = object(item?.arguments);
    if (JSON.stringify(args).length > 120000) continue;

    const fingerprint = toolRequestFingerprint(toolId, args);
    if (seenFingerprints.has(fingerprint) || prior.fingerprints.has(fingerprint)) continue;
    const requestKey = normalizeRequestKey(item?.request_key) || deterministicRequestKey(toolId, fingerprint);
    if (!requestKey || seenKeys.has(requestKey) || prior.keys.has(requestKey)) continue;

    out.push({
      tool_id: toolId,
      request_key: requestKey,
      request_fingerprint: fingerprint,
      arguments: args,
      required_autonomy: spec.minimumAutonomy,
      risk_class: spec.riskClass,
      reason: clean(item?.reason, 1200),
    });
    seenKeys.add(requestKey);
    seenFingerprints.add(fingerprint);
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
  const budget = Math.max(300, Number(maxChars) || 30000);
  const requests = Array.isArray(context.requests) ? context.requests : [];
  const allIndex = requests.map(compactToolIndex);
  const knownKeys = [...new Set(allIndex.map((x) => x.request_key).filter(Boolean))];
  const knownFingerprints = [...new Set(allIndex.map((x) => x.request_fingerprint).filter(Boolean))];
  const safe = {
    known_request_keys: knownKeys,
    known_request_fingerprints: knownFingerprints,
    request_index: [],
    requests: [],
  };

  let used = JSON.stringify({
    known_request_keys: knownKeys,
    known_request_fingerprints: knownFingerprints,
  }).length;

  const indexCeiling = Math.max(used, Math.floor(budget * 0.45));
  for (const item of allIndex) {
    const text = JSON.stringify(item);
    if (used + text.length > indexCeiling) continue;
    safe.request_index.push(item);
    used += text.length;
  }

  const prioritized = [...requests].sort((a, b) => {
    const aTerminal = TERMINAL_TOOL_STATUSES.has(String(a?.status || '')) ? 1 : 0;
    const bTerminal = TERMINAL_TOOL_STATUSES.has(String(b?.status || '')) ? 1 : 0;
    if (aTerminal !== bTerminal) return bTerminal - aTerminal;
    return Date.parse(b?.completed_at || b?.created_at || 0) - Date.parse(a?.completed_at || a?.created_at || 0);
  });

  for (const request of prioritized) {
    const item = compactToolRequest(request);
    let text = JSON.stringify(item);
    if (used + text.length > budget) {
      const minimal = minimalToolRequest(request);
      text = JSON.stringify(minimal);
      if (used + text.length > budget) continue;
      safe.requests.push(minimal);
    } else {
      safe.requests.push(item);
    }
    used += text.length;
  }

  safe.requests.sort((a, b) => Date.parse(a?.created_at || 0) - Date.parse(b?.created_at || 0));
  return safe;
}

export function formatToolContext(context = {}) {
  const hasIndex = Array.isArray(context.request_index) && context.request_index.length;
  const hasKeys = Array.isArray(context.known_request_keys) && context.known_request_keys.length;
  if (!hasIndex && !hasKeys) return 'TOOL RESULTS\nNo prior tool requests for this run.';
  return [
    'TOOL RESULTS',
    'Known request keys/fingerprints are durable even when full result bodies were compacted.',
    'Never repeat a known request_key or a semantically identical request fingerprint.',
    'Use git_blob_sha/sha256/path metadata as cache identity for repository reads. Request a new read only when the target revision changed or materially different evidence is required.',
    JSON.stringify(context),
  ].join('\n');
}

export function toolRequestFingerprint(toolId, args = {}) {
  const stable = `${String(toolId || '')}|${stableStringify(args)}`;
  let hash = 2166136261;
  for (let i = 0; i < stable.length; i += 1) {
    hash ^= stable.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function deterministicRequestKey(toolId, fingerprint) {
  const toolPart = String(toolId || '')
    .trim()
    .toLowerCase()
    .replace(/^factory\./, '')
    .replace(/[^a-z0-9._:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'tool';
  const fp = String(fingerprint || '').split(':').pop()?.replace(/[^a-z0-9]/g, '').slice(0, 24) || 'unknown';
  return normalizeRequestKey(`auto:${toolPart}:${fp}`);
}

function priorToolIndex(context = {}) {
  const keys = new Set(Array.isArray(context.known_request_keys) ? context.known_request_keys : []);
  const fingerprints = new Set(Array.isArray(context.known_request_fingerprints) ? context.known_request_fingerprints : []);
  for (const request of Array.isArray(context.requests) ? context.requests : []) {
    const key = normalizeRequestKey(request?.request_key);
    if (key) keys.add(key);
    const fingerprint = request?.request_fingerprint || toolRequestFingerprint(request?.tool_id, object(request?.arguments));
    if (fingerprint) fingerprints.add(fingerprint);
  }
  for (const request of Array.isArray(context.request_index) ? context.request_index : []) {
    const key = normalizeRequestKey(request?.request_key);
    if (key) keys.add(key);
    if (request?.request_fingerprint) fingerprints.add(String(request.request_fingerprint));
  }
  return { keys, fingerprints };
}

function compactToolIndex(request) {
  const args = object(request?.arguments);
  const result = object(request?.result);
  return {
    id: request?.id,
    tool_id: request?.tool_id,
    request_key: request?.request_key,
    request_fingerprint: toolRequestFingerprint(request?.tool_id, args),
    status: request?.status,
    path: clean(args.path || result.path, 600) || null,
    prefix: clean(args.prefix || result.prefix, 600) || null,
    git_blob_sha: clean(result.git_blob_sha, 80) || null,
    sha256: clean(result.sha256, 100) || null,
    evidence_class: request?.evidence_class || null,
    created_at: request?.created_at,
    completed_at: request?.completed_at,
  };
}

function compactToolRequest(request) {
  return {
    ...compactToolIndex(request),
    arguments: compactArguments(request?.arguments),
    result: compactToolResult(request?.tool_id, request?.result),
    error: compactValue(request?.error, 3000),
  };
}

function minimalToolRequest(request) {
  const index = compactToolIndex(request);
  const result = object(request?.result);
  return {
    tool_id: index.tool_id,
    request_key: index.request_key,
    request_fingerprint: index.request_fingerprint,
    status: index.status,
    path: index.path,
    git_blob_sha: index.git_blob_sha,
    sha256: index.sha256,
    result_preview: clean(result.content || result.error || '', 180),
  };
}

function compactArguments(value) {
  const args = object(value);
  const text = JSON.stringify(args);
  if (text.length <= 4000) return args;
  return { compacted: true, preview: text.slice(0, 4000) };
}

function compactToolResult(toolId, value) {
  const result = object(value);
  if (!Object.keys(result).length) return result;

  if (toolId === 'factory.repo.read_file') {
    return {
      exists: result.exists,
      path: result.path,
      git_blob_sha: result.git_blob_sha,
      sha256: result.sha256,
      truncated: result.truncated,
      content: clean(result.content, 6000),
      compacted: String(result.content || '').length > 6000,
    };
  }

  if (toolId === 'factory.repo.list_files') {
    const files = Array.isArray(result.files) ? result.files.map((x) => clean(x, 600)).filter(Boolean) : [];
    return {
      prefix: result.prefix ?? null,
      count: result.count,
      limit: result.limit,
      files: files.slice(0, 160),
      compacted: files.length > 160,
    };
  }

  if (toolId === 'factory.repo.run_validation') {
    const runs = Array.isArray(result.runs) ? result.runs.map((x) => ({
      script: clean(x?.script, 500),
      exit_code: x?.exit_code,
      stdout: clean(x?.stdout, 1600),
      stderr: clean(x?.stderr, 1600),
    })) : [];
    return { suite: result.suite, passed: result.passed, runs };
  }

  const text = JSON.stringify(result);
  if (text.length <= 7000) return result;
  return { compacted: true, preview: text.slice(0, 7000) };
}

function compactValue(value, max) {
  if (value == null) return value;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length <= max ? value : { compacted: true, preview: text.slice(0, max) };
}

function stableStringify(value) {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function normalizeRequestKey(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._:-]{2,119}$/.test(raw)) return '';
  return raw;
}
function clean(value, max) { return String(value ?? '').replace(/[\u0000\r]+/g, ' ').trim().slice(0, max); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
