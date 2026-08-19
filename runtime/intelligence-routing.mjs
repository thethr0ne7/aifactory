import { createHash } from 'node:crypto';

const PDF_KINDS = new Set(['TEXT_BASED','SCANNED','IMAGE_BASED','MIXED','UNKNOWN']);
const SOURCE_STATES = new Set(['HEALTHY','STALE','DEGRADED','FAILED','UNKNOWN']);

export function normalizePdfInspection(input = {}) {
  const value = object(input);
  const kind = PDF_KINDS.has(String(value.kind)) ? String(value.kind) : 'UNKNOWN';
  const pages = Array.isArray(value.pages) ? value.pages.slice(0, 5000).map((page, index) => {
    const row = object(page);
    const pageKind = PDF_KINDS.has(String(row.kind)) ? String(row.kind) : kind;
    return {
      page: Number.isInteger(Number(row.page)) ? Number(row.page) : index + 1,
      kind: pageKind,
      confidence: boundedScore(row.confidence),
      reason: clean(row.reason, 1200),
    };
  }) : [];
  return {
    kind,
    confidence: boundedScore(value.confidence),
    pages,
    classifier: clean(value.classifier, 200) || 'external-pdf-inspector',
    source_ref: clean(value.source_ref, 500) || null,
  };
}

export function planPdfExtraction(inspectionInput = {}) {
  const inspection = normalizePdfInspection(inspectionInput);
  const perPage = inspection.pages.map((page) => ({ page: page.page, route: routeForPdfKind(page.kind), kind: page.kind, confidence: page.confidence }));
  const mixed = new Set(perPage.map((x) => x.route)).size > 1;
  const documentRoute = mixed ? 'SELECTIVE_PER_PAGE' : routeForPdfKind(inspection.kind);
  return {
    document_route: documentRoute,
    per_page: perPage,
    preserve_page_provenance: true,
    extraction_truth_rule: 'classification chooses extraction method; extracted claims still require evidence validation',
  };
}

export function normalizeSweepSnapshot(input = {}) {
  const value = object(input);
  const sources = Array.isArray(value.sources) ? value.sources.slice(0, 500).map(normalizeSource).filter(Boolean) : [];
  return {
    sweep_id: clean(value.sweep_id, 160) || `sweep:${fingerprint(sources).slice(0, 24)}`,
    captured_at: clean(value.captured_at, 80) || new Date().toISOString(),
    sources,
    source_count: sources.length,
    healthy_count: sources.filter((x) => x.state === 'HEALTHY').length,
    stale_count: sources.filter((x) => x.state === 'STALE').length,
    failed_count: sources.filter((x) => x.state === 'FAILED').length,
  };
}

export function compareSweepSnapshots(previousInput = {}, currentInput = {}) {
  const previous = normalizeSweepSnapshot(previousInput);
  const current = normalizeSweepSnapshot(currentInput);
  const before = new Map(previous.sources.map((x) => [x.source_id, x]));
  const deltas = [];
  for (const row of current.sources) {
    const old = before.get(row.source_id);
    if (!old) {
      deltas.push({ source_id: row.source_id, type: 'NEW_SOURCE', current: row });
      continue;
    }
    if (old.content_fingerprint !== row.content_fingerprint) deltas.push({ source_id: row.source_id, type: 'CONTENT_CHANGED', previous: old.content_fingerprint, current: row.content_fingerprint });
    if (old.state !== row.state) deltas.push({ source_id: row.source_id, type: 'SOURCE_STATE_CHANGED', previous: old.state, current: row.state });
    before.delete(row.source_id);
  }
  for (const old of before.values()) deltas.push({ source_id: old.source_id, type: 'SOURCE_MISSING', previous: old });
  return {
    previous_sweep_id: previous.sweep_id,
    current_sweep_id: current.sweep_id,
    deltas,
    changed: deltas.length > 0,
    requires_reasoning: deltas.some((x) => x.type === 'CONTENT_CHANGED'),
    truth_rule: 'a temporal delta is a signal, not a confirmed interpretation',
  };
}

export function gateDefensiveOsintRequest(input = {}) {
  const value = object(input);
  const allowedPurposes = new Set(['self-audit','organization-due-diligence','owned-asset-inventory','authorized-investigation','public-entity-research']);
  const purpose = clean(value.purpose, 160);
  const scope = clean(value.scope, 2000);
  const targetType = clean(value.target_type, 80);
  const failures = [];
  if (!allowedPurposes.has(purpose)) failures.push('purpose is not in the defensive OSINT allowlist');
  if (!scope) failures.push('bounded scope is required');
  if (targetType === 'private-person' && value.authorization_confirmed !== true && purpose !== 'self-audit') failures.push('private-person lookup requires explicit authorization');
  if (value.credential_discovery === true) failures.push('credential discovery is outside this capability');
  if (value.stalking_or_tracking === true) failures.push('stalking/tracking is outside this capability');
  return {
    decision: failures.length ? 'BLOCKED' : 'ALLOWED_BOUNDED',
    failures,
    purpose,
    scope,
    target_type: targetType || 'unspecified',
    audit_required: true,
  };
}

export function normalizeRuntimeTelemetry(input = {}) {
  const value = object(input);
  const metrics = Array.isArray(value.metrics) ? value.metrics.slice(0, 500).map((metric) => {
    const row = object(metric);
    const number = Number(row.value);
    if (!clean(row.name, 160) || !Number.isFinite(number)) return null;
    return {
      name: clean(row.name, 160),
      value: number,
      unit: clean(row.unit, 40) || null,
      source: clean(row.source, 160) || 'runtime',
      measured_at: clean(row.measured_at, 80) || null,
      evidence_class: 'MEASURED',
    };
  }).filter(Boolean) : [];
  return {
    node_ref: clean(value.node_ref, 200) || 'unknown-node',
    captured_at: clean(value.captured_at, 80) || new Date().toISOString(),
    metrics,
    source_endpoint_exposure: value.source_endpoint_exposure === 'public' ? 'PUBLIC_RISK' : 'LOCAL_OR_CONTROLLED',
    truth_rule: 'dashboard rendering is not evidence; only measured source metrics are evidence',
  };
}

function normalizeSource(value) {
  const row = object(value);
  const sourceId = clean(row.source_id, 200);
  if (!sourceId) return null;
  const state = SOURCE_STATES.has(String(row.state)) ? String(row.state) : 'UNKNOWN';
  const canonical = typeof row.content === 'string' ? row.content : JSON.stringify(row.content ?? null);
  return {
    source_id: sourceId,
    state,
    captured_at: clean(row.captured_at, 80) || null,
    source_ref: clean(row.source_ref, 1000) || null,
    content_fingerprint: clean(row.content_fingerprint, 160) || fingerprint(canonical),
    metadata: object(row.metadata),
  };
}

function routeForPdfKind(kind) {
  if (kind === 'TEXT_BASED') return 'NATIVE_EXTRACTION';
  if (kind === 'MIXED') return 'SELECTIVE_PER_PAGE';
  if (kind === 'SCANNED') return 'OCR_OR_VISION';
  if (kind === 'IMAGE_BASED') return 'VISION_FIRST';
  return 'INSPECT_OR_FALLBACK';
}

function fingerprint(value) { return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex'); }
function boundedScore(value) { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : null; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function clean(value, max) { return String(value ?? '').replace(/[\u0000\r\n]+/g, ' ').trim().slice(0, max); }
