#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const errors = [];
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const json = (rel) => JSON.parse(read(rel));
const expect = (condition, message) => { if (!condition) errors.push(message); };

for (const rel of [
  'registry/capability-providers.json',
  'runtime/capability-providers.mjs',
  'registry/tool-runtime.json',
  'scripts/tool-executor.mjs',
  'infra/supabase/migrations/20260821_350_capability_provider_tools.sql',
  'infra/supabase/migrations/20260821_351_agent_realtime_stream.sql',
  'evals/runtime/capability-providers.test.mjs',
]) expect(fs.existsSync(path.join(root, rel)), `missing ${rel}`);

if (!errors.length) {
  const registry = json('registry/capability-providers.json');
  const toolPolicy = json('registry/tool-runtime.json');
  const capabilities = new Map((registry.capabilities || []).map((x) => [x.id, x]));
  const providers = new Map((registry.providers || []).map((x) => [x.id, x]));
  const tools = new Map((toolPolicy.tools || []).map((x) => [x.id, x]));

  for (const id of ['WEB_EVIDENCE','WEB_OPERATOR','DOCUMENT_ENGINE','DEVELOPMENT_WORKSPACE','REALTIME_EVENT_STREAM']) expect(capabilities.has(id), `missing capability ${id}`);
  for (const id of ['crawl4ai','browser-use','stirling-pdf','openhands','supabase-realtime']) expect(providers.has(id), `missing provider ${id}`);

  const crawl = providers.get('crawl4ai');
  expect(crawl.upstream === 'unclecode/crawl4ai', 'Crawl4AI upstream mismatch');
  expect(crawl.license === 'Apache-2.0', 'Crawl4AI license mismatch');
  expect(crawl.security?.allowPrivateAddressTargets === false, 'Crawl4AI must deny private targets');
  expect(crawl.security?.allowHooks === false && crawl.security?.allowExecuteJs === false, 'Crawl4AI hooks/execute JS must remain disabled');
  expect(crawl.security?.maxUrlsPerRequest <= 8, 'Crawl4AI URL batch too large');

  const browser = providers.get('browser-use');
  expect(browser.upstream === 'browser-use/browser-use', 'Browser Use upstream mismatch');
  expect(browser.security?.autoExecute === false && browser.security?.ownerApprovalRequired === true, 'Browser Use must be owner-gated');
  expect(tools.get('factory.browser.operate')?.autoExecute === false, 'browser tool must not auto execute');

  const document = providers.get('stirling-pdf');
  expect(document.upstream === 'Stirling-Tools/Stirling-PDF', 'Stirling upstream mismatch');
  expect(document.security?.repositoryFilesOnlyInHostedExecutor === true, 'Stirling hosted input must be repository-scoped');
  expect(tools.get('factory.document.ocr')?.autoExecute === true, 'OCR tool should be bounded LOW auto execution');

  const dev = providers.get('openhands');
  expect(dev.security?.autoExecute === false && dev.security?.ownerApprovalRequired === true, 'OpenHands workspace must be owner-gated');
  expect(dev.security?.productionCredentials === false && dev.security?.directMainWrite === false, 'OpenHands workspace must not receive prod/main authority');
  expect(tools.get('factory.dev.workspace')?.autoExecute === false, 'dev workspace must not auto execute');

  const realtime = providers.get('supabase-realtime');
  expect(realtime.security?.eventsAreNotificationsNotCommands === true, 'Realtime events must never become commands');
  expect(realtime.security?.sourceOfTruth === 'postgres', 'Realtime must not replace Postgres source of truth');

  const adapter = read('runtime/capability-providers.mjs');
  for (const token of ['PRIVATE_ADDRESS_NOT_ALLOWED','LOCALHOST_NOT_ALLOWED','PRIVATE_HOSTNAME_NOT_ALLOWED','URL_CREDENTIALS_NOT_ALLOWED','sanitizeProviderError']) expect(adapter.includes(token), `provider adapter missing ${token}`);

  const executor = read('scripts/tool-executor.mjs');
  for (const token of ['unclecode/crawl4ai:latest','127.0.0.1:11235','CRAWL4AI_HOOKS_ENABLED=false','CRAWL4AI_EXECUTE_JS_ENABLED=false','STIRLING_PDF_BASE_URL','/api/v1/misc/ocr-pdf','X-API-KEY']) expect(executor.includes(token), `provider executor missing ${token}`);
  expect(!executor.includes("spawnSync('sh'") && !executor.includes('shell: true'), 'provider executor must not expose arbitrary shell');

  const sql = read('infra/supabase/migrations/20260821_350_capability_provider_tools.sql');
  expect(sql.includes("'factory.web.crawl'") && sql.includes("'factory.document.ocr'"), 'SQL auto-tool gate missing provider tools');
  expect(!sql.includes("'factory.browser.operate'") && !sql.includes("'factory.dev.workspace'"), 'owner-gated tools leaked into SQL auto gate');

  const realtimeSql = read('infra/supabase/migrations/20260821_351_agent_realtime_stream.sql');
  expect(realtimeSql.includes('supabase_realtime') && realtimeSql.includes('af_agent_activity') && realtimeSql.includes('af_agent_tasks'), 'Realtime publication migration incomplete');
}

const tests = spawnSync(process.execPath, ['--test', 'evals/runtime/capability-providers.test.mjs'], { cwd: root, encoding: 'utf8' });
if (tests.status !== 0) errors.push(`capability provider tests failed: ${(tests.stderr || tests.stdout || '').trim()}`);

if (errors.length) {
  console.error('AI Factory capability provider validation FAILED');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log('AI Factory capability provider validation OK: web evidence, document OCR, owner-gated browser/dev and realtime notification boundaries are coherent');
