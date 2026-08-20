#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateReviewedRepositoryPatch } from '../runtime/self-improvement.mjs';

const root = process.cwd();
const repo = 'thethr0ne7/aifactory';
const audience = 'aifactory-supabase-runtime';
const gateUrl = process.env.FACTORY_REVIEW_GATE_URL || 'https://hgivyjjethjwswjrvroy.supabase.co/functions/v1/ai-factory-reviewed-patch';
const candidateId = String(process.env.PATCH_CANDIDATE_ID || '').trim();
const runId = String(process.env.GITHUB_RUN_ID || 'local');
const policy = JSON.parse(fs.readFileSync(path.join(root, 'registry/self-improvement.json'), 'utf8'));

if (!process.env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN is required');
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidateId)) throw new Error('PATCH_CANDIDATE_ID must be a UUID');
if (process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('reviewed repository patch must dispatch from main');
if (process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch') throw new Error('reviewed repository patch requires workflow_dispatch');

const oidcToken = await getOidcToken(audience);
const gated = await fetchCandidate();
const candidate = gated.candidate;
const decision = validateReviewedRepositoryPatch(candidate, policy);
if (!decision.ok) throw new Error(`reviewed candidate denied: ${decision.code}`);

const rel = decision.path;
const full = path.join(root, rel);
ensureInsideRoot(full);
const existing = fs.existsSync(full) && fs.statSync(full).isFile();
let currentBlob = null;

if (existing) {
  const tracked = git(['ls-files', '--error-unmatch', '--', rel], { allowFailure: true });
  if (tracked.status !== 0) throw new Error('existing review target is not tracked');
  currentBlob = git(['rev-parse', `HEAD:${rel}`]).stdout.trim();
  if (!decision.expected_blob_sha) throw new Error(`expected_blob_sha required for existing file ${rel}`);
  if (decision.expected_blob_sha !== currentBlob) throw new Error(`stale candidate for ${rel}: expected ${decision.expected_blob_sha}, current ${currentBlob}`);
} else if (decision.expected_blob_sha) {
  throw new Error('expected_blob_sha must be empty for a new file');
}

const branch = `factory/reviewed-${candidateId.slice(0, 8)}-${runId}`.slice(0, 100);
git(['switch', '-c', branch]);
fs.mkdirSync(path.dirname(full), { recursive: true });
fs.writeFileSync(full, decision.content, 'utf8');
git(['add', '--', rel]);

const changed = git(['diff', '--cached', '--name-only']).stdout.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
if (changed.length !== 1 || changed[0] !== rel) throw new Error('reviewed patch escaped single-file boundary');
if (git(['diff', '--cached', '--quiet'], { allowFailure: true }).status === 0) throw new Error('reviewed patch produces no change');

const validations = runCoreValidators();
if (!validations.passed) {
  console.error(JSON.stringify({ event: 'reviewed_patch_validation_failed', candidate_id: candidateId, path: rel, validations }));
  process.exit(1);
}

git(['config', 'user.name', 'AI Factory Reviewed Patch']);
git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
git(['commit', '-m', `chore(factory): reviewed candidate ${candidateId.slice(0, 8)}`]);
const commitSha = git(['rev-parse', 'HEAD']).stdout.trim();
git(['push', '--set-upstream', 'origin', branch]);

const pr = await openPullRequestBestEffort(branch, rel, decision.reason);
console.log(JSON.stringify({
  event: 'reviewed_repository_patch_ready',
  patch_candidate_id: candidateId,
  target_type: decision.target_type,
  path: rel,
  previous_blob_sha: currentBlob,
  branch,
  commit_sha: commitSha,
  review_artifact_status: pr.status === 'OPEN' ? 'PR_OPEN' : 'BRANCH_READY_PR_BLOCKED',
  pull_request: pr,
  validations,
  direct_main_write: false,
  automatic_merge: false,
}));

async function fetchCandidate() {
  const response = await fetch(gateUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${oidcToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ patch_candidate_id: candidateId }),
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text.slice(0, 500) }; }
  if (!response.ok) throw new Error(`review gate denied candidate (${response.status}): ${JSON.stringify(body)}`);
  if (body?.review_contract?.exact_patch_candidate_id !== candidateId) throw new Error('review gate returned mismatched candidate id');
  if (body?.review_contract?.direct_main_write !== false || body?.review_contract?.automatic_merge !== false) throw new Error('review gate contract weakened');
  return body;
}

function runCoreValidators() {
  const scripts = [
    'scripts/validate-factory.js',
    'scripts/validate-autonomous-runtime.js',
    'scripts/validate-self-improvement.js',
    'scripts/validate-tool-runtime.js',
    'scripts/validate-reliability-kernel.js',
  ];
  const runs = scripts.map((script) => {
    const child = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, timeout: 180000 });
    return { script, exit_code: child.status, stdout: clip(child.stdout, 3000), stderr: clip(child.stderr, 3000) };
  });
  return { passed: runs.every((x) => x.exit_code === 0), runs };
}

async function openPullRequestBestEffort(branch, rel, reason) {
  const headers = {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
  const response = await fetch(`https://api.github.com/repos/${repo}/pulls`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: `chore(factory): reviewed self-improvement candidate for ${rel}`,
      head: branch,
      base: 'main',
      body: `Reviewed AI Factory self-improvement candidate.\n\nPatch candidate: \`${candidateId}\`\nTarget: \`${rel}\`\nReason: ${reason}\n\nThe candidate was retrieved through the main-ref OIDC review gate, exact blob freshness was checked, and all core validators passed before push. This workflow cannot merge the PR.`,
      maintainer_can_modify: true,
      draft: true,
    }),
  });
  const body = await response.json();
  if (response.ok) return { status: 'OPEN', number: body.number, url: body.html_url };
  const message = String(body?.message || '');
  if (response.status === 403 && /not permitted to create or approve pull requests/i.test(message)) {
    return { status: 'BLOCKED_BY_REPOSITORY_POLICY', http_status: 403, manual_pr_required: true };
  }
  throw new Error(`GitHub PR create failed ${response.status}: ${JSON.stringify(body).slice(0, 1000)}`);
}

function git(args, options = {}) {
  const child = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, timeout: 180000 });
  if (!options.allowFailure && child.status !== 0) throw new Error(`git ${args[0]} failed (${child.status}): ${safeError(child.stderr || child.stdout)}`);
  return { status: child.status ?? 1, stdout: String(child.stdout || ''), stderr: String(child.stderr || '') };
}
function ensureInsideRoot(full) { const rr = path.resolve(root) + path.sep; if (!path.resolve(full).startsWith(rr)) throw new Error('path escaped repository root'); }
function clip(value, max) { return String(value || '').slice(0, max); }
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
