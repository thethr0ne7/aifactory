import fs from 'node:fs/promises';

const network = JSON.parse(await fs.readFile('registry/agent-network.json', 'utf8'));
const maintenanceAgents = JSON.parse(await fs.readFile('registry/maintenance-agents.json', 'utf8'));
const automations = JSON.parse(await fs.readFile('registry/maintenance-automations.json', 'utf8'));

function assert(ok, message) {
  if (!ok) throw new Error(message);
}

const operational = [
  ...(Array.isArray(network.seedBlueprints) ? network.seedBlueprints : []),
  ...(Array.isArray(network.generation2Blueprints) ? network.generation2Blueprints : []),
];

assert(Number(network.populationPolicy?.minimumOperationalAgents) >= 20, 'minimumOperationalAgents must be >= 20');
assert(Number(network.generationPlan?.operationalAgentMinimum) >= 20, 'generationPlan operationalAgentMinimum must be >= 20');
assert(operational.length >= 20, `at least 20 operational agent blueprints are required; found ${operational.length}`);
assert(new Set(operational.map((x) => x.candidateId)).size === operational.length, 'operational candidate IDs must be unique');
assert(new Set(operational.map((x) => x.name)).size === operational.length, 'operational agent names must be unique');

const operationalIds = new Set(operational.map((x) => x.candidateId));
const maintenanceIds = new Set((maintenanceAgents.maintainers || []).map((x) => x.id));
const automationIds = new Set((automations.automations || []).map((x) => x.id));

for (const id of operationalIds) {
  assert(!maintenanceIds.has(id), `operational agent ${id} collides with maintenance-agent ID`);
  assert(!automationIds.has(id), `operational agent ${id} collides with maintenance-automation ID`);
}

assert(automations.countTowardOperationalAgentMinimum === false, 'maintenance automations must not count toward operational-agent minimum');
assert((automations.automations || []).length >= 6, 'at least six maintenance automations are required');
for (const required of [
  'fault-intake-deduper',
  'queue-latency-sentinel',
  'stale-work-reaper',
  'retry-storm-breaker',
  'backpressure-governor',
  'dead-letter-sweeper',
  'provider-latency-circuit',
  'capacity-planner',
]) {
  assert(automationIds.has(required), `missing maintenance automation ${required}`);
}

const g1Ids = new Set((network.seedBlueprints || []).map((x) => x.candidateId));
const g2 = network.generation2Blueprints || [];
assert(g1Ids.size === 4, 'Generation 1 must keep four direct root children');
assert(g2.length === 16, `Generation 2 must define 16 specialists; found ${g2.length}`);

const childCounts = new Map();
for (const row of g2) {
  assert(row.generation === 2, `${row.candidateId} must be Generation 2`);
  assert(row.autonomyLevel === 'A2', `${row.candidateId} must remain A2`);
  assert(Array.isArray(row.parentRefs) && row.parentRefs.length === 1, `${row.candidateId} must have exactly one parent`);
  assert(g1Ids.has(row.parentRefs[0]), `${row.candidateId} parent must be one of the four Generation 1 cell leads`);
  assert(Array.isArray(row.tools) && row.tools.length === 0, `${row.candidateId} must start with zero tools`);
  childCounts.set(row.parentRefs[0], (childCounts.get(row.parentRefs[0]) || 0) + 1);
}

for (const parentId of g1Ids) {
  assert(childCounts.get(parentId) === 4, `${parentId} must have exactly four Generation 2 children`);
}

assert(Number(network.populationPolicy?.maxChildrenPerSupervisor) === 4, 'maxChildrenPerSupervisor must remain 4');
assert(Number(network.populationPolicy?.maxPersistentAgents) >= 25, 'persistent cap must leave room for root + 20 operational + maintenance agents');
assert(network.populationPolicy?.maintenanceAutomationsCountTowardAgentMinimum === false, 'automation exclusion must remain explicit');
assert(network.populationPolicy?.maintenanceAgentsCountTowardOperationalMinimum === false, 'maintenance-agent exclusion must remain explicit');

console.log(`MAINTENANCE_AUTOMATION_VALIDATION_OK operational_agents=${operational.length} maintenance_agents=${maintenanceIds.size} automations=${automationIds.size}`);
