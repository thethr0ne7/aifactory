const EVIDENCE_CLASSES = new Set([
  'MEASURED',
  'OBSERVED',
  'CONFIRMED',
  'DERIVED',
  'INFERRED',
  'ASSUMPTION',
  'UNKNOWN',
  'BLOCKER',
]);

const TERMINAL = new Set(['COMPLETE', 'BLOCKED', 'FAILED']);

export function enforceRuntimeTruth(input = {}) {
  const result = clone(input);
  const findings = [];
  let repaired = false;
  let blocked = false;

  result.activated_agents = uniqueStrings(result.activated_agents).slice(0, 4);
  result.selected_skills = uniqueStrings(result.selected_skills).slice(0, 8);
  result.evidence = normalizeEvidence(result.evidence, findings);
  result.assumptions = uniqueStrings(result.assumptions).slice(0, 20);
  result.risks = uniqueStrings(result.risks).slice(0, 20);

  const output = isObject(result.output) ? result.output : {};
  if (!isObject(result.output)) {
    result.output = output;
    repaired = true;
    findings.push(finding('STRUCTURE_REPAIRED', 'output', 'Output was not an object and was normalized to an empty object.'));
  }

  if (Array.isArray(output.telegram_posts)) {
    const authorized = new Set(result.activated_agents);
    const original = output.telegram_posts;
    const accepted = [];

    for (const raw of original.slice(0, 24)) {
      if (!isObject(raw)) {
        repaired = true;
        findings.push(finding('TELEGRAM_POST_DROPPED', 'output.telegram_posts', 'Non-object Telegram post was dropped.'));
        continue;
      }

      const agent = text(raw.agent, 120);
      const body = text(raw.text, 3500);
      if (!agent || !body) {
        repaired = true;
        findings.push(finding('TELEGRAM_POST_DROPPED', 'output.telegram_posts', 'Telegram post without both agent and text was dropped.'));
        continue;
      }
      if (!authorized.has(agent)) {
        repaired = true;
        findings.push(finding('UNAUTHORIZED_TELEGRAM_AUTHOR', 'output.telegram_posts', `Telegram post by ${agent} was dropped because the agent is not in activated_agents.`));
        continue;
      }
      if (accepted.length >= 6) {
        repaired = true;
        findings.push(finding('TELEGRAM_POST_LIMIT', 'output.telegram_posts', 'Telegram post count exceeded the six-post delivery limit; overflow was dropped.'));
        continue;
      }
      accepted.push({ ...raw, agent, text: body });
    }

    output.telegram_posts = accepted;
  }

  const blockerEvidence = result.evidence.filter((item) => item.class === 'BLOCKER');
  if (result.status === 'COMPLETE' && blockerEvidence.length > 0) {
    result.status = 'BLOCKED';
    result.tool_requests = [];
    const message = `Truth Gate blocked COMPLETE because ${blockerEvidence.length} unresolved BLOCKER evidence item(s) remain.`;
    result.risks = uniqueStrings([...(result.risks || []), message]).slice(0, 20);
    if (!text(result.next_action, 3000)) {
      result.next_action = 'Resolve or explicitly retire the blocking evidence, then rerun the affected validation gates.';
    }
    blocked = true;
    findings.push(finding('COMPLETE_WITH_BLOCKER', 'status', message));
  }

  if (TERMINAL.has(String(result.status || '')) && result.status === 'COMPLETE') {
    const hasMeaningfulDecision = Boolean(text(result.decision, 5000));
    const hasMeaningfulOutput = Object.keys(result.output || {}).length > 0;
    if (!hasMeaningfulDecision && !hasMeaningfulOutput) {
      result.status = 'BLOCKED';
      result.tool_requests = [];
      result.next_action = text(result.next_action, 3000) || 'Produce a concrete decision or output before claiming completion.';
      blocked = true;
      findings.push(finding('EMPTY_COMPLETE', 'status', 'COMPLETE was blocked because neither decision nor output contained a meaningful result.'));
    }
  }

  const gate = {
    version: '1.0.0',
    status: blocked ? 'BLOCKED' : repaired || findings.length ? 'REPAIRED' : 'PASS',
    checked: true,
    repaired,
    blocked,
    activated_agent_count: result.activated_agents.length,
    selected_skill_count: result.selected_skills.length,
    evidence_count: result.evidence.length,
    telegram_post_count: Array.isArray(result.output?.telegram_posts) ? result.output.telegram_posts.length : 0,
    findings,
  };

  return { result, gate };
}

function normalizeEvidence(value, findings) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 24).map((raw, index) => {
    const item = isObject(raw) ? raw : {};
    const rawClass = text(item.class, 80);
    const evidenceClass = EVIDENCE_CLASSES.has(rawClass) ? rawClass : 'UNKNOWN';
    if (evidenceClass !== rawClass) {
      findings.push(finding('EVIDENCE_CLASS_REPAIRED', `evidence[${index}].class`, `Unsupported evidence class ${rawClass || '(empty)'} was normalized to UNKNOWN.`));
    }
    return {
      ...item,
      class: evidenceClass,
      claim: text(item.claim, 1200),
      basis: text(item.basis, 2000),
    };
  }).filter((item) => item.claim);
}

function finding(code, path, message) {
  return { code, path, message };
}

function uniqueStrings(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => text(item, 500)).filter(Boolean))];
}

function text(value, max) {
  return String(value ?? '').replace(/[\u0000\r]+/g, ' ').trim().slice(0, max);
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  if (!isObject(value)) return {};
  return JSON.parse(JSON.stringify(value));
}
