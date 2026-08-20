import fs from 'node:fs/promises';

const network = JSON.parse(await fs.readFile('registry/agent-network.json', 'utf8'));
const nursery = JSON.parse(await fs.readFile('registry/agent-nursery.json', 'utf8'));
const external = JSON.parse(await fs.readFile('registry/external-runtimes.json', 'utf8'));
const seedScript = await fs.readFile('scripts/seed-first-agent-generation.mjs', 'utf8');
const seedWorkflow = await fs.readFile('.github/workflows/first-agent-generation.yml', 'utf8');
const continueScript = await fs.readFile('scripts/continue-first-agent-generation-v2.mjs', 'utf8');
const continueWorkflow = await fs.readFile('.github/workflows/complete-first-agent-generation.yml', 'utf8');
const migration = await fs.readFile('infra/supabase/migrations/20260820_289_agent_population_lifecycle.sql', 'utf8');

function assert(ok, message) { if (!ok) throw new Error(message); }

assert(network.mode === 'bounded-agent-network', 'agent network mode must remain bounded');
assert(network.populationPolicy?.automaticPromotion === false, 'automatic promotion must remain disabled');
assert(network.populationPolicy?.unboundedRecursiveSpawning === false, 'unbounded recursive spawning must remain disabled');
assert(Number(network.populationPolicy?.maxChildrenPerSupervisor) <= 4, 'supervisor max children must be <= 4');
assert(network.populationPolicy?.maxAutonomyWithoutOwnerPromotion === 'A3', 'network autonomy ceiling must be A3');
assert(network.root?.runtimeAgentId === 'tjPdLV47rjFQFHOV', 'network root must bind the verified Nursery Supervisor');
assert(network.root?.model === 'groq/openai/gpt-oss-120b', 'network root must bind the verified Groq model');
assert(Array.isArray(nursery.hardDenials) && nursery.hardDenials.includes('unbounded recursive agent spawning'), 'nursery hard denial for recursive spawning missing');
assert(nursery.promotionGate?.automaticPromotionAllowed === false, 'nursery automatic promotion must remain disabled');

const generation1 = Array.isArray(network.seedBlueprints) ? network.seedBlueprints : [];
const expectedIds = ['evidence-apprentice-g1','research-scout-g1','builder-apprentice-g1','auditor-apprentice-g1'];
const expectedRoles = ['evidence-specialist','research-scout','builder-apprentice','auditor-apprentice'];
assert(generation1.length === 4, `Generation 1 must define exactly 4 seed blueprints; found ${generation1.length}`);
assert(new Set(generation1.map((x) => x.candidateId)).size === generation1.length, 'Generation 1 candidate IDs must be unique');
assert(new Set(generation1.map((x) => x.name)).size === generation1.length, 'Generation 1 candidate names must be unique');
for (const id of expectedIds) assert(generation1.some((x) => x.candidateId === id), `missing Generation 1 candidate ${id}`);
for (const role of expectedRoles) assert(generation1.some((x) => x.role === role), `missing Generation 1 role ${role}`);
for (const row of generation1) {
  assert(row.generation === 1, `${row.candidateId} must remain generation 1`);
  assert(row.autonomyLevel === 'A2', `${row.candidateId} must remain A2`);
  assert(Array.isArray(row.parentRefs) && row.parentRefs.length === 1 && row.parentRefs[0] === 'nursery-supervisor-g0', `${row.candidateId} must have only nursery-supervisor-g0 as parent`);
  assert(Array.isArray(row.tools) && row.tools.length === 0, `${row.candidateId} must expose zero tools during Generation 1 training`);
}

const promoted = Array.isArray(network.promotedMembers) ? network.promotedMembers : [];
const evidencePromotion = promoted.find((x) => x.candidateId === 'evidence-apprentice-g1');
assert(evidencePromotion, 'owner promotion record for evidence-apprentice-g1 missing');
assert(evidencePromotion.promotionAuthority === 'owner', 'Evidence Apprentice promotion authority must be owner');
assert(evidencePromotion.productionWriteAuthority === false, 'network promotion must not silently grant production writes');
assert(evidencePromotion.publicationRequired === false, 'network promotion must remain separable from external publication');
assert(network.generationPlan?.generation1TargetChildren === 4, 'Generation 1 target must remain exactly four children');

for (const token of ['search_agents', 'create_agent', 'call_agent', 'assessPromotion', "'A2'", 'network_attached_as_draft_subagent', 'publication_attempted: false', 'production_authority_granted: false']) {
  assert(seedScript.includes(token), `first-generation seed script missing ${token}`);
}
assert(seedScript.includes('mergedAgents.length > 4'), 'seed runtime maxChildren guard missing');
assert(!seedScript.includes('publish_agent'), 'seed lifecycle must not publish agents');
assert(!seedScript.includes('N8N_API_KEY'), 'seed lifecycle must use MCP token, not REST bootstrap key');
assert(seedWorkflow.includes('N8N_MCP_TOKEN: ${{ secrets.N8N_MCP_TOKEN }}'), 'seed workflow must source MCP token from Actions secrets');
assert(seedWorkflow.includes('timeout-minutes: 10'), 'seed workflow needs bounded runtime');
assert(seedWorkflow.includes('group: n8n-agent-nursery-mutator'), 'seed workflow must serialize n8n nursery mutation');

for (const token of [
  'research-scout-g1','builder-apprentice-g1','auditor-apprentice-g1',
  'search_agents','create_agent','call_agent','assessPromotion','MAX_CHILDREN = 4',
  'network_attached_as_draft_subagent','automatic_promotion_attempted:false',
  'publication_attempted:false','production_authority_granted:false',
  "await configHash(agentId);",
]) assert(continueScript.includes(token), `Generation 1 continuation v2 missing ${token}`);
assert(!continueScript.includes('publish_agent'), 'Generation 1 continuation must not publish agents');
assert(!continueScript.includes('N8N_API_KEY'), 'Generation 1 continuation must use MCP token, not REST bootstrap key');
assert(continueScript.includes('childIds.length!==MAX_CHILDREN'), 'continuation must verify exactly four final supervisor children');
assert(continueWorkflow.includes('scripts/continue-first-agent-generation-v2.mjs'), 'continuation workflow must use restart-safe v2 runner');
assert(continueWorkflow.includes('N8N_MCP_TOKEN: ${{ secrets.N8N_MCP_TOKEN }}'), 'continuation workflow must source MCP token from Actions secrets');
assert(continueWorkflow.includes('timeout-minutes: 20'), 'continuation workflow needs bounded runtime');
assert(continueWorkflow.includes('group: n8n-agent-nursery-mutator'), 'continuation workflow must serialize n8n nursery mutation');

for (const table of ['af_agent_candidates','af_agent_evaluations','af_agent_relationships','af_agent_lifecycle_events']) {
  assert(migration.includes(`public.${table}`), `migration missing ${table}`);
}
assert(migration.includes('enable row level security'), 'agent population tables must enable RLS');
assert(migration.includes('revoke all on public.af_agent_candidates from public, anon, authenticated'), 'agent population must not be exposed to public roles');
assert(migration.includes('with (security_invoker = true)'), 'lineage view must use security_invoker');

const n8nRuntime = external.runtimes?.find((x) => x.id === 'n8n-agent-nursery');
assert(n8nRuntime, 'n8n external runtime missing');
assert(n8nRuntime.authority?.maxAutonomy === 'A3', 'n8n runtime max autonomy must remain A3');
assert(n8nRuntime.authority?.rootOfTrustMutation === false, 'n8n Root of Trust mutation must remain denied');
assert(n8nRuntime.authority?.selfPromotion === false, 'n8n self-promotion must remain denied');

console.log(`AGENT_NETWORK_VALIDATION_OK generation1=${generation1.length} promoted=${promoted.length} runner=v2`);
