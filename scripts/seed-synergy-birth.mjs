const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required');
const correlationId = process.env.FACTORY_SYNERGY_CORRELATION_ID || 'a1f4c7e0-2026-4820-8420-000000000001';
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
async function db(path, { method = 'GET', body, prefer } = {}) {
  const response = await fetch(`${url}/rest/v1/${path}`, { method, headers: { ...headers, ...(prefer ? { Prefer: prefer } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${text.slice(0,1200)}`);
  return text ? JSON.parse(text) : null;
}
const existing = await db(`af_agent_messages?correlation_id=eq.${correlationId}&select=id,stage,status&limit=1`);
if (!existing?.length) {
  await db('af_agent_messages', { method: 'POST', prefer: 'return=minimal', body: {
    correlation_id: correlationId,
    from_agent_ref: 'nursery-supervisor-g0',
    to_agent_ref: 'research-scout-g1',
    kind: 'TASK',
    stage: 'RESEARCH',
    priority: 500,
    max_attempts: 3,
    payload: {
      protocol: 'AF-HANDOFF/1',
      objective: 'Identify the concrete information-loss and coordination risks in the new Research→Evidence→Build→Audit agent network, design a minimal bounded capability that preserves handoff context/evidence without taking domain ownership, independently audit it, and spawn it only if the audit passes.',
      constraints: ['A2 only', 'zero initial tools', 'no production write', 'no Root of Trust mutation', 'no self-promotion', 'no publication'],
      candidate_seed: {
        candidateId: 'handoff-coordinator-g3',
        name: 'AI Factory Handoff Coordinator G3',
        role: 'handoff-coordinator',
        mission: 'Preserve correlation, evidence references, constraints, blockers and expected outputs across Research, Evidence, Build and Audit handoffs without replacing any domain specialist or approval authority.'
      }
    }
  } });
  console.log(`SYNERGY_BIRTH_SEEDED correlation=${correlationId}`);
} else {
  console.log(`SYNERGY_BIRTH_ALREADY_SEEDED correlation=${correlationId}`);
}
