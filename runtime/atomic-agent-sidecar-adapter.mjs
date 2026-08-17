import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

const REQUEST_TYPES = new Set([
  'start_session',
  'run_step',
  'send_message',
  'cancel',
  'approval_response',
  'get_session',
  'skill_install',
  'skill_uninstall',
  'skill_list',
  'shutdown',
  'ping',
]);

export function frameAtomicRequest(type, payload = {}, id = randomUUID()) {
  if (!REQUEST_TYPES.has(type)) throw new Error(`Unsupported Atomic request type: ${type}`);
  return { kind: 'request', id, type, payload: object(payload) };
}

export function encodeNdjson(message) {
  return `${JSON.stringify(message)}\n`;
}

export function createNdjsonDecoder(onMessage, onError = () => {}) {
  let buffer = '';
  return {
    push(chunk) {
      buffer += String(chunk ?? '');
      let index = buffer.indexOf('\n');
      while (index >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line) parse(line, onMessage, onError);
        index = buffer.indexOf('\n');
      }
    },
    flush() {
      const line = buffer.trim();
      buffer = '';
      if (line) parse(line, onMessage, onError);
    },
  };
}

export class AtomicAgentSidecar extends EventEmitter {
  constructor(options = {}) {
    super();
    this.binary = options.binary || 'atomic-agent-sidecar';
    this.args = Array.isArray(options.args) ? options.args : [];
    this.cwd = options.cwd;
    this.env = options.env ? { ...process.env, ...options.env } : process.env;
    this.requestTimeoutMs = boundedNumber(options.requestTimeoutMs, 120000, 1000, 900000);
    this.child = null;
    this.pending = new Map();
  }

  start() {
    if (this.child) return this;
    const child = spawn(this.binary, this.args, {
      cwd: this.cwd,
      env: this.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child = child;

    const decoder = createNdjsonDecoder(
      (message) => this.#handleMessage(message),
      (error, raw) => this.emit('protocol_error', { error, raw }),
    );

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => decoder.push(chunk));
    child.stdout.on('end', () => decoder.flush());
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => this.emit('stderr', String(chunk)));
    child.on('error', (error) => {
      this.#rejectPending(error);
      this.emit('error', error);
    });
    child.on('exit', (code, signal) => {
      const error = new Error(`Atomic Agent sidecar exited code=${code} signal=${signal}`);
      this.#rejectPending(error);
      this.child = null;
      this.emit('exit', { code, signal });
    });
    return this;
  }

  async request(type, payload = {}, options = {}) {
    this.start();
    const request = frameAtomicRequest(type, payload, options.id);
    const timeoutMs = boundedNumber(options.timeoutMs, this.requestTimeoutMs, 1000, 900000);

    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.id);
        reject(new Error(`Atomic Agent request timed out: ${type}`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(request.id, { resolve, reject, timer, type });
    });

    this.child.stdin.write(encodeNdjson(request));
    this.emit('request', request);
    return promise;
  }

  startSession(workingDir, metadata = {}) {
    return this.request('start_session', { workingDir, metadata });
  }

  runStep(sessionId) {
    return this.request('run_step', { sessionId });
  }

  sendMessage(sessionId, text, maxSteps) {
    const payload = { sessionId, text: String(text ?? '') };
    if (Number.isInteger(maxSteps) && maxSteps > 0) payload.maxSteps = maxSteps;
    return this.request('send_message', payload);
  }

  cancel(sessionId) {
    return this.request('cancel', { sessionId });
  }

  getSession(sessionId) {
    return this.request('get_session', { sessionId });
  }

  approvalResponse(approvalId, approved, reason) {
    const payload = { approvalId, approved: approved === true };
    if (reason) payload.reason = String(reason);
    return this.request('approval_response', payload);
  }

  skillList() {
    return this.request('skill_list', {});
  }

  skillInstall(sourcePath, force = false) {
    return this.request('skill_install', { sourcePath, force: force === true });
  }

  skillUninstall(name) {
    return this.request('skill_uninstall', { name });
  }

  ping() {
    return this.request('ping', {});
  }

  async shutdown() {
    if (!this.child) return;
    try {
      await this.request('shutdown', {}, { timeoutMs: 10000 });
    } finally {
      this.child?.stdin.end();
    }
  }

  #handleMessage(message) {
    if (!message || typeof message !== 'object') return;
    this.emit('message', message);

    if (message.kind === 'event') {
      this.emit('event', message);
      if (message.type) this.emit(`event:${message.type}`, message);
      return;
    }

    if (message.kind === 'response' && message.correlationId) {
      const pending = this.pending.get(message.correlationId);
      if (!pending) {
        this.emit('orphan_response', message);
        return;
      }
      clearTimeout(pending.timer);
      this.pending.delete(message.correlationId);
      if (message.ok === false) {
        const error = new Error(message.error?.message || `Atomic Agent request failed: ${pending.type}`);
        error.code = message.error?.code;
        error.response = message;
        pending.reject(error);
      } else {
        pending.resolve(message);
      }
    }
  }

  #rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function parse(line, onMessage, onError) {
  try {
    onMessage(JSON.parse(line));
  } catch (error) {
    onError(error instanceof Error ? error : new Error(String(error)), line);
  }
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}
