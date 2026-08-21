#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { validateToolRequest, candidatePathDecision, normalizeRepoPath } from '../runtime/tool-runtime.mjs';
import {
  resolveCapabilityProvider,
  buildCrawl4aiRequest,
  compactCrawl4aiResult,
  sanitizeProviderError,
  assertRepositoryPdfPath,
} from '../runtime/capability-providers.mjs';

const root = process.cwd();
const brokerUrl = process.env.FACTORY_BROKER_URL || 'https://hgivyjjethjwswjrvroy.supabase.co/functions/v1/ai-factory-broker';
const audience = 'aifactory-supabase-runtime';
const runId = process.env.GITHUB_RUN_ID || 'local';
const workerId = `github-actions:tool:${runId}:${process.env.GITHUB_RUN_ATTEMPT || '1'}`;
const repo = 'thethr0ne7/aifactory';
const policy = JSON.parse(fs.readFileSync(path.join(root, 'registry/tool-runtime.json'), 'utf8'));
const providers = JSON.parse(fs.readFileSync(path.join(root, 'registry/capability-providers.json'), 'utf8'));
const maxBatch = Math.max(1, Math.min(Number(process.env.FACTORY_TOOL_BATCH_SIZE) || 6, 8));
let localCrawl4ai = null;

if (!process.env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN is required');
const oidcToken = await getOidcToken(audience);

process.on('exit', () => cleanupLocalProviders());
process.on('SIGTERM', () => { cleanupLocalProviders(); process.exit(143); });
process.on('SIGINT', () => { cleanupLocalProviders(); process.exit(130); });

await broker('tool_recover', { stale_minutes: Number(policy.executor?.staleClaimMinutes) || 20 });

let processed = 0;
let failed = 0;
let candidateWriteSeen = false;

while (processed < maxBatch && !candidateWriteSeen) {
  const claimed = await broker('tool_claim', { worker_id: workerId });
  if (!claimed.request) break;

  const request = claimed.request;
  console.log(`AI Factory Tool Runtime: claimed request=${request.id} tool=${request.tool_id}`);

  let status = 'FAILED';
  let result = {};
  let error = null;
  let evidenceClass = 'OBSERVED';

  try {
    const decision = validateToolRequest(request, policy, request.requested_autonomy);
    if (!decision.ok) {
      status = 'DENIED';
      evidenceClass = 'BLOCKER';
      error = { code: decision.code, tool_id: request.tool_id };
    } else {
      result = await executeTool(request, decision.spec);
      if (result?.denied === true) {
        status = 'DENIED';
        evidenceClass = 'BLOCKER';
        error = { code: String(result.code || 'TOOL_POLICY_DENIED'), tool_id: request.tool_id, detail: result.detail || null };
      } else {
        status = 'EXECUTED';
        evidenceClass = allowedEvidenceClass(result?.evidence_class) || (request.tool_id.startsWith('factory.repo.') ? 'CONFIRMED' : 'OBSERVED');
      }
    }
  } catch (err) {
    status = 'FAILED';
    evidenceClass = 'BLOCKER';
    error = { code: 'TOOL_EXECUTION_FAILED', message: sanitizeProviderError(err) };
  }

  await broker('tool_finish', {
    request_id: request.id,
    status,
    result: boundObject(result, 30000),
    error,
    evidence_class: evidenceClass,
  });

  processed += 1;
  if (status === 'FAILED') failed += 1;
  candidateWriteSeen = request.tool_id === 'factory.repo.candidate_write';
  console.log(`AI Factory Tool Runtime: ${status} request=${request.id}`);
}

cleanupLocalProviders();
if (processed === 0) console.log('AI Factory Tool Runtime: queue empty');
else console.log(`AI Factory Tool Runtime: batch complete processed=${processed} failed=${failed} max_batch=${maxBatch}`);
if (failed > 0) process.exitCode = 1;

async function executeTool(request, spec) {
  const args = object(request.arguments);
  switch (request.tool_id) {
    case 'factory.repo.read_file': return readFileTool(args);
    case 'factory.repo.list_files': return listFilesTool(args);
    case 'factory.repo.run_validation': return validationTool(args);
    case 'factory.repo.candidate_write': return candidateWriteTool(request, args, spec);
    case 'factory.web.crawl': return crawl4aiTool(args);
    case 'factory.document.ocr': return stirlingOcrTool(args);
    default: throw new Error('unknown allowlisted tool');
  }
}

function readFileTool(args) {
  const rel = normalizeRepoPath(args.path);
  if (!rel) return deny('INVALID_PATH');
  const full = path.join(root, rel);
  ensureInsideRoot(full);
  const maxChars = Math.max(100, Math.min(Number(args.max_chars) || 12000, 20000));
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return { exists: false, path: rel };
  const tracked = git(['ls-files', '--error-unmatch', '--', rel], { allowFailure: true });
  if (tracked.status !== 0) return deny('FILE_NOT_TRACKED', { path: rel });
  const content = fs.readFileSync(full, 'utf8');
  const blob = git(['rev-parse', `HEAD:${rel}`]);
  return {
    exists: true,
    path: rel,
    git_blob_sha: blob.stdout.trim(),
    sha256: crypto.createHash('sha256').update(content).digest('hex'),
    truncated: content.length > maxChars,
    content: content.slice(0, maxChars),
  };
}

function listFilesTool(args) {
  const prefixRaw = String(args.prefix || '').trim();
  const prefix = prefixRaw ? normalizeRepoPath(prefixRaw) : '';
  if (prefixRaw && !prefix) return deny('INVALID_PREFIX');
  const limit = Math.max(1, Math.min(Number(args.limit) || 100, 300));
  const command = prefix ? ['ls-files', '--', prefix] : ['ls-files'];
  const out = git(command);
  const files = out.stdout.split(/\r?\n/).map((x) => x.trim()).filter(Boolean).slice(0, limit);
  return { prefix: prefix || null, count: files.length, limit, files };
}

function validationTool(args) {
  const suite = String(args.suite || 'all');
  const suites = {
    factory: ['scripts/validate-factory.js'],
    autonomous: ['scripts/validate-autonomous-runtime.js'],
    'self-improvement': ['scripts/validate-self-improvement.js'],
    'tool-runtime': ['scripts/validate-tool-runtime.js'],
    all: ['scripts/validate-factory.js','scripts/validate-autonomous-runtime.js','scripts/validate-self-improvement.js','scripts/validate-tool-runtime.js'],
  };
  const scripts = suites[suite];
  if (!scripts) return deny('INVALID_VALIDATION_SUITE');
  const runs = scripts.map((script) => {
    const child = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 180000 });
    return { script, exit_code: child.status, stdout: clip(child.stdout, 5000), stderr: clip(child.stderr, 5000) };
  });
  return { suite, passed: runs.every((x) => x.exit_code === 0), runs };
}

async function crawl4aiTool(args) {
  rejectKeys(args, ['hooks','execute_js','scripts','cookies','proxy','browser_config','crawler_config','webhook_url']);
  const provider = providerById('crawl4ai');
  const prepared = buildCrawl4aiRequest(args, provider);
  if (!prepared.ok) return deny(prepared.code);

  let endpoint = clean(process.env.CRAWL4AI_BASE_URL, 2000);
  let token = clean(process.env.CRAWL4AI_API_TOKEN, 2000);
  let mode = 'configured-service';
  if (!endpoint) {
    const local = await ensureLocalCrawl4ai();
    if (!local.ok) return deny(local.code, { detail: local.detail });
    endpoint = local.baseUrl;
    token = local.token;
    mode = 'ephemeral-github-runner';
  }

  const response = await fetchWithTimeout(joinUrl(endpoint, '/crawl'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(prepared.body),
  }, 90000);
  const text = await response.text();
  if (!response.ok) throw new Error(`Crawl4AI ${response.status}: ${clip(text, 1000)}`);
  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error('Crawl4AI returned non-JSON output'); }
  return {
    evidence_class: 'OBSERVED',
    capability: 'WEB_EVIDENCE',
    provider: 'crawl4ai',
    provider_mode: mode,
    ...compactCrawl4aiResult(payload, Number(provider?.security?.maxResultCharacters) || 24000),
  };
}

async function stirlingOcrTool(args) {
  const checked = assertRepositoryPdfPath(args.path, normalizeRepoPath);
  if (!checked.ok) return deny(checked.code, checked);
  const rel = checked.path;
  const full = path.join(root, rel);
  ensureInsideRoot(full);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return deny('FILE_NOT_FOUND', { path: rel });
  if (git(['ls-files', '--error-unmatch', '--', rel], { allowFailure: true }).status !== 0) return deny('FILE_NOT_TRACKED', { path: rel });
  const stat = fs.statSync(full);
  if (stat.size > 20_000_000) return deny('PDF_TOO_LARGE', { bytes: stat.size, max_bytes: 20_000_000 });

  const resolved = resolveCapabilityProvider(providers, 'DOCUMENT_ENGINE');
  if (!resolved.ok || resolved.provider?.id !== 'stirling-pdf' || !resolved.baseUrl) {
    return deny('PROVIDER_NOT_CONFIGURED', { detail: 'Set STIRLING_PDF_BASE_URL for the self-hosted Stirling PDF service.' });
  }

  const languages = normalizeOcrLanguages(args.languages);
  if (!languages.length) return deny('OCR_LANGUAGE_INVALID');
  const ocrType = ['skip-text','force-ocr','Normal'].includes(String(args.ocr_type || 'skip-text')) ? String(args.ocr_type || 'skip-text') : 'skip-text';
  const form = new FormData();
  const bytes = fs.readFileSync(full);
  form.append('fileInput', new Blob([bytes], { type: 'application/pdf' }), path.basename(rel));
  for (const lang of languages) form.append('languages', lang);
  form.append('sidecar', 'true');
  form.append('deskew', String(args.deskew !== false));
  form.append('clean', String(args.clean === true));
  form.append('cleanFinal', 'false');
  form.append('ocrType', ocrType);
  form.append('ocrRenderType', 'hocr');
  form.append('removeImagesAfter', 'false');

  const apiKey = clean(process.env.STIRLING_PDF_API_KEY, 2000);
  const response = await fetchWithTimeout(joinUrl(resolved.baseUrl, '/api/v1/misc/ocr-pdf'), {
    method: 'POST',
    headers: apiKey ? { 'X-API-KEY': apiKey } : {},
    body: form,
  }, 180000);
  if (!response.ok) throw new Error(`Stirling PDF OCR ${response.status}: ${clip(await response.text(), 1000)}`);
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > 30_000_000) return deny('OCR_OUTPUT_TOO_LARGE', { bytes: contentLength });
  const out = Buffer.from(await response.arrayBuffer());
  if (out.length > 30_000_000) return deny('OCR_OUTPUT_TOO_LARGE', { bytes: out.length });

  const temp = path.join(os.tmpdir(), `factory-ocr-${crypto.randomUUID()}.zip`);
  fs.writeFileSync(temp, out);
  let text = '';
  try {
    const unzip = spawnSync('unzip', ['-p', temp, '*.txt'], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 30000 });
    if (unzip.status === 0) text = String(unzip.stdout || '');
  } finally {
    fs.rmSync(temp, { force: true });
  }

  return {
    evidence_class: 'OBSERVED',
    capability: 'DOCUMENT_ENGINE',
    provider: 'stirling-pdf',
    path: rel,
    input_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    input_bytes: bytes.length,
    output_bytes: out.length,
    languages,
    ocr_type: ocrType,
    text: clip(text, 24000),
    text_truncated: text.length > 24000,
  };
}

async function ensureLocalCrawl4ai() {
  if (localCrawl4ai) return { ok: true, ...localCrawl4ai };
  if (process.env.FACTORY_EPHEMERAL_CRAWL4AI === 'false') return { ok: false, code: 'PROVIDER_NOT_CONFIGURED', detail: 'CRAWL4AI_BASE_URL is not set and ephemeral provider is disabled.' };
  const docker = spawnSync('docker', ['version','--format','{{.Server.Version}}'], { encoding: 'utf8', timeout: 15000 });
  if (docker.status !== 0) return { ok: false, code: 'EPHEMERAL_PROVIDER_UNAVAILABLE', detail: 'Docker is unavailable on this executor.' };
  const token = crypto.randomBytes(24).toString('base64url');
  const name = `factory-crawl4ai-${String(runId).replace(/[^a-zA-Z0-9_.-]/g,'').slice(-24) || 'local'}`;
  const args = [
    'run','-d','--rm','--pull=missing','--name',name,'--shm-size=1g',
    '-p','127.0.0.1:11235:11235',
    '-e',`CRAWL4AI_API_TOKEN=${token}`,
    '-e','CRAWL4AI_HOOKS_ENABLED=false',
    '-e','CRAWL4AI_EXECUTE_JS_ENABLED=false',
    'unclecode/crawl4ai:latest'
  ];
  const started = spawnSync('docker', args, { encoding: 'utf8', timeout: 180000, maxBuffer: 2 * 1024 * 1024 });
  if (started.status !== 0) return { ok: false, code: 'EPHEMERAL_PROVIDER_START_FAILED', detail: clip(started.stderr || started.stdout, 1000) };
  localCrawl4ai = { baseUrl: 'http://127.0.0.1:11235', token, container: name };
  try {
    for (let i = 0; i < 45; i += 1) {
      try {
        const health = await fetchWithTimeout('http://127.0.0.1:11235/health', {}, 2500);
        if (health.ok) return { ok: true, ...localCrawl4ai };
      } catch {}
      await sleep(2000);
    }
    throw new Error('health timeout');
  } catch (error) {
    cleanupLocalProviders();
    return { ok: false, code: 'EPHEMERAL_PROVIDER_HEALTH_FAILED', detail: sanitizeProviderError(error) };
  }
}

function cleanupLocalProviders() {
  if (!localCrawl4ai?.container) return;
  spawnSync('docker', ['rm','-f',localCrawl4ai.container], { encoding: 'utf8', timeout: 30000 });
  localCrawl4ai = null;
}

async function candidateWriteTool(request, args, spec) {
  const pathDecision = candidatePathDecision(args.path, spec);
  if (!pathDecision.ok) return deny(pathDecision.code, pathDecision);
  const rel = pathDecision.path;
  const content = String(args.content ?? '');
  const reason = String(args.reason ?? '').trim().slice(0, 2000);
  if (!reason) return deny('REASON_REQUIRED');
  if (!content || content.length > 100000) return deny('CONTENT_SIZE_INVALID');

  const full = path.join(root, rel);
  ensureInsideRoot(full);
  const existing = fs.existsSync(full) && fs.statSync(full).isFile();
  let currentBlob = null;
  if (existing) {
    const tracked = git(['ls-files', '--error-unmatch', '--', rel], { allowFailure: true });
    if (tracked.status !== 0) return deny('EXISTING_FILE_NOT_TRACKED', { path: rel });
    currentBlob = git(['rev-parse', `HEAD:${rel}`]).stdout.trim();
    const expected = String(args.expected_blob_sha || '').trim();
    if (!expected) return deny('EXPECTED_BLOB_SHA_REQUIRED', { path: rel, current_blob_sha: currentBlob });
    if (expected !== currentBlob) return deny('STALE_FILE_VERSION', { path: rel, expected_blob_sha: expected, current_blob_sha: currentBlob });
  } else if (args.expected_blob_sha) return deny('EXPECTED_BLOB_SHA_FOR_NEW_FILE');

  const branch = `factory/tool-${String(request.id).slice(0, 8)}`;
  const branchExists = git(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { allowFailure: true }).status === 0;
  if (branchExists) git(['branch', '-D', branch]);
  git(['switch', '-c', branch]);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  git(['add', '--', rel]);
  const changed = git(['diff', '--cached', '--name-only']).stdout.split(/\r?\n/).filter(Boolean);
  if (changed.length !== 1 || changed[0] !== rel) throw new Error('candidate write escaped single-file boundary');
  if (!git(['diff', '--cached', '--quiet'], { allowFailure: true }).status) return deny('NO_CHANGE', { path: rel });

  const validations = validationTool({ suite: 'all' });
  if (!validations.passed) return deny('VALIDATION_FAILED', { path: rel, validations });
  git(['config', 'user.name', 'AI Factory Tool Runtime']);
  git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
  git(['commit', '-m', `chore(factory): candidate tool change ${String(request.id).slice(0, 8)}`]);
  const commitSha = git(['rev-parse', 'HEAD']).stdout.trim();
  git(['push', '--set-upstream', 'origin', branch]);
  const pr = await openPullRequestBestEffort(branch, rel, reason, request.id);
  return { path: rel, previous_blob_sha: currentBlob, branch, commit_sha: commitSha, candidate_branch_ready: true, review_artifact_status: pr.status === 'OPEN' ? 'PR_OPEN' : 'BRANCH_READY_PR_BLOCKED', pull_request: pr, validations, direct_merge: false };
}

async function openPullRequestBestEffort(branch, rel, reason, requestId) {
  const headers = { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' };
  const existingUrl = new URL(`https://api.github.com/repos/${repo}/pulls`);
  existingUrl.searchParams.set('state', 'open'); existingUrl.searchParams.set('head', `thethr0ne7:${branch}`);
  const existingResponse = await fetch(existingUrl, { headers });
  if (!existingResponse.ok) throw new Error(`GitHub PR lookup failed ${existingResponse.status}`);
  const existing = await existingResponse.json();
  if (Array.isArray(existing) && existing[0]) return { status: 'OPEN', number: existing[0].number, url: existing[0].html_url, reused: true };
  const response = await fetch(`https://api.github.com/repos/${repo}/pulls`, {
    method: 'POST', headers,
    body: JSON.stringify({ title: `chore(factory): tool candidate for ${rel}`, head: branch, base: 'main', body: `Automated candidate branch from AI Factory Controlled Tool Runtime.\n\nTool request: \`${requestId}\`\nPath: \`${rel}\`\nReason: ${reason}\n\nAll factory validators passed before push. This workflow cannot merge the PR.`, maintainer_can_modify: true, draft: true }),
  });
  const body = await response.json();
  if (response.ok) return { status: 'OPEN', number: body.number, url: body.html_url, reused: false };
  const message = String(body?.message || '');
  if (response.status === 403 && /GitHub Actions is not permitted to create or approve pull requests/i.test(message)) return { status: 'BLOCKED_BY_REPOSITORY_POLICY', http_status: 403, message: 'GitHub Actions workflow token cannot create pull requests under the current repository setting.', manual_or_app_pr_required: true };
  throw new Error(`GitHub PR create failed ${response.status}: ${JSON.stringify(body).slice(0, 1000)}`);
}

function providerById(id) { return (providers.providers || []).find((x) => x.id === id) || {}; }
function normalizeOcrLanguages(value) {
  const source = Array.isArray(value) ? value : value ? [value] : ['eng'];
  return [...new Set(source.map((x) => String(x || '').trim().toLowerCase()).filter((x) => /^[a-z]{3}$/.test(x)))].slice(0, 4);
}
function rejectKeys(args, denied) { for (const key of denied) if (Object.prototype.hasOwnProperty.call(args, key)) throw new Error(`argument ${key} is not allowed for this tool`); }
function joinUrl(base, suffix) { return `${String(base).replace(/\/+$/,'')}${suffix.startsWith('/') ? suffix : `/${suffix}`}`; }
async function fetchWithTimeout(url, options = {}, timeoutMs = 60000) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); } finally { clearTimeout(timer); }
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function allowedEvidenceClass(value) { return new Set(['MEASURED','OBSERVED','CONFIRMED','DERIVED','INFERRED','ASSUMPTION','UNKNOWN','BLOCKER']).has(String(value || '')) ? String(value) : null; }
function git(args, options = {}) {
  const child = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, timeout: 180000 });
  if (!options.allowFailure && child.status !== 0) throw new Error(`git ${args[0]} failed (${child.status}): ${sanitizeProviderError(child.stderr || child.stdout)}`);
  return { status: child.status ?? 1, stdout: String(child.stdout || ''), stderr: String(child.stderr || '') };
}
function ensureInsideRoot(full) { const resolvedRoot = path.resolve(root) + path.sep; const resolved = path.resolve(full); if (!resolved.startsWith(resolvedRoot)) throw new Error('path escaped repository root'); }
function deny(code, extra = {}) { return { denied: true, code, ...extra }; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function clean(value, max) { return String(value ?? '').replace(/[\u0000\r]+/g, ' ').trim().slice(0, max); }
function clip(value, max) { return String(value || '').slice(0, max); }
function boundObject(value, max) { const text = JSON.stringify(value ?? {}); if (text.length <= max) return value ?? {}; return { truncated: true, preview: text.slice(0, max), original_characters: text.length }; }

async function getOidcToken(aud) {
  const base = process.env.ACTIONS_ID_TOKEN_REQUEST_URL; const token = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!base || !token) throw new Error('GitHub OIDC environment unavailable; id-token: write is required');
  const url = new URL(base); url.searchParams.set('audience', aud);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`OIDC token request failed: ${response.status}`);
  const body = await response.json(); if (!body.value) throw new Error('OIDC token response missing value'); return body.value;
}

async function broker(action, payload = {}) {
  const response = await fetch(brokerUrl, { method: 'POST', headers: { Authorization: `Bearer ${oidcToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...payload, metadata: { worker_id: workerId, executor: 'controlled-tool-runtime-v3-providers' } }) });
  const text = await response.text(); let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text.slice(0, 500) }; }
  if (!response.ok) throw new Error(`broker ${action} failed: ${response.status} ${JSON.stringify(body)}`);
  return body;
}
