#!/usr/bin/env node

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const errors = [];
const workerPath = 'scripts/copilot-autonomous-worker-v2.mjs';
const migrationPath = 'infra/supabase/migrations/20260818_281_telegram_agent_truth_guard.sql';

const worker = fs.existsSync(workerPath) ? fs.readFileSync(workerPath, 'utf8') : '';
const migration = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, 'utf8') : '';

if (!worker) errors.push(`missing ${workerPath}`);
if (!migration) errors.push(`missing ${migrationPath}`);

for (const token of [
  "kind.startsWith('factory-maintenance')",
  'maintenanceAgentIds',
  'enforceTelegramAgentTruth',
  'post.agent MUST exactly match an id in activated_agents',
  'telegram_truth_guard',
  'runtime-mechanic',
  'memory-curator',
  'incident-auditor',
  'reliability-sre',
]) {
  if (!worker.includes(token)) errors.push(`worker missing truth/routing token: ${token}`);
}

if (worker.includes('return /(factory|self[- ]?audit')) {
  errors.push('generic word "factory" must not activate maintenance mode for every Telegram HQ task');
}

for (const token of [
  'af_guard_telegram_agent_truth',
  'trg_af_runs_telegram_agent_truth',
  "(item->>'agent') = any",
  'activated_agents',
  'dropped_unauthorized_posts',
]) {
  if (!migration.includes(token)) errors.push(`migration missing truth-guard token: ${token}`);
}

const syntax = spawnSync(process.execPath, ['--check', workerPath], { encoding: 'utf8' });
if (syntax.status !== 0) errors.push(`worker syntax check failed: ${(syntax.stderr || syntax.stdout || '').trim()}`);

if (errors.length) {
  console.error('AI Factory Telegram agent truth validation FAILED');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('AI Factory Telegram agent truth validation OK: maintenance routing is explicit and Telegram authors must match durable activated_agents');
