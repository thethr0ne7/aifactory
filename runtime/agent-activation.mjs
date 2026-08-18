export function reconcileActivatedAgents({ declared = [], output = {}, allowedAgentIds = [], maxAgents = 3 } = {}) {
  const allowed = allowedAgentIds instanceof Set ? allowedAgentIds : new Set(Array.isArray(allowedAgentIds) ? allowedAgentIds : []);
  const limit = Math.max(0, Math.min(Number(maxAgents) || 0, 6));
  const declaredValid = uniqueStrings(declared).filter((id) => allowed.has(id));
  const rawPosts = Array.isArray(output?.telegram_posts) ? output.telegram_posts : [];
  const authoredValid = uniqueStrings(rawPosts.map((post) => post?.agent)).filter((id) => allowed.has(id));
  const activated = [...new Set([...declaredValid, ...authoredValid])].slice(0, limit);
  const recovered = activated.filter((id) => !declaredValid.includes(id));

  return {
    activated_agents: activated,
    recovered_agents: recovered,
    recovered_count: recovered.length,
    declared_valid_count: declaredValid.length,
    authored_valid_count: authoredValid.length,
    max_agents: limit,
  };
}

function uniqueStrings(value) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => String(item ?? '').trim()).filter(Boolean))]
    : [];
}
