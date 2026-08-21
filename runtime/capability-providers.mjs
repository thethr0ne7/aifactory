import net from 'node:net';

const OWNER_GATED_CAPABILITIES = new Set(['WEB_OPERATOR', 'DEVELOPMENT_WORKSPACE']);
const SECRET_KEY_RE = /(token|secret|password|api[_-]?key|authorization|cookie)/i;

export function providerMap(registry = {}) {
  return new Map((registry.providers || []).map((provider) => [provider.id, provider]));
}

export function capabilityMap(registry = {}) {
  return new Map((registry.capabilities || []).map((capability) => [capability.id, capability]));
}

export function resolveCapabilityProvider(registry, capabilityId, env = process.env) {
  const capability = capabilityMap(registry).get(String(capabilityId || ''));
  if (!capability) return { ok: false, code: 'UNKNOWN_CAPABILITY' };
  const providers = providerMap(registry);
  const order = [capability.preferredProvider, ...(capability.fallbackProviders || [])].filter(Boolean);
  for (const id of order) {
    const provider = providers.get(id);
    if (!provider) continue;
    const baseUrl = provider.baseUrlEnv ? clean(env[provider.baseUrlEnv], 2000) : clean(provider.defaultCloudBaseUrl, 2000);
    const configured = Boolean(baseUrl || provider.transport === 'ephemeral-runner' || provider.transport === 'postgres-publication');
    if (configured) return { ok: true, capability, provider, baseUrl: baseUrl || null };
  }
  return { ok: false, code: 'PROVIDER_NOT_CONFIGURED', capability };
}

export function capabilityRequiresOwnerApproval(registry, capabilityId) {
  const capability = capabilityMap(registry).get(String(capabilityId || ''));
  if (!capability) return true;
  return capability.ownerGate === true || OWNER_GATED_CAPABILITIES.has(capability.id) || String(capability.defaultRiskClass || '').toUpperCase() !== 'LOW';
}

export function validatePublicHttpUrl(value) {
  let url;
  try { url = new URL(String(value || '')); } catch { return { ok: false, code: 'INVALID_URL' }; }
  if (!['http:', 'https:'].includes(url.protocol)) return { ok: false, code: 'URL_SCHEME_NOT_ALLOWED' };
  if (url.username || url.password) return { ok: false, code: 'URL_CREDENTIALS_NOT_ALLOWED' };
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) return { ok: false, code: 'URL_HOST_REQUIRED' };
  if (host === 'localhost' || host.endsWith('.localhost') || host === 'localhost.localdomain') return { ok: false, code: 'LOCALHOST_NOT_ALLOWED' };
  const ipVersion = net.isIP(host);
  if (ipVersion === 4 && isPrivateIpv4(host)) return { ok: false, code: 'PRIVATE_ADDRESS_NOT_ALLOWED' };
  if (ipVersion === 6 && isPrivateIpv6(host)) return { ok: false, code: 'PRIVATE_ADDRESS_NOT_ALLOWED' };
  if (!ipVersion && (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.home.arpa'))) return { ok: false, code: 'PRIVATE_HOSTNAME_NOT_ALLOWED' };
  url.hash = '';
  return { ok: true, url: url.toString() };
}

export function normalizeCrawlUrls(args = {}, maxUrls = 8) {
  const source = Array.isArray(args.urls) ? args.urls : args.url ? [args.url] : [];
  if (!source.length) return { ok: false, code: 'URL_REQUIRED' };
  if (source.length > maxUrls) return { ok: false, code: 'TOO_MANY_URLS' };
  const urls = [];
  for (const value of source) {
    const checked = validatePublicHttpUrl(value);
    if (!checked.ok) return checked;
    if (!urls.includes(checked.url)) urls.push(checked.url);
  }
  return { ok: true, urls };
}

export function buildCrawl4aiRequest(args = {}, provider = {}) {
  const maximum = Math.max(1, Math.min(Number(provider?.security?.maxUrlsPerRequest) || 8, 8));
  const checked = normalizeCrawlUrls(args, maximum);
  if (!checked.ok) return checked;
  const cacheMode = ['enabled', 'bypass', 'read_only', 'write_only'].includes(String(args.cache_mode || '').toLowerCase())
    ? String(args.cache_mode).toLowerCase()
    : 'enabled';
  return {
    ok: true,
    body: {
      urls: checked.urls,
      browser_config: {},
      crawler_config: {
        cache_mode: cacheMode,
        word_count_threshold: Math.max(1, Math.min(Number(args.word_count_threshold) || 10, 1000)),
        exclude_external_links: args.include_external_links === true ? false : true,
        exclude_social_media_links: true,
        remove_overlay_elements: true,
        process_iframes: false,
        screenshot: false,
        pdf: false
      }
    }
  };
}

export function compactCrawl4aiResult(payload, maxChars = 24000) {
  const root = object(payload);
  const rows = Array.isArray(root.results) ? root.results : Array.isArray(payload) ? payload : root.result ? [root.result] : [];
  const output = rows.slice(0, 8).map((row) => {
    const item = object(row);
    const markdown = extractMarkdown(item.markdown);
    return {
      url: clean(item.url || item.redirected_url, 2000) || null,
      success: item.success !== false,
      status_code: Number.isFinite(Number(item.status_code)) ? Number(item.status_code) : null,
      title: clean(object(item.metadata).title, 500) || null,
      description: clean(object(item.metadata).description, 1200) || null,
      markdown: clean(markdown, Math.max(1000, Math.floor(maxChars / Math.max(1, rows.length)))),
      links: compactLinks(item.links),
      error: clean(item.error_message || item.error, 1500) || null
    };
  });
  return boundJson({ provider: 'crawl4ai', count: output.length, results: output }, maxChars);
}

export function sanitizeProviderError(error, env = process.env) {
  let text = error instanceof Error ? error.message : String(error ?? 'provider_error');
  for (const [key, value] of Object.entries(env)) {
    if (!SECRET_KEY_RE.test(key) || !value || String(value).length < 6) continue;
    text = text.split(String(value)).join('[REDACTED]');
  }
  return clean(text, 1800);
}

export function assertRepositoryPdfPath(value, normalizePath) {
  const path = normalizePath(value);
  if (!path) return { ok: false, code: 'INVALID_PATH' };
  if (!path.toLowerCase().endsWith('.pdf')) return { ok: false, code: 'PDF_REQUIRED', path };
  return { ok: true, path };
}

export function boundJson(value, maxChars) {
  const limit = Math.max(500, Number(maxChars) || 24000);
  const text = JSON.stringify(value ?? {});
  if (text.length <= limit) return value ?? {};
  return { truncated: true, preview: text.slice(0, limit), original_characters: text.length };
}

function compactLinks(value) {
  const links = object(value);
  const internal = Array.isArray(links.internal) ? links.internal : [];
  const external = Array.isArray(links.external) ? links.external : [];
  const pick = (arr) => arr.slice(0, 30).map((x) => {
    const item = object(x);
    return { href: clean(item.href, 1600), text: clean(item.text, 300) };
  }).filter((x) => x.href);
  return { internal: pick(internal), external: pick(external) };
}

function extractMarkdown(value) {
  if (typeof value === 'string') return value;
  const md = object(value);
  return md.fit_markdown || md.raw_markdown || md.markdown_with_citations || '';
}

function isPrivateIpv4(host) {
  const p = host.split('.').map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return true;
  const [a,b] = p;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 0) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}

function isPrivateIpv6(host) {
  const h = host.toLowerCase();
  return h === '::' || h === '::1' || h.startsWith('fe8') || h.startsWith('fe9') || h.startsWith('fea') || h.startsWith('feb') || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('ff') || h.startsWith('::ffff:127.') || h.startsWith('::ffff:10.') || h.startsWith('::ffff:192.168.');
}

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function clean(value, max) { return String(value ?? '').replace(/[\u0000\r]+/g, ' ').trim().slice(0, max); }
