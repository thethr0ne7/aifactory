#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { autonomyAtLeast, normalizeToolRequests, validateToolRequest, candidatePathDecision, normalizeRepoPath, boundToolContext } from '../runtime/tool-runtime.mjs';

const policy = JSON.parse(fs.readFileSync('registry/tool-runtime.json', 'utf8'));

assert.equal(autonomyAtLeast('A3','A3'), true);
assert.equal(autonomyAtLeast('A4','A3'), true);
assert.equal(autonomyAtLeast('A2','A3'), false);
assert.equal(autonomyAtLeast('A9','A3'), false);

const requests = normalizeToolRequests([
  { tool_id:'factory.repo.read_file', request_key:'read.skill', arguments:{path:'skills/context-governor/SKILL.md'}, reason:'need evidence' },
  { tool_id:'factory.repo.read_file', request_key:'read.skill', arguments:{path:'other'}, reason:'duplicate key' },
  { tool_id:'unknown.tool', request_key:'unknown.tool', arguments:{} },
], policy, 'A3');
assert.equal(requests.length, 1);
assert.equal(requests[0].tool_id, 'factory.repo.read_file');
assert.equal(requests[0].risk_class, 'LOW');

const deterministic = normalizeToolRequests([
  { tool_id:'factory.web.crawl', arguments:{url:'https://example.com/'}, reason:'need current web evidence' },
], policy, 'A3');
assert.equal(deterministic.length, 1);
assert.equal(deterministic[0].tool_id, 'factory.web.crawl');
assert.match(deterministic[0].request_key, /^auto:web\.crawl:[a-z0-9]+$/);

const invalidProvidedKeyFallsBack = normalizeToolRequests([
  { tool_id:'factory.web.crawl', request_key:'INVALID KEY WITH SPACES', arguments:{url:'https://example.com/'}, reason:'same evidence' },
], policy, 'A3');
assert.equal(invalidProvidedKeyFallsBack.length, 1);
assert.equal(invalidProvidedKeyFallsBack[0].request_key, deterministic[0].request_key);

const toolAliasAndArgs = normalizeToolRequests({
  tool:'factory.web.crawl',
  args:{url:'https://example.org/'},
  why:'bounded schema recovery'
}, policy, 'A3');
assert.equal(toolAliasAndArgs.length, 1);
assert.equal(toolAliasAndArgs[0].tool_id, 'factory.web.crawl');
assert.deepEqual(toolAliasAndArgs[0].arguments, {url:'https://example.org/'});

const capabilityRecovery = normalizeToolRequests([
  { capability:'WEB_EVIDENCE', url:'https://example.net/', reason:'single canonical auto tool for capability' },
], policy, 'A3');
assert.equal(capabilityRecovery.length, 1);
assert.equal(capabilityRecovery[0].tool_id, 'factory.web.crawl');
assert.deepEqual(capabilityRecovery[0].arguments, {url:'https://example.net/'});

const jsonStringRecovery = normalizeToolRequests(JSON.stringify({
  toolId:'factory.web.crawl', params:{url:'https://iana.org/'}
}), policy, 'A3');
assert.equal(jsonStringRecovery.length, 1);
assert.equal(jsonStringRecovery[0].tool_id, 'factory.web.crawl');
assert.deepEqual(jsonStringRecovery[0].arguments, {url:'https://iana.org/'});

const ownerGatedCannotRecoverByCapability = normalizeToolRequests([
  { capability:'WEB_OPERATOR', task:'submit a form' },
], policy, 'A3');
assert.equal(ownerGatedCannotRecoverByCapability.length, 0);

const semanticDuplicateBlocked = normalizeToolRequests([
  { tool_id:'factory.web.crawl', arguments:{url:'https://example.com/'} },
], policy, 'A3', {
  known_request_keys: [],
  known_request_fingerprints: [deterministic[0].request_fingerprint],
  requests: [],
  request_index: [],
});
assert.equal(semanticDuplicateBlocked.length, 0);

const deniedByAutonomy = normalizeToolRequests([
  { tool_id:'factory.repo.read_file', request_key:'read.low', arguments:{path:'README.md'} },
], policy, 'A2');
assert.equal(deniedByAutonomy.length, 0);

const readSpec = policy.tools.find((x) => x.id === 'factory.repo.read_file');
assert.equal(validateToolRequest({tool_id:readSpec.id,risk_class:'LOW',required_autonomy:'A3'}, policy, 'A3').ok, true);
assert.equal(validateToolRequest({tool_id:readSpec.id,risk_class:'MEDIUM',required_autonomy:'A3'}, policy, 'A3').code, 'RISK_CLASS_MISMATCH');

const writeSpec = policy.tools.find((x) => x.id === 'factory.repo.candidate_write');
assert.deepEqual(candidatePathDecision('skills/example/SKILL.md', writeSpec), {ok:true,path:'skills/example/SKILL.md'});
assert.equal(candidatePathDecision('docs/tool-note.md', writeSpec).ok, true);
assert.equal(candidatePathDecision('evals/case.json', writeSpec).ok, true);
assert.equal(candidatePathDecision('runtime/self-improvement.mjs', writeSpec).ok, false);
assert.equal(candidatePathDecision('.github/workflows/factory-validation.yml', writeSpec).ok, false);
assert.equal(candidatePathDecision('registry/factory-constitution.json', writeSpec).ok, false);
assert.equal(candidatePathDecision('../AGENTS.md', writeSpec).ok, false);
assert.equal(normalizeRepoPath('/etc/passwd'), null);
assert.equal(normalizeRepoPath('skills/../runtime/x.mjs'), 'runtime/x.mjs');
assert.equal(candidatePathDecision('skills/../runtime/x.mjs', writeSpec).ok, false);

const bounded = boundToolContext({requests:[
  {id:'1',tool_id:'factory.repo.read_file',request_key:'a',status:'EXECUTED',result:{content:'abc'}},
  {id:'2',tool_id:'factory.repo.read_file',request_key:'b',status:'EXECUTED',result:{content:'x'.repeat(5000)}},
]}, 500);
assert.equal(bounded.requests.length, 1);

console.log('Controlled tool runtime tests OK');
