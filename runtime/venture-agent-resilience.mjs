const RETRYABLE_PROVIDER = /execution_failed|AI_APICallError|rate limit reached|too many requests|insufficient quota|provider.*timeout|service unavailable|\b429\b/i;

export function isRetryableProviderFailure(value) {
  return RETRYABLE_PROVIDER.test(String(value || ''));
}

export function retryDelayMs(value, attempt = 1) {
  const text = String(value || '');
  const explicit = text.match(/try again in\s+([0-9]+(?:\.[0-9]+)?)s/i);
  if (explicit) return Math.min(30000, Math.max(1500, Math.ceil(Number(explicit[1]) * 1000) + 1200));
  return Math.min(30000, 3500 * Math.max(1, Number(attempt) || 1));
}

export async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

export function extractVentureResult(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('VENTURE_RESULT empty');
  const marker = 'VENTURE_RESULT=';
  const markerAt = raw.indexOf(marker);
  const preferredStart = markerAt >= 0 ? raw.indexOf('{', markerAt + marker.length) : -1;
  const starts = [];
  if (preferredStart >= 0) starts.push(preferredStart);
  for (let i = 0; i < raw.length; i += 1) if (raw[i] === '{' && !starts.includes(i)) starts.push(i);
  for (const start of starts) {
    const parsed = parseBalancedJsonObject(raw, start);
    if (parsed && isVentureResultShape(parsed)) return parsed;
  }
  throw new Error(markerAt >= 0 ? 'VENTURE_RESULT JSON invalid' : 'VENTURE_RESULT marker/JSON missing');
}

export function compactScenarioForStage(scenario = {}, stage = '') {
  const common = { scenario_id: scenario.scenario_id, disclaimer: scenario.disclaimer };
  switch (String(stage || '').toUpperCase()) {
    case 'RESOURCE': return { ...common, resource_options: scenario.resource_options };
    case 'MATERIAL': return { ...common, material_options: scenario.material_options, product_constraints: scenario.product_constraints };
    case 'GLOBAL_NEED': return { ...common, market_constraints: scenario.market_constraints, product_constraints: scenario.product_constraints };
    case 'PRODUCT': return { ...common, product_constraints: scenario.product_constraints, market_constraints: scenario.market_constraints };
    case 'MANUFACTURING': return { ...common, manufacturing_options: scenario.manufacturing_options, product_constraints: scenario.product_constraints, market_constraints: scenario.market_constraints, gap: scenario.gap };
    case 'GO_TO_MARKET': return { ...common, market_constraints: scenario.market_constraints, product_constraints: scenario.product_constraints };
    case 'USER_FEEDBACK': return { ...common, feedback: scenario.feedback, market_constraints: scenario.market_constraints, gap: scenario.gap };
    default: return common;
  }
}

export function compactUpstreamResults(previous = {}, maxStages = 3) {
  const entries = Object.entries(previous || {}).slice(-Math.max(1, Number(maxStages) || 3));
  return Object.fromEntries(entries.map(([stage, row]) => [stage, {
    candidate_id: row?.candidate_id || null,
    claim: String(row?.claim || '').slice(0, 260),
    metrics: row?.metrics && typeof row.metrics === 'object' && !Array.isArray(row.metrics) ? row.metrics : {},
    evidence_refs: Array.isArray(row?.evidence_refs) ? row.evidence_refs.slice(0, 4) : [],
  }]));
}

export function compactPurificationScenario(scenario = {}) {
  return {
    scenario_id: scenario.scenario_id,
    disclaimer: scenario.disclaimer,
    material_options: scenario.material_options,
    manufacturing_options: scenario.manufacturing_options,
    product_constraints: scenario.product_constraints,
    market_constraints: scenario.market_constraints,
    gap: scenario.gap,
  };
}

function parseBalancedJsonObject(raw, start) {
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < raw.length; i += 1) {
    const ch = raw[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\' && quoted) { escaped = true; continue; }
    if (ch === '"') { quoted = !quoted; continue; }
    if (quoted) continue;
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(raw.slice(start, i + 1)); }
        catch { return null; }
      }
    }
  }
  return null;
}

function isVentureResultShape(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && typeof value.claim === 'string' && value.metrics && typeof value.metrics === 'object' && !Array.isArray(value.metrics));
}
