#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const errors = [];

function readJson(rel) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) {
    errors.push(`missing file: ${rel}`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (error) {
    errors.push(`invalid JSON: ${rel}: ${error.message}`);
    return null;
  }
}

function exists(rel, reason = 'missing referenced file') {
  if (!rel || !fs.existsSync(path.join(root, rel))) {
    errors.push(`${reason}: ${rel}`);
    return false;
  }
  return true;
}

function requireIds(items, required, label) {
  const ids = new Set((items || []).map((item) => item.id));
  for (const id of required) {
    if (!ids.has(id)) errors.push(`${label} missing required id: ${id}`);
  }
}

const manifest = readJson('factory.manifest.json');
const capabilities = readJson('registry/capabilities.json');
const evidence = readJson('registry/evidence-contract.json');
const knowledge = readJson('registry/knowledge-classes.json');
const standards = readJson('registry/standards.json');
const upstream = readJson('registry/upstreams/addyosmani-agent-skills.json');

if (manifest && capabilities) {
  if (manifest.version !== capabilities.factoryVersion) {
    errors.push(`version mismatch: manifest=${manifest.version} capabilities=${capabilities.factoryVersion}`);
  }

  const ids = new Set();
  for (const capability of capabilities.capabilities || []) {
    if (!capability.id) {
      errors.push('capability missing id');
      continue;
    }
    if (ids.has(capability.id)) errors.push(`duplicate capability id: ${capability.id}`);
    ids.add(capability.id);
    if (!capability.family) errors.push(`capability missing family: ${capability.id}`);
    if (!capability.status) errors.push(`capability missing status: ${capability.id}`);
    if (capability.localSkill) exists(capability.localSkill, `capability ${capability.id} localSkill missing`);
  }

  for (const [name, rel] of Object.entries(manifest.contracts || {})) {
    exists(rel, `manifest contract ${name} missing`);
  }

  for (const [name, rel] of Object.entries(capabilities.contracts || {})) {
    exists(rel, `capability contract ${name} missing`);
  }

  exists(manifest.registry, 'manifest registry missing');
  exists(manifest.upstreamAuditRegistry, 'manifest upstream audit registry missing');
  exists(manifest.globalAgentContract, 'manifest global agent contract missing');
  exists(manifest.architecture, 'manifest architecture missing');
}

if (evidence) {
  requireIds(evidence.classes, ['MEASURED','OBSERVED','CONFIRMED','DERIVED','INFERRED','ASSUMPTION','UNKNOWN','BLOCKER'], 'evidence contract');
}

if (knowledge) {
  requireIds(knowledge.classes, ['INVARIANT','POLICY','HEURISTIC','VOLATILE_REFERENCE','PATTERN'], 'knowledge classification');
}

if (standards) {
  requireIds(standards.standards, ['wcag','owasp-web','owasp-llm','core-web-vitals'], 'standards registry');
}

if (upstream) {
  if (upstream.source?.repository !== 'https://github.com/addyosmani/agent-skills') {
    errors.push('unexpected addyosmani upstream repository identity');
  }
  if (!upstream.source?.auditedVersion || !upstream.source?.auditedCommit) {
    errors.push('upstream audit must pin auditedVersion and auditedCommit');
  }
  const names = new Set((upstream.skills || []).map((skill) => skill.name));
  if (names.size !== 24 || (upstream.skills || []).length !== 24) {
    errors.push(`addyosmani audit must classify exactly 24 unique core skills; found ${(upstream.skills || []).length} rows / ${names.size} unique`);
  }
}

if (errors.length) {
  console.error('AI Factory validation FAILED');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`AI Factory validation OK: ${capabilities?.capabilities?.length || 0} capabilities; version ${manifest?.version || 'unknown'}`);
