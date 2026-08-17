import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createNdjsonDecoder,
  encodeNdjson,
  frameAtomicRequest,
} from '../../runtime/atomic-agent-sidecar-adapter.mjs';

test('frames supported Atomic request types', () => {
  const request = frameAtomicRequest('send_message', {
    sessionId: 's1',
    text: 'hello',
  }, 'req-1');
  assert.deepEqual(request, {
    kind: 'request',
    id: 'req-1',
    type: 'send_message',
    payload: { sessionId: 's1', text: 'hello' },
  });
  assert.equal(encodeNdjson(request).endsWith('\n'), true);
});

test('rejects unsupported request types', () => {
  assert.throws(() => frameAtomicRequest('unbounded_shell', {}), /Unsupported Atomic request type/);
});

test('decodes fragmented NDJSON frames', () => {
  const messages = [];
  const errors = [];
  const decoder = createNdjsonDecoder(
    (message) => messages.push(message),
    (error, raw) => errors.push({ error, raw }),
  );

  decoder.push('{"kind":"event","type":"pong"');
  decoder.push(',"id":"1","payload":{}}\n{"kind":"response",');
  decoder.push('"id":"2","correlationId":"req-1","ok":true,"payload":{}}\n');
  decoder.flush();

  assert.equal(errors.length, 0);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].type, 'pong');
  assert.equal(messages[1].correlationId, 'req-1');
});

test('reports malformed frames without swallowing later valid frames', () => {
  const messages = [];
  const errors = [];
  const decoder = createNdjsonDecoder(
    (message) => messages.push(message),
    (error, raw) => errors.push({ error, raw }),
  );

  decoder.push('{bad json}\n{"kind":"event","type":"pong","id":"2","payload":{}}\n');

  assert.equal(errors.length, 1);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, 'pong');
});
