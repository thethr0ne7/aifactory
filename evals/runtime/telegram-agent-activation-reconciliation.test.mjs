import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileActivatedAgents } from '../../runtime/agent-activation.mjs';

const executives = new Set(['ceo','cfo','coo','cio','cmo','cro']);

test('recovers registered Telegram post authors when activated_agents is empty', () => {
  const result = reconcileActivatedAgents({
    declared: [],
    output: { telegram_posts: [
      { agent: 'ceo', text: 'one' },
      { agent: 'cfo', text: 'two' },
      { agent: 'cro', text: 'three' },
    ] },
    allowedAgentIds: executives,
    maxAgents: 3,
  });
  assert.deepEqual(result.activated_agents, ['ceo','cfo','cro']);
  assert.deepEqual(result.recovered_agents, ['ceo','cfo','cro']);
  assert.equal(result.recovered_count, 3);
});

test('never recovers unknown Telegram author', () => {
  const result = reconcileActivatedAgents({
    declared: [],
    output: { telegram_posts: [
      { agent: 'ceo', text: 'one' },
      { agent: 'invented-agent', text: 'bad' },
    ] },
    allowedAgentIds: executives,
    maxAgents: 3,
  });
  assert.deepEqual(result.activated_agents, ['ceo']);
  assert.deepEqual(result.recovered_agents, ['ceo']);
});

test('preserves declared agents first and enforces cap', () => {
  const result = reconcileActivatedAgents({
    declared: ['cio','ceo'],
    output: { telegram_posts: [
      { agent: 'cfo', text: 'one' },
      { agent: 'cro', text: 'two' },
    ] },
    allowedAgentIds: executives,
    maxAgents: 3,
  });
  assert.deepEqual(result.activated_agents, ['cio','ceo','cfo']);
  assert.deepEqual(result.recovered_agents, ['cfo']);
  assert.equal(result.max_agents, 3);
});
