#!/usr/bin/env node

import assert from 'node:assert/strict';
import { selectExecutableMemory, executableMemoryRefs } from '../runtime/executable-memory.mjs';

const task = {
  objective: 'Review a Root of Trust change after a provider lifecycle incident and preserve evidence provenance.',
  kind: 'policy-review',
  payload: { area: 'provider lifecycle' },
};

const raw = {
  lessons: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      status: 'CANDIDATE',
      lesson_class: 'POLICY_CANDIDATE',
      statement: 'Provider lifecycle smoke evidence must be attached before autonomous activation claims.',
      generalization: { scope: 'provider lifecycle verification' },
      created_at: '2026-08-15T10:00:00Z',
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      status: 'CANDIDATE',
      lesson_class: 'PATTERN',
      statement: 'A completely unrelated visual spacing observation.',
      created_at: '2026-08-15T10:01:00Z',
    },
    {
      id: '33333333-3333-4333-8333-333333333333',
      status: 'SUPERSEDED',
      lesson_class: 'POLICY_CANDIDATE',
      statement: 'Root of Trust changes once used a weaker approval shortcut.',
      created_at: '2026-08-14T10:00:00Z',
    },
    {
      id: '44444444-4444-4444-8444-444444444444',
      status: 'PROMOTED',
      lesson_class: 'PATTERN',
      statement: 'Always preserve durable provenance for learned decisions.',
      created_at: '2026-08-13T10:00:00Z',
    },
  ],
  incidents: [
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      severity: 'FORBIDDEN',
      status: 'OPEN',
      summary: 'Provider lifecycle was not verified before declaring autonomy.',
      affected_invariants: ['provider-lifecycle-validation'],
      created_at: '2026-08-15T11:00:00Z',
    },
    {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      severity: 'UNDESIRABLE',
      status: 'RESOLVED',
      summary: 'Unrelated typography regression.',
      created_at: '2026-08-15T11:01:00Z',
    },
  ],
};

const selected = selectExecutableMemory(task, raw, { maxLessons: 8, maxIncidents: 6, maxSerializedCharacters: 18000 });
const refs = executableMemoryRefs(selected);

assert(refs.lesson_ids.includes('11111111-1111-4111-8111-111111111111'), 'relevant candidate lesson must be selected');
assert(refs.lesson_ids.includes('33333333-3333-4333-8333-333333333333'), 'relevant superseded lesson must remain visible as inactive history');
assert(refs.lesson_ids.includes('44444444-4444-4444-8444-444444444444'), 'promoted guidance must be available');
assert(!refs.lesson_ids.includes('22222222-2222-4222-8222-222222222222'), 'irrelevant candidate must not pollute context');
assert(refs.incident_ids.includes('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 'relevant failure incident must be selected');
assert(!refs.incident_ids.includes('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 'irrelevant resolved incident must not pollute context');

const candidate = selected.lessons.find((x) => x.id === '11111111-1111-4111-8111-111111111111');
const superseded = selected.lessons.find((x) => x.id === '33333333-3333-4333-8333-333333333333');
assert.equal(candidate.authority, 'CANDIDATE_HYPOTHESIS');
assert.equal(superseded.authority, 'SUPERSEDED_HISTORY');
assert(JSON.stringify(selected).length <= 18000, 'selection must respect context budget');

const empty = selectExecutableMemory({ objective: 'quantum orchard zeta nebula', kind: 'other', payload: {} }, { lessons: raw.lessons.filter((x) => x.status !== 'PROMOTED'), incidents: raw.incidents }, { maxSerializedCharacters: 18000 });
assert.equal(empty.lessons.length, 0, 'irrelevant non-promoted lessons must not be injected');
assert.equal(empty.incidents.length, 0, 'irrelevant non-catastrophic incidents must not be injected');

console.log('Executable memory selection tests OK');
