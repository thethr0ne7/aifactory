import { createHash, randomUUID } from 'node:crypto';

export function buildN8nNurseryEnvelope(action, payload = {}, options = {}) {
  const allowed = new Set(['spawn_candidate','run_training_task','request_evaluation','request_human_approval','resume_after_approval','quarantine_candidate']);
  if (!allowed.has(action)) throw new Error(`Unsupported n8n nursery action: ${action}`);
  const body = {
    schema: 'aifactory.n8n-nursery.v1',
    request_id: clean(options.request_id, 120) || randomUUID(),
    action,
    factory_run_id: clean(options.factory_run_id, 120) || null,
    candidate_ref: clean(options.candidate_ref, 160) || null,
    payload: object(payload),
    authority: {
      caller: 'AI Factory',
      external_system: 'n8n',
      max_autonomy: 'A3',
      root_of_trust_mutation: false,
      self_promotion: false,
    },
  };
  body.fingerprint = fingerprint(body);
  return body;
}

export function validateN8nNurseryResult(input = {}) {
  const result = object(input);
  const status = new Set(['ACCEPTED','RUNNING','WAITING_APPROVAL','COMPLETE','BLOCKED','FAILED']).has(String(result.status))
    ? String(result.status)
    : 'FAILED';
  return {
    schema: clean(result.schema, 120),
    request_id: clean(result.request_id, 120),
    status,
    workflow_execution_ref: clean(result.workflow_execution_ref, 300) || null,
    candidate_ref: clean(result.candidate_ref, 160) || null,
    evidence_refs: uniq(result.evidence_refs, 50),
    blocker: clean(result.blocker, 3000) || null,
    raw_summary: clean(result.summary, 5000),
  };
}

export function buildOpikTraceEnvelope(input = {}) {
  const source = object(input);
  const trace = {
    schema: 'aifactory.opik-trace.v1',
    trace_id: clean(source.trace_id, 120) || randomUUID(),
    name: clean(source.name, 200) || 'agent-nursery-evaluation',
    project_name: clean(source.project_name, 160) || 'aifactory-agent-nursery',
    candidate_ref: clean(source.candidate_ref, 160),
    factory_run_id: clean(source.factory_run_id, 120) || null,
    input: object(source.input),
    output: object(source.output),
    metadata: {
      ...object(source.metadata),
      authority_boundary: 'Opik provides evaluation evidence; AI Factory owns promotion decisions',
    },
    tags: uniq(source.tags, 20),
  };
  trace.fingerprint = fingerprint(trace);
  return trace;
}

export function buildOpikEvaluationEnvelope(input = {}) {
  const source = object(input);
  const metrics = Array.isArray(source.metrics) ? source.metrics.slice(0, 50).map(normalizeMetric).filter(Boolean) : [];
  return {
    schema: 'aifactory.opik-evaluation.v1',
    evaluation_id: clean(source.evaluation_id, 120) || randomUUID(),
    candidate_ref: clean(source.candidate_ref, 160),
    experiment_ref: clean(source.experiment_ref, 300) || null,
    baseline_ref: clean(source.baseline_ref, 300) || null,
    regression_suite_ref: clean(source.regression_suite_ref, 300) || null,
    metrics,
    evaluator: {
      system: 'opik',
      method: clean(source.method, 160) || 'external-evaluation',
      model_or_rule: clean(source.model_or_rule, 300) || null,
    },
    note: 'Metrics are evidence inputs only; they do not authorize promotion.',
  };
}

export function mapOpikMetricsToFactoryDimensions(envelope = {}, mapping = {}) {
  const source = object(envelope);
  const metrics = Array.isArray(source.metrics) ? source.metrics : [];
  const dimensions = {};
  for (const metric of metrics) {
    const factoryDimension = clean(mapping[metric.name], 120);
    if (!factoryDimension) continue;
    dimensions[factoryDimension] = {
      score: metric.score,
      evidence_class: metric.evidence_class,
      basis: `Opik metric ${metric.name}: ${metric.basis || 'no additional basis'}`,
    };
  }
  return dimensions;
}

function normalizeMetric(value) {
  const row = object(value);
  const name = clean(row.name, 160);
  if (!name) return null;
  const number = Number(row.score);
  return {
    name,
    score: Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : null,
    evidence_class: ['MEASURED','OBSERVED','CONFIRMED','DERIVED'].includes(String(row.evidence_class)) ? String(row.evidence_class) : 'UNKNOWN',
    basis: clean(row.basis, 3000),
    trace_ref: clean(row.trace_ref, 300) || null,
  };
}

function fingerprint(value) { return `ext:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function clean(value, max) { return String(value ?? '').replace(/[\u0000\r\n]+/g, ' ').trim().slice(0, max); }
function uniq(value, max) { return Array.isArray(value) ? [...new Set(value.map((x) => clean(x, 300)).filter(Boolean))].slice(0, max) : []; }
