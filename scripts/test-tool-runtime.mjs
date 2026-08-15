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
