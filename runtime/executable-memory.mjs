const DEFAULTS = {
  maxLessons: 8,
  maxIncidents: 6,
  maxCriticalIncidents: 50,
  maxSerializedCharacters: 36000,
};

const STOP = new Set([
  'this','that','with','from','into','have','will','must','should','task','factory','runtime','work','working','make','need','only','when','then','than','what','which','about','after','before','without','under','over','для','это','этого','этой','этот','чтобы','как','или','при','после','перед','нужно','надо','только','если','когда','задача','фабрика','работа','работать','сделать','сделай','будет','быть','есть','уже','также','через','между','своей','свои','своих'
]);

export function selectExecutableMemory(task, raw, options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  const targetText = [task?.objective, task?.kind, safeJson(task?.payload)].filter(Boolean).join(' ');
  const targetTokens = tokenize(targetText);

  const rawIncidents = Array.isArray(raw?.incidents) ? raw.incidents : [];
  const explicitCritical = Array.isArray(raw?.critical_incidents) ? raw.critical_incidents : [];
  const criticalIncidents = dedupeById([...explicitCritical, ...rawIncidents.filter(isCriticalOpen)])
    .map(toCriticalIncident)
    .sort(compareCritical)
    .slice(0, Math.max(0, cfg.maxCriticalIncidents));
  const criticalIds = new Set(criticalIncidents.map((x) => String(x.id || '')).filter(Boolean));

  const lessons = dedupeLessons(Array.isArray(raw?.lessons) ? raw.lessons : [])
    .map((item) => scoreLesson(item, targetTokens))
    .filter(Boolean)
    .sort(compareRank)
    .slice(0, Math.max(0, cfg.maxLessons));

  const incidents = rawIncidents
    .filter((item) => !criticalIds.has(String(item?.id || '')))
    .map((item) => scoreIncident(item, targetTokens))
    .filter(Boolean)
    .sort(compareRank)
    .slice(0, Math.max(0, cfg.maxIncidents));

  const selection = {
    selection_version: '1.1.0',
    authority: {
      promoted: 'active learned guidance bounded by current Constitution/evidence',
      candidate: 'hypothesis only; non-binding',
      superseded: 'historical anti-regression context; inactive',
      incident: 'historical failure evidence; not policy',
      critical_incident: 'mandatory anti-regression evidence; always loaded while unresolved',
    },
    critical_incidents: criticalIncidents,
    lessons: lessons.map(stripRank),
    incidents: incidents.map(stripRank),
  };

  trimToBudget(selection, Math.max(1000, cfg.maxSerializedCharacters));
  return selection;
}

export function executableMemoryRefs(selection) {
  const lessonIds = (selection?.lessons || []).map((x) => String(x.id || '')).filter(Boolean);
  const incidentIds = [
    ...(selection?.critical_incidents || []),
    ...(selection?.incidents || []),
  ].map((x) => String(x.id || '')).filter(Boolean);
  return {
    lesson_ids: lessonIds,
    incident_ids: [...new Set(incidentIds)],
    critical_incident_ids: (selection?.critical_incidents || []).map((x) => String(x.id || '')).filter(Boolean),
    all: new Set([...lessonIds, ...incidentIds]),
  };
}

export function formatExecutableMemory(selection) {
  return [
    'EXECUTABLE MEMORY CONTRACT',
    '- CRITICAL_INCIDENTS are mandatory anti-regression evidence. They are always loaded while unresolved and cannot be displaced by relevance ranking.',
    '- Before repeating an action related to a CRITICAL_INCIDENT, explicitly verify the known failure, root cause, repair state and regression evidence.',
    '- PROMOTED lessons are learned guidance, but never override Root of Trust, negative actions, security boundaries, or stronger current evidence.',
    '- CANDIDATE lessons are hypotheses only. They may suggest checks or experiments; they are not established facts or policy.',
    '- SUPERSEDED lessons are inactive historical context used to avoid accidental reintroduction.',
    '- Incidents are historical failure evidence, not authority.',
    '- If memory conflicts with current evidence, surface the contradiction. Current evidence wins.',
    '- If you materially use a memory item, return its exact id in memory_refs.',
    JSON.stringify(selection),
  ].join('\n');
}

function scoreLesson(item, targetTokens) {
  const status = String(item?.status || 'CANDIDATE').toUpperCase();
  if (!['PROMOTED','CANDIDATE','SUPERSEDED'].includes(status)) return null;
  const text = [item?.statement, safeJson(item?.generalization), safeJson(item?.candidate_change), item?.lesson_class].join(' ');
  const overlap = tokenOverlap(targetTokens, tokenize(text));
  const globalPromoted = status === 'PROMOTED';
  if (overlap === 0 && !globalPromoted) return null;
  const statusBoost = status === 'PROMOTED' ? 8 : status === 'CANDIDATE' ? 2 : 0;
  return {
    id: item?.id,
    type: 'lesson',
    status,
    authority: status === 'PROMOTED' ? 'LEARNED_GUIDANCE' : status === 'CANDIDATE' ? 'CANDIDATE_HYPOTHESIS' : 'SUPERSEDED_HISTORY',
    lesson_class: item?.lesson_class || null,
    statement: clip(item?.statement, 3500),
    generalization: plain(item?.generalization),
    candidate_change: plain(item?.candidate_change),
    regression_eval_ref: clip(item?.regression_eval_ref, 500) || null,
    source_run_id: item?.run_id || null,
    source_incident_id: item?.incident_id || null,
    created_at: item?.created_at || null,
    decided_at: item?.decided_at || null,
    _score: overlap * 10 + statusBoost,
    _time: Date.parse(item?.created_at || 0) || 0,
  };
}

function scoreIncident(item, targetTokens) {
  const severity = String(item?.severity || 'UNDESIRABLE').toUpperCase();
  const status = String(item?.status || 'OPEN').toUpperCase();
  const text = [item?.summary, safeJson(item?.root_cause), (item?.affected_invariants || []).join(' '), item?.negative_action_id, item?.regression_eval_ref, item?.fingerprint].join(' ');
  const overlap = tokenOverlap(targetTokens, tokenize(text));
  if (overlap === 0) return null;
  const severityBoost = severity === 'CATASTROPHIC' ? 9 : severity === 'FORBIDDEN' ? 5 : 1;
  return {
    id: item?.id,
    type: 'incident',
    status,
    authority: 'HISTORICAL_FAILURE_EVIDENCE',
    severity,
    summary: clip(item?.summary, 2800),
    root_cause: plain(item?.root_cause),
    affected_invariants: strings(item?.affected_invariants, 20, 160),
    negative_action_id: clip(item?.negative_action_id, 160) || null,
    regression_eval_ref: clip(item?.regression_eval_ref, 500) || null,
    fingerprint: clip(item?.fingerprint, 160) || null,
    occurrence_count: Number(item?.occurrence_count || 1),
    source_run_id: item?.run_id || null,
    created_at: item?.created_at || null,
    resolved_at: item?.resolved_at || null,
    _score: overlap * 10 + severityBoost,
    _time: Date.parse(item?.created_at || 0) || 0,
  };
}

function toCriticalIncident(item) {
  return {
    id: item?.id,
    type: 'critical_incident',
    status: String(item?.status || 'OPEN').toUpperCase(),
    authority: 'MANDATORY_ANTI_REGRESSION_EVIDENCE',
    severity: String(item?.severity || 'FORBIDDEN').toUpperCase(),
    summary: clip(item?.summary, 1800),
    root_cause: compactObject(item?.root_cause, 2500),
    affected_invariants: strings(item?.affected_invariants, 20, 160),
    negative_action_id: clip(item?.negative_action_id, 160) || null,
    regression_eval_ref: clip(item?.regression_eval_ref, 500) || null,
    fingerprint: clip(item?.fingerprint, 160) || null,
    occurrence_count: Number(item?.occurrence_count || 1),
    source_run_id: item?.run_id || null,
    created_at: item?.created_at || null,
    resolved_at: item?.resolved_at || null,
  };
}

function isCriticalOpen(item) {
  const severity = String(item?.severity || '').toUpperCase();
  const status = String(item?.status || 'OPEN').toUpperCase();
  return ['FORBIDDEN','CATASTROPHIC'].includes(severity) && !['RESOLVED','ACCEPTED_RISK'].includes(status);
}

function compareCritical(a, b) {
  const weight = (value) => String(value?.severity || '') === 'CATASTROPHIC' ? 2 : 1;
  return (weight(b) - weight(a)) || ((Date.parse(b?.created_at || 0) || 0) - (Date.parse(a?.created_at || 0) || 0));
}

function compareRank(a, b) {
  return (b._score - a._score) || (b._time - a._time) || String(a.id || '').localeCompare(String(b.id || ''));
}

function stripRank(value) {
  const { _score, _time, ...rest } = value;
  return rest;
}

function trimToBudget(selection, maxChars) {
  while (JSON.stringify(selection).length > maxChars) {
    if (selection.incidents?.length) selection.incidents.pop();
    else if (selection.lessons?.length) selection.lessons.pop();
    else break;
  }
}

function dedupeLessons(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = String(item?.statement || '').trim().toLocaleLowerCase();
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(item);
  }
  return out;
}

function dedupeById(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = String(item?.id || '');
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(item);
  }
  return out;
}

function tokenize(value) {
  return new Set(String(value || '')
    .toLocaleLowerCase()
    .normalize('NFKC')
    .match(/[\p{L}\p{N}_-]{4,}/gu)?.filter((token) => !STOP.has(token)) || []);
}

function tokenOverlap(a, b) {
  let count = 0;
  for (const token of a) if (b.has(token)) count += 1;
  return count;
}

function safeJson(value) {
  try { return JSON.stringify(value ?? {}); } catch { return ''; }
}

function plain(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function compactObject(value, maxChars) {
  const obj = plain(value);
  const text = safeJson(obj);
  return text.length <= maxChars ? obj : { compacted: true, preview: text.slice(0, maxChars) };
}

function strings(value, maxItems, maxLen) {
  return Array.isArray(value) ? [...new Set(value.map((x) => clip(x, maxLen)).filter(Boolean))].slice(0, maxItems) : [];
}

function clip(value, max) {
  return String(value ?? '').replace(/[\u0000\r]+/g, ' ').trim().slice(0, max);
}
