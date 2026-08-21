#!/usr/bin/env node
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { selectProviderChampion, contextualArena } from '../runtime/provider-evolution.mjs';

const registry = JSON.parse(await fs.readFile('registry/provider-evolution.json', 'utf8'));
const brokerUrl = process.env.FACTORY_PROVIDER_EVOLUTION_BROKER_URL || 'https://hgivyjjethjwswjrvroy.supabase.co/functions/v1/ai-factory-provider-evolution';
const capabilityId = process.env.PROVIDER_BENCHMARK_CAPABILITY || 'WEB_EVIDENCE';
const contextKey = process.env.PROVIDER_BENCHMARK_CONTEXT || 'public-static-html';
const arena = contextualArena(registry, capabilityId, contextKey);
if (!arena) throw new Error(`Unknown provider arena ${capabilityId}/${contextKey}`);
const benchmarkKey = `${process.env.GITHUB_SHA || 'local'}:${process.env.GITHUB_RUN_ID || crypto.randomUUID()}:${capabilityId}:${contextKey}`;
const cases = [
  { key: 'example-com', url: 'https://example.com/', expectedTitle: 'Example Domain', expectedPhrase: 'illustrative examples' },
  { key: 'example-org', url: 'https://example.org/', expectedTitle: 'Example Domain', expectedPhrase: 'illustrative examples' },
  { key: 'example-net', url: 'https://example.net/', expectedTitle: 'Example Domain', expectedPhrase: 'illustrative examples' }
];
const providerIds = ['crawl4ai', 'native-fetch'];
let crawl = null;

process.on('exit', cleanup);
process.on('SIGTERM', () => { cleanup(); process.exit(143); });
process.on('SIGINT', () => { cleanup(); process.exit(130); });

const benchmark = (await broker('start_benchmark', { capability_id: capabilityId, context_key: contextKey, benchmark_key: benchmarkKey, record: { cases: cases.map(({ key, url }) => ({ key, url })), providers: providerIds, mode: 'hosted-control' } })).benchmark;
const currentRoute = await broker('route', { capability_id: capabilityId, context_key: contextKey });
const currentChampion = currentRoute?.champion?.provider_id || arena.context.incumbent || null;
const allTrials = [];
let fatal = null;
try {
  for (const providerId of providerIds) {
    for (const item of cases) {
      const row = await benchmarkCase(providerId, item);
      allTrials.push(row);
      console.log(JSON.stringify({ event: 'provider_trial', capability: capabilityId, context: contextKey, provider: providerId, case: item.key, outcome: row.outcome, latency_ms: row.raw_metrics.latency_ms, correctness: row.scores.correctness }));
    }
  }

  await broker('record_trials', { benchmark_id: benchmark.id, records: allTrials });
  const selection = selectProviderChampion(allTrials, { currentChampion, policy: registry.selection });
  if (!selection.selected) throw new Error('No eligible provider champion');
  const selectedProvider = (arena.providers || []).find((x) => x.id === selection.selected.provider_id);
  if (!selectedProvider?.productionReady) throw new Error(`Selected provider not production ready: ${selection.selected.provider_id}`);
  if (arena.context.routing !== 'production') throw new Error(`Benchmark context is shadow-only: ${contextKey}`);

  await broker('set_champion', { benchmark_id: benchmark.id, capability_id: capabilityId, context_key: contextKey, provider_id: selection.selected.provider_id, record: { scores: selection.selected.scores, utility: selection.selected.utility, pass_rate: selection.selected.pass_rate, trial_count: selection.selected.trial_count, pareto_front: selection.pareto_front, previous_champion: currentChampion, changed: selection.changed, authority_expanded: false } });
  await broker('complete_benchmark', { benchmark_id: benchmark.id, record: { status: 'COMPLETE' } });
  const snapshot = await broker('snapshot', { benchmark_id: benchmark.id });
  await fs.mkdir('artifacts', { recursive: true });
  await fs.writeFile('artifacts/provider-evolution.json', JSON.stringify({ generated_at: new Date().toISOString(), capability_id: capabilityId, context_key: contextKey, benchmark_id: benchmark.id, selected: selection.selected, previous_champion: currentChampion, changed: selection.changed, pareto_front: selection.pareto_front, snapshot }, null, 2));
  console.log(JSON.stringify({ event: 'provider_benchmark_complete', benchmark_id: benchmark.id, capability: capabilityId, context: contextKey, champion: selection.selected.provider_id, previous_champion: currentChampion, changed: selection.changed }));
} catch (error) {
  fatal = error;
  try { await broker('complete_benchmark', { benchmark_id: benchmark.id, record: { status: 'FAILED' } }); } catch {}
  throw error;
} finally {
  cleanup();
  if (fatal) console.error(JSON.stringify({ event: 'provider_benchmark_failed', error: safe(fatal) }));
}

async function benchmarkCase(providerId, item) {
  const started = performance.now();
  try {
    const result = providerId === 'native-fetch' ? await nativeFetch(item.url) : await crawl4ai(item.url);
    const latencyMs = Math.max(1, Math.round(performance.now() - started));
    const titleOk = String(result.title || '').trim().toLowerCase() === item.expectedTitle.toLowerCase();
    const phraseOk = String(result.text || '').toLowerCase().includes(item.expectedPhrase.toLowerCase());
    const urlOk = sameHost(result.url || item.url, item.url);
    const success = result.success === true && result.status_code >= 200 && result.status_code < 400;
    const correctness = titleOk && phraseOk ? 100 : titleOk || phraseOk ? 70 : 0;
    const evidenceFidelity = success && urlOk ? (titleOk ? 100 : 85) : 0;
    const scores = { task_success: success ? 100 : 0, correctness, evidence_fidelity: evidenceFidelity, reliability: success ? 100 : 0, latency: latencyScore(latencyMs), cost_efficiency: providerId === 'native-fetch' ? 100 : 85, context_efficiency: contextScore(result.output_chars), observability: result.provider === providerId && result.status_code ? 100 : 75, safety_compliance: 100 };
    const outcome = success && correctness >= 80 && evidenceFidelity >= 80 ? 'PASS' : 'FAIL';
    return { capability_id: capabilityId, context_key: contextKey, provider_id: providerId, case_key: item.key, attempt: 1, outcome, scores, raw_metrics: { latency_ms: latencyMs, output_chars: result.output_chars, status_code: result.status_code }, evidence: { url: result.url || item.url, title: result.title || null, phrase_match: phraseOk, provider: providerId }, provenance: { benchmark_key: benchmarkKey, hosted_control: true } };
  } catch (error) {
    const latencyMs = Math.max(1, Math.round(performance.now() - started));
    return { capability_id: capabilityId, context_key: contextKey, provider_id: providerId, case_key: item.key, attempt: 1, outcome: 'FAIL', scores: { task_success: 0, correctness: 0, evidence_fidelity: 0, reliability: 0, latency: latencyScore(latencyMs), cost_efficiency: providerId === 'native-fetch' ? 100 : 85, context_efficiency: 0, observability: 80, safety_compliance: 100 }, raw_metrics: { latency_ms: latencyMs, error: safe(error) }, evidence: { provider: providerId, error: safe(error) }, provenance: { benchmark_key: benchmarkKey, hosted_control: true } };
  }
}

async function nativeFetch(url) {
  const response = await fetchTimeout(url, { headers: { 'user-agent': 'AI-Factory-Provider-Benchmark/1.0', accept: 'text/html,application/xhtml+xml' }, redirect: 'follow' }, 20000);
  const text = (await response.text()).slice(0, 1_000_000);
  const title = decodeEntities((text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  const body = decodeEntities(text.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  return { provider: 'native-fetch', success: response.ok, status_code: response.status, url: response.url, title, text: body.slice(0, 24000), output_chars: Math.min(body.length, 24000) };
}

async function crawl4ai(url) {
  const local = await ensureCrawl4ai();
  const response = await fetchTimeout(`${local.baseUrl}/crawl`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${local.token}` }, body: JSON.stringify({ urls: [url], browser_config: {}, crawler_config: { cache_mode: 'bypass', word_count_threshold: 1, exclude_external_links: true, exclude_social_media_links: true, remove_overlay_elements: true, process_iframes: false, screenshot: false, pdf: false } }) }, 90000);
  const payload = await response.json();
  if (!response.ok) throw new Error(`Crawl4AI ${response.status}: ${JSON.stringify(payload).slice(0, 700)}`);
  const row = Array.isArray(payload?.results) ? payload.results[0] : payload?.result || payload;
  const markdown = typeof row?.markdown === 'string' ? row.markdown : row?.markdown?.fit_markdown || row?.markdown?.raw_markdown || '';
  return { provider: 'crawl4ai', success: row?.success !== false, status_code: Number(row?.status_code || 200), url: row?.url || url, title: row?.metadata?.title || '', text: String(markdown).slice(0, 24000), output_chars: Math.min(String(markdown).length, 24000) };
}

async function ensureCrawl4ai() {
  if (crawl) return crawl;
  const docker = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8', timeout: 15000 });
  if (docker.status !== 0) throw new Error('Docker unavailable for Crawl4AI benchmark');
  const token = crypto.randomBytes(24).toString('base64url');
  const name = `factory-provider-crawl4ai-${String(process.env.GITHUB_RUN_ID || 'local').replace(/[^a-zA-Z0-9_.-]/g, '').slice(-24)}`;
  const started = spawnSync('docker', ['run','-d','--rm','--pull=missing','--name',name,'--shm-size=1g','-p','127.0.0.1:11236:11235','-e',`CRAWL4AI_API_TOKEN=${token}`,'-e','CRAWL4AI_HOOKS_ENABLED=false','-e','CRAWL4AI_EXECUTE_JS_ENABLED=false','unclecode/crawl4ai:latest'], { encoding: 'utf8', timeout: 180000, maxBuffer: 2 * 1024 * 1024 });
  if (started.status !== 0) throw new Error(`Crawl4AI start failed: ${safe(started.stderr || started.stdout)}`);
  crawl = { baseUrl: 'http://127.0.0.1:11236', token, container: name };
  for (let i = 0; i < 45; i += 1) { try { const health = await fetchTimeout(`${crawl.baseUrl}/health`, {}, 2500); if (health.ok) return crawl; } catch {} await sleep(2000); }
  throw new Error('Crawl4AI health timeout');
}

function cleanup() { if (crawl?.container) spawnSync('docker', ['rm','-f',crawl.container], { encoding: 'utf8', timeout: 30000 }); crawl = null; }
function latencyScore(ms) { if (ms <= 1000) return 100; if (ms <= 3000) return 92; if (ms <= 8000) return 82; if (ms <= 20000) return 68; if (ms <= 60000) return 50; return 30; }
function contextScore(chars) { const n = Number(chars || 0); if (n <= 8000) return 100; if (n <= 16000) return 90; if (n <= 24000) return 80; return 60; }
function sameHost(a, b) { try { return new URL(a).hostname === new URL(b).hostname; } catch { return false; } }
function decodeEntities(text) { return String(text).replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'"); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function fetchTimeout(url, options, ms) { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), ms); try { return await fetch(url, { ...options, signal: controller.signal }); } finally { clearTimeout(timer); } }
function safe(error) { return (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, ' ').slice(0, 1000); }

let oidc;
async function broker(action, payload = {}) {
  if (!oidc) oidc = await oidcToken();
  const response = await fetch(brokerUrl, { method: 'POST', headers: { authorization: `Bearer ${oidc}`, 'content-type': 'application/json' }, body: JSON.stringify({ action, ...payload }) });
  const text = await response.text(); let body; try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text.slice(0, 500) }; }
  if (!response.ok || body?.error) throw new Error(`provider broker ${action} ${response.status}: ${JSON.stringify(body).slice(0, 1200)}`);
  return body;
}
async function oidcToken() {
  const base = process.env.ACTIONS_ID_TOKEN_REQUEST_URL, token = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!base || !token) throw new Error('GitHub OIDC environment unavailable');
  const url = new URL(base); url.searchParams.set('audience', 'aifactory-provider-evolution');
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const body = await response.json(); if (!response.ok || !body.value) throw new Error(`OIDC token request failed ${response.status}`); return body.value;
}
