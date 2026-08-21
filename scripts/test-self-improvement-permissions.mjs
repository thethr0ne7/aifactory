import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { validateReviewedRepositoryPatch } from '../runtime/self-improvement.mjs';

const policy = JSON.parse(await fs.readFile('registry/self-improvement.json', 'utf8'));
const base = {
  target_type: 'WORKFLOW_PATCH',
  target_ref: '.github/workflows/example-reviewed.yml',
  risk_class: 'LOW',
  patch: {
    path: '.github/workflows/example-reviewed.yml',
    reason: 'Regression coverage for reviewed workflow permissions.',
    content: 'name: Example\non: workflow_dispatch\npermissions:\n  contents: read\n',
  },
};

assert.equal(validateReviewedRepositoryPatch(base, policy).ok, true);
assert.equal(validateReviewedRepositoryPatch({ ...base, patch: { ...base.patch, content: 'name: Bad\npermissions: write-all\n' } }, policy).code, 'WORKFLOW_PRIVILEGE_EXPANSION_DENIED');
assert.equal(validateReviewedRepositoryPatch({ ...base, patch: { ...base.patch, content: 'name: Bad\npermissions:\n  id-token: write\n  contents: read\n' } }, policy).code, 'WORKFLOW_PRIVILEGE_EXPANSION_DENIED');
assert.equal(validateReviewedRepositoryPatch({ ...base, risk_class: 'MEDIUM' }, policy).code, 'RISK_REQUIRES_HIGHER_AUTHORITY');
console.log('Self-improvement workflow permission regression tests passed');
