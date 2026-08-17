import { boundToolContext, validateToolRequest } from './tool-runtime.mjs';

const SESSION_TRANSITIONS = Object.freeze({
  READY: ['QUALIFYING', 'BLOCKED'],
  QUALIFYING: ['ROUTED', 'BLOCKED', 'FAILED'],
  ROUTED: ['WORKING', 'BLOCKED', 'FAILED'],
  WORKING: ['WAITING_TOOLS', 'VALIDATING', 'REPAIRING', 'BLOCKED', 'FAILED'],
  WAITING_TOOLS: ['WORKING', 'VALIDATING', 'BLOCKED', 'FAILED'],
  VALIDATING: ['COMPLETE', 'REPAIRING', 'BLOCKED', 'FAILED'],
  REPAIRING: ['WORKING', 'VALIDATING', 'BLOCKED', 'FAILED'],
  COMPLETE: [],
  BLOCKED: [],
  FAILED: [],
});

const CONTEXT_ORDER = Object.freeze([
  'policy',
  'decisions',
  'evidence',
  'task',
  'working',
  'toolResults',
]);

export function createAgentSession({
  id,
  goal,
  mode = 'interactive',
  maxContextChars = 60000,
  metadata = {},
} = {}) {
  const sessionId = clean(id, 160);
  const sessionGoal = clean(goal, 4000);
  if (!sessionId) throw new Error('SESSION_ID_REQUIRED');
  if (!sessionGoal) throw new Error('SESSION_GOAL_REQUIRED');

  return {
    id: sessionId,
    goal: sessionGoal,
    mode: clean(mode, 80) || 'interactive',
    state: 'READY',
    revision: 0,
    max_context_chars: clampInt(maxContextChars, 4000, 250000, 60000),
    metadata: plainObject(metadata),
    selected_capabilities: [],
    history: [],
    last_turn: null,
  };
}

export function transitionAgentSession(session, nextState, detail = {}) {
  const current = String(session?.state || '');
  const next = String(nextState || '');
  const allowed = SESSION_TRANSITIONS[current] || [];
  if (!allowed.includes(next)) {
    throw new Error(`INVALID_SESSION_TRANSITION:${current}->${next}`);
  }

  return {
    ...session,
    state: next,
    revision: Number(session?.revision || 0) + 1,
    history: appendBounded(session?.history, {
      type: 'STATE_TRANSITION',
      from: current,
      to: next,
      note: clean(detail?.note, 1200),
      at: detail?.at || null,
    }),
  };
}

export function compileAgentContext({
  policy = [],
  decisions = [],
  evidence = [],
  task = [],
  working = [],
  toolContext = {},
  maxChars = 60000,
} = {}) {
  const budget = clampInt(maxChars, 4000, 250000, 60000);
  const normalized = {
    policy: normalizeEntries(policy),
    decisions: normalizeEntries(decisions),
    evidence: normalizeEntries(evidence),
    task: normalizeEntries(task),
    working: normalizeEntries(working),
    toolResults: normalizeEntries(boundToolContext(toolContext, Math.min(30000, Math.floor(budget * 0.4))).requests),
  };

  const sections = [];
  let used = 0;
  const dropped = {};

  for (const layer of CONTEXT_ORDER) {
    const entries = normalized[layer];
    const accepted = [];
    let omitted = 0;

    for (const entry of entries) {
      const serialized = stableString(entry);
      const cost = serialized.length + 24;
      if (used + cost > budget) {
        omitted += 1;
        continue;
      }
      accepted.push(entry);
      used += cost;
    }

    if (accepted.length) sections.push({ layer, entries: accepted });
    if (omitted) dropped[layer] = omitted;
  }

  return {
    budget_chars: budget,
    used_chars: used,
    sections,
    dropped,
  };
}

export function buildAgentTurn({
  session,
  capabilityIds = [],
  context = {},
  toolRequests = [],
  toolPolicy = {},
  autonomyLevel = 'A3',
} = {}) {
  if (!session?.id) throw new Error('SESSION_REQUIRED');

  const selected = uniqueStrings(capabilityIds, 24, 120);
  const compiledContext = compileAgentContext({
    ...context,
    maxChars: session.max_context_chars,
  });

  const allowedTools = [];
  const deniedTools = [];
  for (const request of Array.isArray(toolRequests) ? toolRequests : []) {
    const decision = validateToolRequest(request, toolPolicy, autonomyLevel);
    const normalized = {
      tool_id: clean(request?.tool_id, 160),
      request_key: clean(request?.request_key, 160),
      arguments: plainObject(request?.arguments),
      required_autonomy: clean(request?.required_autonomy, 20),
      risk_class: clean(request?.risk_class, 80),
    };
    if (decision.ok) {
      allowedTools.push(normalized);
    } else {
      deniedTools.push({ ...normalized, denial_code: decision.code });
    }
  }

  const turn = {
    session_id: session.id,
    session_revision: session.revision,
    goal: session.goal,
    selected_capabilities: selected,
    context: compiledContext,
    tool_requests: {
      allowed: allowedTools,
      denied: deniedTools,
    },
  };

  return {
    session: {
      ...session,
      selected_capabilities: selected,
      last_turn: turn,
      revision: Number(session.revision || 0) + 1,
      history: appendBounded(session.history, {
        type: 'TURN_BUILT',
        allowed_tools: allowedTools.length,
        denied_tools: deniedTools.length,
        context_chars: compiledContext.used_chars,
      }),
    },
    turn,
  };
}

export function recordToolOutcome(session, outcome = {}) {
  if (!session?.id) throw new Error('SESSION_REQUIRED');
  const requestKey = clean(outcome?.request_key, 160);
  if (!requestKey) throw new Error('REQUEST_KEY_REQUIRED');

  const status = clean(outcome?.status, 40).toUpperCase();
  if (!['COMPLETE', 'FAILED', 'BLOCKED', 'CANCELLED'].includes(status)) {
    throw new Error('INVALID_TOOL_OUTCOME_STATUS');
  }

  return {
    ...session,
    revision: Number(session.revision || 0) + 1,
    history: appendBounded(session.history, {
      type: 'TOOL_OUTCOME',
      request_key: requestKey,
      tool_id: clean(outcome?.tool_id, 160),
      status,
      result_summary: clean(outcome?.result_summary, 1600),
      error_code: clean(outcome?.error_code, 160),
      at: outcome?.at || null,
    }),
  };
}

export function providerRequestEnvelope({
  session,
  turn,
  provider,
  model,
  transport = 'adapter',
  requestId,
} = {}) {
  if (!session?.id || !turn?.session_id) throw new Error('SESSION_AND_TURN_REQUIRED');
  if (session.id !== turn.session_id) throw new Error('SESSION_TURN_MISMATCH');

  return {
    request_id: clean(requestId, 160) || `${session.id}:${session.revision}`,
    provider: clean(provider, 120),
    model: clean(model, 160),
    transport: clean(transport, 80) || 'adapter',
    session: {
      id: session.id,
      goal: session.goal,
      mode: session.mode,
      revision: session.revision,
    },
    turn,
    contracts: {
      provider_must_not_mutate_factory_state_directly: true,
      side_effects_require_tool_runtime: true,
      credentials_are_runtime_secrets: true,
      transport_is_not_policy_authority: true,
    },
  };
}

export function sessionTransitionMap() {
  return JSON.parse(JSON.stringify(SESSION_TRANSITIONS));
}

function normalizeEntries(value) {
  const source = Array.isArray(value) ? value : value == null ? [] : [value];
  return source
    .filter((item) => item !== undefined && item !== null)
    .map((item) => typeof item === 'string' ? clean(item, 12000) : plainObjectOrValue(item));
}

function appendBounded(history, entry, max = 200) {
  const next = [...(Array.isArray(history) ? history : []), entry];
  return next.slice(Math.max(0, next.length - max));
}

function uniqueStrings(values, maxItems, maxLength) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const item = clean(value, maxLength);
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
    if (out.length >= maxItems) break;
  }
  return out;
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
}

function plainObjectOrValue(value) {
  if (value && typeof value === 'object') return JSON.parse(JSON.stringify(value));
  return value;
}

function stableString(value) {
  try { return JSON.stringify(value); } catch { return String(value); }
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(number)));
}

function clean(value, max) {
  return String(value ?? '').replace(/[\u0000\r]+/g, ' ').trim().slice(0, max);
}
