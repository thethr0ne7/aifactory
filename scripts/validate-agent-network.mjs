import fs from 'node:fs/promises';

const network = JSON.parse(await fs.readFile('registry/agent-network.json', 'utf8'));
const nursery = JSON.parse(await fs.readFile('registry/agent-nursery.json', 'utf8'));
const external = JSON.parse(await fs.readFile('registry/external-runtimes.json', 'utf8'));
const script = await fs.readFile('scripts/seed-first-agent-generation.mjs', 'utf8');
const workflow = await fs.readFile('.github/workflows/first-agent-generation.yml', 'utf8');
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

for (const token of ['search_agents', 'create_agent', 'call_agent', 'assessPromotion', "'A2'", 'network_attached_as_draft_subagent', 'publication_attempted: false', 'production_authority_granted: false']) {
  assert(script.includes(token), `first-generation script missing ${token}`);
}
assert(script.includes('mergedAgents.length > 4'), 'runtime maxChildren guard missing');
assert(!script.includes('publish_agent'), 'first-generation script must not publish agents');
assert(!script.includes('N8N_API_KEY'), 'first-generation lifecycle must use MCP token, not REST bootstrap key');
assert(workflow.includes('N8N_MCP_TOKEN: ${{ secrets.N8N_MCP_TOKEN }}'), 'first-generation workflow must source MCP token from Actions secrets');
assert(workflow.includes('timeout-minutes: 10'), 'first-generation workflow needs bounded runtime');

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

console.log('AGENT_NETWORK_VALIDATION_OK');
