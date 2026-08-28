#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const SENSITIVE_KEY = /(token|cookie|secret|password|passwd|proxy|authorization|auth[_-]?token|ct0)/i;

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;

  const out = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : redact(child);
  }
  return out;
}

const command = process.env.AGENT_REACH_BIN || (process.platform === "win32" ? "agent-reach.exe" : "agent-reach");
const result = spawnSync(command, ["doctor", "--json"], {
  encoding: "utf8",
  shell: false,
  windowsHide: true,
  env: process.env,
});

if (result.error) {
  const code = result.error.code === "ENOENT" ? "AGENT_REACH_NOT_INSTALLED" : "AGENT_REACH_SPAWN_FAILED";
  process.stderr.write(JSON.stringify({
    ok: false,
    code,
    command,
    message: result.error.message,
  }, null, 2) + "\n");
  process.exit(result.error.code === "ENOENT" ? 3 : 2);
}

if (result.status !== 0) {
  process.stderr.write(JSON.stringify({
    ok: false,
    code: "AGENT_REACH_DOCTOR_FAILED",
    command,
    exitCode: result.status,
    stderr: (result.stderr || "").trim().slice(0, 4000),
  }, null, 2) + "\n");
  process.exit(2);
}

let parsed;
try {
  parsed = JSON.parse(result.stdout);
} catch (error) {
  process.stderr.write(JSON.stringify({
    ok: false,
    code: "AGENT_REACH_DOCTOR_INVALID_JSON",
    command,
    message: error.message,
    stdoutPreview: (result.stdout || "").trim().slice(0, 1000),
  }, null, 2) + "\n");
  process.exit(1);
}

const channels = parsed.channels && typeof parsed.channels === "object"
  ? parsed.channels
  : parsed;

const summary = {};
if (channels && typeof channels === "object" && !Array.isArray(channels)) {
  for (const [name, channel] of Object.entries(channels)) {
    if (!channel || typeof channel !== "object") continue;
    summary[name] = {
      status: channel.status ?? null,
      active_backend: channel.active_backend ?? null,
      available: channel.available ?? null,
    };
  }
}

process.stdout.write(JSON.stringify({
  ok: true,
  adapter: "agent-reach-internet",
  trust: "untrusted-external-evidence",
  command,
  checkedAt: new Date().toISOString(),
  summary,
  doctor: redact(parsed),
}, null, 2) + "\n");
