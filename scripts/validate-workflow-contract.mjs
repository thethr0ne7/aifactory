import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const errors = [];

const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(root, rel));

let contract;
try {
  contract = JSON.parse(read('registry/workflow-contract.json'));
} catch (error) {
  errors.push(`invalid workflow contract JSON: ${error.message}`);
}

if (!exists('WORKFLOW.md')) errors.push('missing WORKFLOW.md');

if (contract) {
  if (contract.schemaVersion !== '1.0.0') errors.push(`unexpected schemaVersion: ${contract.schemaVersion}`);
  if (contract.factoryVersion !== '2.4.0') errors.push(`unexpected factoryVersion: ${contract.factoryVersion}`);
  if (contract.workflowFile !== 'WORKFLOW.md') errors.push('workflowFile must point to WORKFLOW.md');

  const requiredStages = ['QUEUE', 'QUALIFY', 'ROUTE', 'PRELOAD_CRITICAL_MEMORY', 'WORK', 'VALIDATE', 'REPAIR', 'LEARN', 'COMPLETE'];
  for (const stage of requiredStages) {
    if (!contract.stages?.includes(stage)) errors.push(`workflow stage missing: ${stage}`);
  }

  for (const rel of contract.rootOfTrust || []) {
    if (!exists(rel)) errors.push(`root-of-trust file missing: ${rel}`);
  }

  for (const rel of [contract.truthGate?.runtime, contract.truthGate?.persistence, contract.truthGate?.evidenceContract, contract.tools?.policy]) {
    if (!rel || !exists(rel)) errors.push(`workflow reference missing: ${rel}`);
  }

  if (contract.coordination?.multiAgentDefault !== 'off') errors.push('multiAgentDefault must remain off');
  if (contract.coordination?.maxExecutiveAgents > 3) errors.push('maxExecutiveAgents must not exceed 3');
  if (contract.coordination?.maxActiveSkillsPerTurn > 8) errors.push('maxActiveSkillsPerTurn must not exceed 8');
  if (contract.truthGate?.telegramAuthorPolicy !== 'activated_agents_only') errors.push('Telegram author policy must be activated_agents_only');
}

if (exists('WORKFLOW.md')) {
  const workflow = read('WORKFLOW.md');
  if (!workflow.startsWith('---\n')) errors.push('WORKFLOW.md must begin with YAML front matter');
  for (const token of ['workflow_version:', 'factory_version:', 'truth_gate:', '# AI Factory Orchestration Workflow', '## Truth Gate']) {
    if (!workflow.includes(token)) errors.push(`WORKFLOW.md missing token: ${token}`);
  }
}

if (errors.length) {
  console.error('Workflow contract validation FAILED');
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log('Workflow contract validation OK');
