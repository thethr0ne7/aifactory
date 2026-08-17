import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAgentTurn,
  compileAgentContext,
  createAgentSession,
  providerRequestEnvelope,
  recordToolOutcome,
  transitionAgentSession,
} from '../../runtime/agent-runtime-kernel.mjs';

test('session lifecycle rejects invalid jumps and preserves history', () => {
  let session = createAgentSession({ id: 'run-1', goal: 'Ship a bounded change' });
  session = transitionAgentSession(session, 'QUALIFYING');
  session = transitionAgentSession(session, 'ROUTED');
  assert.equal(session.state, 'ROUTED');
  assert.equal(session.history.length, 2);
  assert.throws(() => transitionAgentSession(session, 'COMPLETE'), /INVALID_SESSION_TRANSITION/);
});

test('context compiler keeps higher-priority layers before lower-priority noise', () => {
  const compiled = compileAgentContext({
    maxChars: 4000,
    policy: ['Do not bypass evidence gates.'],
    decisions: ['Use one canonical router.'],
    evidence: [{ id: 'e1', status: 'OBSERVED' }],
    working: Array.from({ length: 50 }, (_, index) => `noise-${index}-${'x'.repeat(200)}`),
  });

  const layers = compiled.sections.map((section) => section.layer);
  assert.deepEqual(layers.slice(0, 3), ['policy', 'decisions', 'evidence']);
  assert.ok(compiled.used_chars <= compiled.budget_chars);
  assert.ok((compiled.dropped.working || 0) > 0);
});

test('turn builder routes tool requests through existing Factory tool policy', () => {
  const session = createAgentSession({ id: 'run-2', goal: 'Inspect repository state' });
  const policy = {
    tools: [
      {
        id: 'repo.read',
        autoExecute: true,
        minimumAutonomy: 'A2',
        riskClass: 'read-only',
      },
    ],
  };

  const request = {
    tool_id: 'repo.read',
    request_key: 'repo.read:1',
    arguments: { path: 'README.md' },
    required_autonomy: 'A2',
    risk_class: 'read-only',
  };

  const { turn } = buildAgentTurn({
    session,
    capabilityIds: ['repo-intake'],
    toolRequests: [request, { ...request, tool_id: 'shell.exec', request_key: 'shell.exec:1' }],
    toolPolicy: policy,
    autonomyLevel: 'A3',
  });

  assert.equal(turn.tool_requests.allowed.length, 1);
  assert.equal(turn.tool_requests.denied.length, 1);
  assert.equal(turn.tool_requests.denied[0].denial_code, 'UNKNOWN_TOOL');
});

test('provider envelope keeps provider transport outside policy authority', () => {
  const session = createAgentSession({ id: 'run-3', goal: 'Draft a plan' });
  const { session: updated, turn } = buildAgentTurn({ session, capabilityIds: ['task-qualifier'] });
  const envelope = providerRequestEnvelope({
    session: updated,
    turn,
    provider: 'example-provider',
    model: 'example-model',
  });

  assert.equal(envelope.contracts.side_effects_require_tool_runtime, true);
  assert.equal(envelope.contracts.transport_is_not_policy_authority, true);
});

test('tool outcomes are recorded as bounded explicit history', () => {
  const session = createAgentSession({ id: 'run-4', goal: 'Use a controlled tool' });
  const updated = recordToolOutcome(session, {
    request_key: 'repo.read:1',
    tool_id: 'repo.read',
    status: 'complete',
    result_summary: 'README inspected',
  });

  assert.equal(updated.history.at(-1).status, 'COMPLETE');
  assert.equal(updated.history.at(-1).request_key, 'repo.read:1');
});
