import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validatePublicHttpUrl,
  normalizeCrawlUrls,
  buildCrawl4aiRequest,
  compactCrawl4aiResult,
  capabilityRequiresOwnerApproval,
  sanitizeProviderError,
} from '../../runtime/capability-providers.mjs';

const registry = {
  capabilities: [
    { id: 'WEB_EVIDENCE', ownerGate: false, defaultRiskClass: 'LOW' },
    { id: 'WEB_OPERATOR', ownerGate: true, defaultRiskClass: 'HIGH' },
    { id: 'DEVELOPMENT_WORKSPACE', ownerGate: true, defaultRiskClass: 'HIGH' },
  ],
};

test('public web URL accepts ordinary HTTPS and strips fragment', () => {
  const result = validatePublicHttpUrl('https://example.com/a?b=1#frag');
  assert.equal(result.ok, true);
  assert.equal(result.url, 'https://example.com/a?b=1');
});

test('web evidence rejects local/private/link-local destinations', () => {
  for (const url of [
    'http://localhost:8080',
    'http://127.0.0.1',
    'http://10.0.0.1',
    'http://172.16.4.2',
    'http://192.168.1.10',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/',
    'http://service.internal/',
    'file:///etc/passwd',
  ]) {
    assert.equal(validatePublicHttpUrl(url).ok, false, url);
  }
});

test('crawl URL list is bounded and deduplicated', () => {
  const okay = normalizeCrawlUrls(['https://example.com', 'https://example.com'], 8);
  assert.equal(okay.ok, true);
  assert.equal(okay.urls.length, 1);
  const tooMany = normalizeCrawlUrls(Array.from({ length: 9 }, (_, i) => `https://example.com/${i}`), 8);
  assert.deepEqual(tooMany, { ok: false, code: 'TOO_MANY_URLS' });
});

test('Crawl4AI request never carries agent hooks, scripts or browser credentials', () => {
  const request = buildCrawl4aiRequest({ urls: ['https://example.com'], include_external_links: false }, { security: { maxUrlsPerRequest: 8 } });
  assert.equal(request.ok, true);
  assert.deepEqual(request.body.browser_config, {});
  assert.equal('hooks' in request.body, false);
  assert.equal('scripts' in request.body, false);
  assert.equal(request.body.crawler_config.process_iframes, false);
  assert.equal(request.body.crawler_config.screenshot, false);
  assert.equal(request.body.crawler_config.pdf, false);
});

test('Crawl4AI result is bounded and keeps evidence provenance fields', () => {
  const result = compactCrawl4aiResult({ results: [{ url: 'https://example.com', success: true, metadata: { title: 'Example' }, markdown: { fit_markdown: 'x'.repeat(50000) }, links: {} }] }, 4000);
  const serialized = JSON.stringify(result);
  assert.ok(serialized.length <= 4300);
  assert.match(serialized, /crawl4ai/);
});

test('browser and development workspace always require owner approval', () => {
  assert.equal(capabilityRequiresOwnerApproval(registry, 'WEB_EVIDENCE'), false);
  assert.equal(capabilityRequiresOwnerApproval(registry, 'WEB_OPERATOR'), true);
  assert.equal(capabilityRequiresOwnerApproval(registry, 'DEVELOPMENT_WORKSPACE'), true);
  assert.equal(capabilityRequiresOwnerApproval(registry, 'UNKNOWN'), true);
});

test('provider errors redact secret-like environment values', () => {
  const text = sanitizeProviderError(new Error('failed token=S3CRET-ABC'), { CRAWL4AI_API_TOKEN: 'S3CRET-ABC' });
  assert.doesNotMatch(text, /S3CRET-ABC/);
  assert.match(text, /REDACTED/);
});
