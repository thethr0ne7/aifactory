#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { validateToolRequest, candidatePathDecision, normalizeRepoPath } from '../runtime/tool-runtime.mjs';

const root = process.cwd();
const brokerUrl = process.env.FACTORY_BROKER_URL || 'https://hgivyjjethjwswjrvroy.supabase.co/functions/v1/ai-factory-broker';
const audience = 'aifactory-supabase-runtime';
const runId = process.env.GITHUB_RUN_ID || 'local';
const workerId = `github-actions:tool:${runId}:${process.env.GITHUB_RUN_ATTEMPT || '1'}`;
const repo = 'thethr0ne7/aifactory';
const policy = JSON.parse(fs.readFileSync(path.join(root, 'registry/tool-runtime.json'), 'utf8'));

if (!process.env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN is required');
const oidcToken = await getOidcToken(audience);

await broker('tool_recover', { stale_minutes: Number(policy.executor?.staleClaimMinutes) || 20 });
const claimed = await broker('tool_claim', { worker_id: workerId });
if (!claimed.request) {
  console.log('AI Factory Tool Runtime: queue empty');
  process.exit(0);
}

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
      error = { code: String(result.code || 'TOOL_POLICY_DENIED'), tool_id: request.tool_id };
    } else {
      status = 'EXECUTED';
      evidenceClass = 'CONFIRMED';
    }
  }
} catch (err) {
  status = 'FAILED';
  evidenceClass = 'BLOCKER';
  error = { code: 'TOOL_EXECUTION_FAILED', message: safeError(err) };
}

await broker('tool_finish', {
  request_id: request.id,
  status,
  result: boundObject(result, 30000),
  error,
  evidence_class: evidenceClass,
});

console.log(`AI Factory Tool Runtime: ${status} request=${request.id}`);
if (status === 'FAILED') process.exitCode = 1;

async function executeTool(request, spec) {
  const args = object(request.arguments);
  switch (request.tool_id) {
    case 'factory.repo.read_file':
      return readFileTool(args);
    case 'factory.repo.list_files':
      return listFilesTool(args);
    case 'factory.repo.run_validation':
      return validationTool(args);
    case 'factory.repo.candidate_write':
      return candidateWriteTool(request, args, spec);
    default:
      throw new Error('unknown allowlisted tool');
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
  } else if (args.expected_blob_sha) {
    return deny('EXPECTED_BLOB_SHA_FOR_NEW_FILE');
  }

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
  return {
    path: rel,
    previous_blob_sha: currentBlob,
    branch,
    commit_sha: commitSha,
    candidate_branch_ready: true,
    review_artifact_status: pr.status === 'OPEN' ? 'PR_OPEN' : 'BRANCH_READY_PR_BLOCKED',
    pull_request: pr,
    validations,
    direct_merge: false,
  };
}

async function openPullRequestBestEffort(branch, rel, reason, requestId) {
  const headers = {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
  const existingUrl = new URL(`https://api.github.com/repos/${repo}/pulls`);
  existingUrl.searchParams.set('state', 'open');
  existingUrl.searchParams.set('head', `thethr0ne7:${branch}`);
  const existingResponse = await fetch(existingUrl, { headers });
  if (!existingResponse.ok) throw new Error(`GitHub PR lookup failed ${existingResponse.status}`);
  const existing = await existingResponse.json();
  if (Array.isArray(existing) && existing[0]) {
    return { status: 'OPEN', number: existing[0].number, url: existing[0].html_url, reused: true };
  }

  const response = await fetch(`https://api.github.com/repos/${repo}/pulls`, {
    method: 'POST', headers,
    body: JSON.stringify({
      title: `chore(factory): tool candidate for ${rel}`,
      head: branch,
      base: 'main',
      body: `Automated candidate branch from AI Factory Controlled Tool Runtime.\n\nTool request: \`${requestId}\`\nPath: \`${rel}\`\nReason: ${reason}\n\nAll factory validators passed before push. This workflow cannot merge the PR.`,
      maintainer_can_modify: true,
      draft: true,
    }),
  });
  const body = await response.json();
  if (response.ok) return { status: 'OPEN', number: body.number, url: body.html_url, reused: false };

  const message = String(body?.message || '');
  if (response.status === 403 && /GitHub Actions is not permitted to create or approve pull requests/i.test(message)) {
    return {
      status: 'BLOCKED_BY_REPOSITORY_POLICY',
      http_status: 403,
      message: 'GitHub Actions workflow token cannot create pull requests under the current repository setting.',
      manual_or_app_pr_required: true,
    };
  }
  throw new Error(`GitHub PR create failed ${response.status}: ${JSON.stringify(body).slice(0, 1000)}`);
}

function git(args, options = {}) {
  const child = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, timeout: 180000 });
  if (!options.allowFailure && child.status !== 0) throw new Error(`git ${args[0]} failed (${child.status}): ${safeError(child.stderr || child.stdout)}`);
  return { status: child.status ?? 1, stdout: String(child.stdout || ''), stderr: String(child.stderr || '') };
}

function ensureInsideRoot(full) {
  const resolvedRoot = path.resolve(root) + path.sep;
  const resolved = path.resolve(full);
  if (!resolved.startsWith(resolvedRoot)) throw new Error('path escaped repository root');
}

function deny(code, extra = {}) { return { denied: true, code, ...extra }; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function clip(value, max) { return String(value || '').slice(0, max); }
function boundObject(value, max) {
  const text = JSON.stringify(value ?? {});
  if (text.length <= max) return value ?? {};
  return { truncated: true, preview: text.slice(0, max) };
}
function safeError(error) { return (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, ' ').slice(0, 1800); }

async function getOidcToken(aud) {
  const base = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const token = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!base || !token) throw new Error('GitHub OIDC environment unavailable; id-token: write is required');
  const url = new URL(base);
  url.searchParams.set('audience', aud);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`OIDC token request failed: ${response.status}`);
  const body = await response.json();
  if (!body.value) throw new Error('OIDC token response missing value');
  return body.value;
}

async function broker(action, payload = {}) {
  const response = await fetch(brokerUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${oidcToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload, metadata: { worker_id: workerId, executor: 'controlled-tool-runtime-v1' } }),
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text.slice(0, 500) }; }
  if (!response.ok) throw new Error(`broker ${action} failed: ${response.status} ${JSON.stringify(body)}`);
  return body;
}
