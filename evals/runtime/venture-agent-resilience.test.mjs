import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compactPurificationScenario,
  compactScenarioForStage,
  compactUpstreamResults,
  extractVentureResult,
  isRetryableProviderFailure,
  retryDelayMs,
} from '../../runtime/venture-agent-resilience.mjs';

const result = { claim: 'synthetic control', evidence_class: 'DERIVED', source_refs: ['CONTROL_SCENARIO_VX1'], confidence: 90, metrics: { supply_risk: 20 } };

test('extractVentureResult accepts canonical marker', () => {
  assert.deepEqual(extractVentureResult(`VENTURE_RESULT=${JSON.stringify(result)}`), result);
});

test('extractVentureResult safely recovers a valid standalone JSON object without marker', () => {
  assert.deepEqual(extractVentureResult(`Here is the requested object:\n${JSON.stringify(result)}\nDone.`), result);
});

test('extractVentureResult rejects unrelated JSON and prose', () => {
  assert.throws(() => extractVentureResult('{"status":"ok"}'), /VENTURE_RESULT/);
  assert.throws(() => extractVentureResult('plain prose'), /VENTURE_RESULT/);
});

test('provider failures are retryable with bounded explicit backoff', () => {
  const text = 'AI_APICallError: Rate limit reached. Please try again in 4.605s.';
  assert.equal(isRetryableProviderFailure(text), true);
  assert.equal(retryDelayMs(text, 1), 5805);
  assert.ok(retryDelayMs('execution_failed', 3) <= 30000);
  assert.equal(isRetryableProviderFailure('valid result'), false);
});

test('stage compaction excludes unrelated control payload', () => {
  const scenario = {
    scenario_id: 'VX1', disclaimer: 'synthetic', resource_options: [{ id: 'R1' }], material_options: [{ id: 'M1' }],
    product_constraints: { max_material_input_cost: 25 }, manufacturing_options: [{ id: 'MF1' }], market_constraints: { capital_ceiling: 20 },
    feedback: { severity: 0.7 }, gap: { metric: 'purification_cost_share' }, extra_noise: 'x'.repeat(10000),
  };
  const resource = compactScenarioForStage(scenario, 'RESOURCE');
  assert.deepEqual(resource.resource_options, [{ id: 'R1' }]);
  assert.equal('material_options' in resource, false);
  assert.equal('extra_noise' in resource, false);
  const purification = compactPurificationScenario(scenario);
  assert.equal(purification.gap.metric, 'purification_cost_share');
  assert.equal('extra_noise' in purification, false);
});

test('upstream compaction keeps only recent bounded stage state', () => {
  const previous = {
    RESOURCE: { candidate_id: 'r', claim: 'r'.repeat(1000), metrics: { a: 1 }, evidence_refs: ['1','2','3','4','5'] },
    MATERIAL: { candidate_id: 'm', claim: 'm'.repeat(1000), metrics: { b: 2 }, evidence_refs: ['6'] },
    GLOBAL_NEED: { candidate_id: 'n', claim: 'n'.repeat(1000), metrics: { c: 3 }, evidence_refs: ['7'] },
    PRODUCT: { candidate_id: 'p', claim: 'p'.repeat(1000), metrics: { d: 4 }, evidence_refs: ['8'] },
  };
  const compact = compactUpstreamResults(previous, 3);
  assert.deepEqual(Object.keys(compact), ['MATERIAL','GLOBAL_NEED','PRODUCT']);
  assert.ok(compact.PRODUCT.claim.length <= 260);
  assert.equal(compact.RESOURCE, undefined);
});
