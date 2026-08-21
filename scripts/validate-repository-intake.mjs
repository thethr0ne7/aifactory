#!/usr/bin/env node

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const errors = [];
const read = (file) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { errors.push(`${file}: ${error.message}`); return {}; }
};

const policy = read('registry/repository-intake.json');
const ecc = read('registry/upstreams/affaan-m-ecc.json');

const requiredStages = ['DISCOVER','QUALIFY','LICENSE_CHECK','SECURITY_SCAN','CAPABILITY_EXTRACTION','CLASSIFY','COMPATIBILITY_TEST','SANDBOX','EVALUATION','PROMOTE'];
for (const stage of requiredStages) if (!(policy.pipeline || []).includes(stage)) errors.push(`repository intake missing stage ${stage}`);
for (const mode of ['SERVICE','SKILL','PATTERN','REJECT']) if (!(policy.classification || []).includes(mode)) errors.push(`repository intake missing classification ${mode}`);
for (const field of ['repository','snapshot_commit','license','capabilities','use_mode','components','skills','agents','hooks','mcp','security_risk','context_cost','dependencies','factory_overlap','adaptation_cost','evaluation','decision']) {
  if (!(policy.requiredRecordFields || []).includes(field)) errors.push(`repository intake missing record field ${field}`);
}

for (const [key, expected] of Object.entries({
  mayExecuteDonorCode: false,
  mayRunInstallers: false,
  mayRunPackageScripts: false,
  mayEnableHooks: false,
  mayStartMcpServers: false,
  mayStartBackgroundAgents: false,
  mayUseDonorAutoFix: false,
})) {
  if (policy.firstPass?.[key] !== expected) errors.push(`first-pass intake must keep ${key}=false`);
}

if (policy.factoryShield?.scannerTrustRule?.length < 20) errors.push('scanner bootstrap-trust rule missing');
if (!Array.isArray(policy.hardRules) || !policy.hardRules.some((x) => /Do not execute a donor during first-pass intake/i.test(x))) errors.push('static-first hard rule missing');

if (ecc.intakeId !== 10) errors.push('ECC must remain intake #10');
if (ecc.source?.priority !== 'S+') errors.push('ECC priority must be S+');
if (ecc.source?.category !== 'CORE_DONOR') errors.push('ECC must be classified CORE_DONOR');
if (ecc.source?.decision !== 'TAKE_ADAPT_SELECTIVE_INSTALL') errors.push('ECC decision must be TAKE_ADAPT_SELECTIVE_INSTALL');
if (!/^[0-9a-f]{40}$/.test(String(ecc.source?.auditedCommit || ''))) errors.push('ECC auditedCommit must be pinned SHA');
if (ecc.source?.license !== 'MIT') errors.push('ECC license audit expected MIT');
if (ecc.upstreamFacts?.readme?.skills === ecc.upstreamFacts?.codexNativePlugin?.manifestSkillCount) errors.push('ECC upstream count discrepancy must remain explicitly represented until upstream aligns');

const codex = (ecc.components || []).find((x) => x.component === 'codex-native-plugin');
if (codex?.decision !== 'DEFER_GLOBAL_INSTALL') errors.push('ECC global Codex installation must remain deferred during intake');
const hooks = (ecc.components || []).find((x) => x.component === 'hooks');
if (!hooks || !String(hooks.decision).includes('REFERENCE')) errors.push('ECC hooks must remain reference-only/selective during first pass');
const shield = (ecc.components || []).find((x) => x.component === 'AgentShield');
if (shield?.decision !== 'TAKE_REFERENCE_EVALUATE') errors.push('AgentShield must not bootstrap executable trust');

for (const file of [
  'skills/repo-intake/SKILL.md',
  'skills/compound-skill-loop/SKILL.md',
  'skills/context-governor/SKILL.md',
  'skills/third-party-security/SKILL.md',
  'scripts/repository-intake-scan.mjs',
  'evals/runtime/repository-intake.test.mjs',
]) if (!fs.existsSync(file)) errors.push(`missing intake artifact ${file}`);

const test = spawnSync(process.execPath, ['--test', 'evals/runtime/repository-intake.test.mjs'], { encoding: 'utf8' });
if (test.status !== 0) errors.push(`repository intake tests failed: ${(test.stderr || test.stdout || '').slice(0, 3000)}`);

if (errors.length) {
  console.error('AI Factory repository intake validation FAILED');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`AI Factory repository intake validation OK: ECC #${ecc.intakeId} ${ecc.source.priority} ${ecc.source.decision}; static-first security and controlled promotion enforced`);
