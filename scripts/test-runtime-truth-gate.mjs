import assert from 'node:assert/strict';
import { enforceRuntimeTruth } from '../runtime/truth-gate.mjs';

function base(overrides = {}) {
  return {
    status: 'COMPLETE',
    activated_agents: ['ceo'],
    selected_skills: ['quality-gates'],
    decision: 'Validated result',
    output: {},
    evidence: [{ class: 'OBSERVED', claim: 'Test observation', basis: 'fixture' }],
    assumptions: [],
    risks: [],
    next_action: 'Ship after gates pass.',
    tool_requests: [],
    ...overrides,
  };
}

{
  const { result, gate } = enforceRuntimeTruth(base({
    output: {
      telegram_posts: [
        { agent: 'runtime-mechanic', text: 'I was not activated.' },
        { agent: 'ceo', text: 'Authorized.' },
      ],
    },
  }));
  assert.deepEqual(result.output.telegram_posts, [{ agent: 'ceo', text: 'Authorized.' }]);
  assert.equal(gate.status, 'REPAIRED');
  assert.ok(gate.findings.some((item) => item.code === 'UNAUTHORIZED_TELEGRAM_AUTHOR'));
}

{
  const { result, gate } = enforceRuntimeTruth(base({
    activated_agents: [],
    output: { telegram_posts: [{ agent: 'ceo', text: 'No author should survive.' }] },
  }));
  assert.deepEqual(result.output.telegram_posts, []);
  assert.equal(gate.status, 'REPAIRED');
}

{
  const { result, gate } = enforceRuntimeTruth(base({
    evidence: [{ class: 'BLOCKER', claim: 'Production authority is missing.', basis: 'fixture' }],
  }));
  assert.equal(result.status, 'BLOCKED');
  assert.equal(gate.status, 'BLOCKED');
  assert.deepEqual(result.tool_requests, []);
  assert.ok(result.risks.some((risk) => risk.includes('Truth Gate blocked COMPLETE')));
}

{
  const { result, gate } = enforceRuntimeTruth(base({
    evidence: [{ class: 'NOT_A_CLASS', claim: 'Unclassified fact.', basis: 'fixture' }],
  }));
  assert.equal(result.evidence[0].class, 'UNKNOWN');
  assert.equal(gate.status, 'REPAIRED');
  assert.ok(gate.findings.some((item) => item.code === 'EVIDENCE_CLASS_REPAIRED'));
}

{
  const posts = Array.from({ length: 9 }, (_, index) => ({ agent: 'ceo', text: `Post ${index + 1}` }));
  const { result, gate } = enforceRuntimeTruth(base({ output: { telegram_posts: posts } }));
  assert.equal(result.output.telegram_posts.length, 6);
  assert.equal(gate.status, 'REPAIRED');
}

{
  const { result, gate } = enforceRuntimeTruth(base({
    output: { telegram_posts: [{ agent: 'ceo', text: 'Authorized and valid.' }] },
  }));
  assert.equal(result.status, 'COMPLETE');
  assert.equal(gate.status, 'PASS');
}

console.log('Runtime Truth Gate tests OK');
