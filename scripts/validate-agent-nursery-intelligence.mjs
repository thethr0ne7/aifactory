#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const errors = [];
const readJson = (rel) => {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) { errors.push(`missing ${rel}`); return null; }
  try { return JSON.parse(fs.readFileSync(full, 'utf8')); }
  catch (error) { errors.push(`invalid JSON ${rel}: ${error.message}`); return null; }
};
const exists = (rel) => { if (!fs.existsSync(path.join(root, rel))) errors.push(`missing ${rel}`); };

const nursery = readJson('registry/agent-nursery.json');
const upstreams = readJson('registry/upstreams/agent-nursery-intelligence-pack.json');
const capabilities = readJson('registry/capabilities.json');
const manifest = readJson('factory.manifest.json');

for (const rel of [
  'runtime/agent-nursery.mjs',
  'runtime/external-eval-adapters.mjs',
  'runtime/intelligence-routing.mjs',
  'skills/agent-nursery/SKILL.md',
  'skills/agent-evaluation/SKILL.md',
  'skills/pdf-routing/SKILL.md',
  'skills/intelligence-sweep/SKILL.md',
  'skills/defensive-osint-identity/SKILL.md',
  'skills/runtime-telemetry-dashboard/SKILL.md',
  'evals/runtime/agent-nursery-intelligence.test.mjs',
]) exists(rel);

if (nursery) {
  if (nursery.mode !== 'bounded-agent-lifecycle') errors.push('nursery mode mismatch');
  if (nursery.candidateContract?.rootOfTrustMutable !== false) errors.push('nursery must not mutate Root of Trust');
  if (nursery.candidateContract?.maxAutonomyWithoutOwnerPromotion !== 'A3') errors.push('nursery automatic ceiling must remain A3');
  if (nursery.promotionGate?.automaticPromotionAllowed !== false) errors.push('automatic promotion must be disabled');
  const denials = new Set(nursery.hardDenials || []);
  for (const required of ['self-modifying Root of Trust','self-raised autonomy ceiling','unbounded recursive agent spawning']) {
    if (!denials.has(required)) errors.push(`nursery hard denial missing: ${required}`);
  }
}

if (upstreams) {
  const byId = new Map((upstreams.sources || []).map((x) => [x.id, x]));
  for (const id of ['n8n','opik','firecrawl-pdf-inspector','crucix','blackbird','cybermon']) {
    if (!byId.has(id)) errors.push(`upstream audit missing: ${id}`);
  }
  if (byId.get('crucix')?.adoption !== 'pattern-only') errors.push('Crucix must remain pattern-only under current license decision');
  if (byId.get('blackbird')?.adoption !== 'restricted-pattern-only') errors.push('Blackbird must remain restricted pattern-only until license/intended-use review');
  if (byId.get('cybermon')?.adoption !== 'ui-pattern-only') errors.push('CyberMon must remain UI pattern-only until license review');
  if (byId.get('opik')?.license !== 'Apache-2.0') errors.push('Opik audited license mismatch');
  if (byId.get('firecrawl-pdf-inspector')?.license !== 'MIT') errors.push('PDF Inspector audited license mismatch');
}

if (capabilities) {
  const ids = new Set((capabilities.capabilities || []).map((x) => x.id));
  for (const id of ['agent-nursery','agent-evaluation','pdf-routing','intelligence-sweep','defensive-osint-identity','runtime-telemetry-dashboard']) {
    if (!ids.has(id)) errors.push(`capability registry missing: ${id}`);
  }
}

if (manifest) {
  if (manifest.contracts?.agentNursery !== 'registry/agent-nursery.json') errors.push('manifest agentNursery contract mismatch');
  if (manifest.agentNurseryRuntime !== 'runtime/agent-nursery.mjs') errors.push('manifest agentNurseryRuntime mismatch');
  if (manifest.externalEvaluationAdapters !== 'runtime/external-eval-adapters.mjs') errors.push('manifest externalEvaluationAdapters mismatch');
  if (manifest.intelligenceRoutingRuntime !== 'runtime/intelligence-routing.mjs') errors.push('manifest intelligenceRoutingRuntime mismatch');
}

for (const rel of ['runtime/agent-nursery.mjs','runtime/external-eval-adapters.mjs','runtime/intelligence-routing.mjs']) {
  const check = spawnSync(process.execPath, ['--check', rel], { cwd: root, encoding: 'utf8' });
  if (check.status !== 0) errors.push(`${rel} syntax failed: ${(check.stderr || check.stdout || '').trim()}`);
}
const test = spawnSync(process.execPath, ['--test', 'evals/runtime/agent-nursery-intelligence.test.mjs'], { cwd: root, encoding: 'utf8' });
if (test.status !== 0) errors.push(`agent nursery/intelligence tests failed: ${(test.stderr || test.stdout || '').trim()}`);

if (errors.length) {
  console.error('AI Factory agent nursery + intelligence validation FAILED');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log('AI Factory agent nursery + intelligence validation OK');
