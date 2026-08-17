export class StructuredOutputError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'StructuredOutputError';
    this.details = details;
  }
}

export function parseStructuredObject(raw) {
  const source = String(raw ?? '').trim();
  if (!source) throw new StructuredOutputError('Structured output is empty', { code: 'EMPTY_OUTPUT' });

  const attempts = [];
  const candidates = buildCandidates(source);
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate.text);
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('top-level JSON value is not an object');
      }
      return {
        value,
        repaired: candidate.strategy !== 'direct',
        strategy: candidate.strategy,
        attempts,
      };
    } catch (error) {
      attempts.push({ strategy: candidate.strategy, error: safeError(error) });
    }
  }

  throw new StructuredOutputError('Structured output could not be parsed after local repair', {
    code: 'STRUCTURED_OUTPUT_PARSE_FAILED',
    attempts,
    preview: source.slice(0, 4000),
  });
}

export function buildStructuredRepairPrompt(raw, schemaHint = '') {
  const clipped = String(raw ?? '').slice(0, 80000);
  return [
    'You are a JSON repair worker. Do not solve the original task again.',
    'Repair only syntax/escaping/structure so the semantic content is preserved.',
    'Return exactly one valid JSON object and no markdown, commentary, or code fence.',
    'Do not invent new claims, evidence, tools, permissions, incidents, or decisions.',
    schemaHint ? `EXPECTED SHAPE\n${schemaHint}` : '',
    `BROKEN OUTPUT\n${clipped}`,
  ].filter(Boolean).join('\n\n');
}

export function structuredOutputFingerprint(raw) {
  const text = String(raw ?? '');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}:${text.length}`;
}

function buildCandidates(source) {
  const out = [];
  const seen = new Set();
  const push = (strategy, value) => {
    const text = String(value ?? '').trim();
    if (!text || seen.has(text)) return;
    seen.add(text);
    out.push({ strategy, text });
  };

  const unfenced = stripCodeFence(source);
  push('direct', unfenced);

  const extracted = extractBalancedObject(unfenced);
  push('balanced-object', extracted);

  const repairedDirect = repairJsonStringControls(unfenced);
  push('control-char-repair', repairedDirect);

  const repairedExtracted = repairJsonStringControls(extracted);
  push('balanced-control-char-repair', repairedExtracted);

  const normalized = normalizeTrailingCommas(repairedExtracted);
  push('trailing-comma-repair', normalized);
  return out;
}

function stripCodeFence(value) {
  return String(value ?? '')
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

function extractBalancedObject(value) {
  const text = String(value ?? '');
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      if (start < 0) start = i;
      depth += 1;
      continue;
    }
    if (ch === '}' && start >= 0) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  if (start >= 0) return text.slice(start);
  return text;
}

function repairJsonStringControls(value) {
  const text = String(value ?? '');
  let out = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const code = ch.charCodeAt(0);

    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      continue;
    }

    if (escaped) {
      escaped = false;
      out += ch;
      continue;
    }

    if (ch === '\\') {
      escaped = true;
      out += ch;
      continue;
    }

    if (ch === '"') {
      inString = false;
      out += ch;
      continue;
    }

    if (ch === '\n') { out += '\\n'; continue; }
    if (ch === '\r') { out += '\\r'; continue; }
    if (ch === '\t') { out += '\\t'; continue; }
    if (code >= 0 && code < 0x20) {
      out += `\\u${code.toString(16).padStart(4, '0')}`;
      continue;
    }
    out += ch;
  }
  return out;
}

function normalizeTrailingCommas(value) {
  return String(value ?? '').replace(/,\s*([}\]])/g, '$1');
}

function safeError(error) {
  return (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, ' ').slice(0, 600);
}
