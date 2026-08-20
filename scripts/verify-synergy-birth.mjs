import fs from 'node:fs/promises';
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required');
const correlationId = process.env.FACTORY_SYNERGY_CORRELATION_ID || 'a1f4c7e0-2026-4820-8420-000000000001';
const headers = { apikey: key, Authorization: `Bearer ${key}` };
async function get(path) {
  const response = await fetch(`${url}/rest/v1/${path}`, { headers });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${text.slice(0,1200)}`);
  return text ? JSON.parse(text) : null;
}
const messages = await get(`af_agent_messages?correlation_id=eq.${correlationId}&select=id,stage,status,from_agent_ref,to_agent_ref,attempts,result&order=created_at.asc`);
const evidence = await get(`af_shared_evidence?correlation_id=eq.${correlationId}&select=id,stage,evidence_class,producer_agent_ref,claim&order=created_at.asc`);
const handoffs = await get(`af_agent_handoffs?correlation_id=eq.${correlationId}&select=from_stage,to_stage,gate_status,from_agent_ref,to_agent_ref&order=created_at.asc`);
const births = await get(`af_agent_birth_proposals?correlation_id=eq.${correlationId}&select=proposed_candidate_id,proposed_name,proposed_role,status,n8n_agent_id,production_authority_granted,publication_attempted`);
const child = await get('af_agent_candidates?candidate_id=eq.handoff-coordinator-g3&select=candidate_id,name,generation,role,state,autonomy_level,n8n_agent_id,parent_refs,tools,metadata');
const requiredStages = ['RESEARCH','EVIDENCE','BUILD','AUDIT','BIRTH'];
for (const stage of requiredStages) {
  if (!messages.some((x) => x.stage === stage && x.status === 'DELIVERED')) throw new Error(`Missing delivered ${stage} message`);
}
for (const edge of [['RESEARCH','EVIDENCE'],['EVIDENCE','BUILD'],['BUILD','AUDIT'],['AUDIT','BIRTH']]) {
  if (!handoffs.some((x) => x.from_stage === edge[0] && x.to_stage === edge[1] && x.gate_status === 'PASS')) throw new Error(`Missing PASS handoff ${edge[0]}→${edge[1]}`);
}
const producers = new Set(evidence.map((x) => x.producer_agent_ref));
const routing = JSON.parse(await fs.readFile('registry/agent-routing.json', 'utf8'));
const expectedOperational = Object.values(routing.cells).flatMap((cell) => [cell.lead.candidateId, ...cell.specialists.map((x) => x.candidateId)]);
for (const id of expectedOperational) if (!producers.has(id)) throw new Error(`Operational agent did not contribute durable evidence: ${id}`);
if (!births?.length || births[0].status !== 'SPAWNED' || !births[0].n8n_agent_id) throw new Error('Audited synergy birth not SPAWNED');
if (births[0].production_authority_granted !== false || births[0].publication_attempted !== false) throw new Error('Synergy birth crossed authority/publication boundary');
if (!child?.length || child[0].state !== 'SPAWNED' || child[0].autonomy_level !== 'A2' || child[0].generation !== 3) throw new Error('Synergy child candidate state invalid');
if (!Array.isArray(child[0].tools) || child[0].tools.length !== 0) throw new Error('Synergy child must start with zero tools');
const result = {
  checked_at: new Date().toISOString(), correlation_id: correlationId,
  delivered_stages: requiredStages,
  pass_handoffs: handoffs.filter((x) => x.gate_status === 'PASS').length,
  evidence_producers: producers.size,
  expected_operational_contributors: expectedOperational.length,
  child: { candidate_id: child[0].candidate_id, name: child[0].name, generation: child[0].generation, role: child[0].role, state: child[0].state, autonomy_level: child[0].autonomy_level },
  production_authority_granted: false, publication_attempted: false
};
await fs.mkdir('artifacts', { recursive: true });
await fs.writeFile('artifacts/synergy-birth.json', JSON.stringify(result, null, 2) + '\n');
console.log(`SYNERGY_BIRTH_OK stages=${requiredStages.length} handoffs=4 contributors=${producers.size} child=${child[0].candidate_id}`);
