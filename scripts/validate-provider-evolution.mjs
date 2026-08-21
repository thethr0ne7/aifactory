import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const [registryText, runtime, worker, migration, edge, workflow, executor, toolRuntimeText, providersText] = await Promise.all([
  fs.readFile('registry/provider-evolution.json', 'utf8'),
  fs.readFile('runtime/provider-evolution.mjs', 'utf8'),
  fs.readFile('scripts/provider-evolution-worker.mjs', 'utf8'),
  fs.readFile('infra/supabase/migrations/20260821_360_provider_evolution.sql', 'utf8'),
  fs.readFile('supabase/functions/ai-factory-provider-evolution/index.ts', 'utf8'),
  fs.readFile('.github/workflows/provider-evolution.yml', 'utf8'),
  fs.readFile('scripts/tool-executor.mjs', 'utf8'),
  fs.readFile('registry/tool-runtime.json', 'utf8'),
  fs.readFile('registry/capability-providers.json', 'utf8'),
]);
const registry = JSON.parse(registryText);
const toolRuntime = JSON.parse(toolRuntimeText);
const capabilityProviders = JSON.parse(providersText);

assert.equal(registry.mode, 'evolutionary-capability-providers');
assert.equal(registry.selection.authorityExpansion, false);
assert.ok(registry.selection.minimumTrialsPerProvider >= 3);
assert.ok(registry.selection.minimumPassRate >= 0.8);
assert.ok(registry.rechallenge.cadenceDays >= 1);
assert.equal(registry.productionRouting.ownerGatesImmutable, true);
assert.equal(registry.productionRouting.requireSameOrLowerRiskClass, true);
const arena = registry.arenas.find((x) => x.capability === 'WEB_EVIDENCE');
assert.ok(arena);
assert.equal(arena.contexts['public-static-html'].routing, 'production');
assert.ok(arena.providers.some((x) => x.id === 'crawl4ai' && x.role === 'ACTIVE_CHAMPION' && x.productionReady === true));
assert.ok(arena.providers.some((x) => x.id === 'native-fetch' && x.productionReady === true));
assert.ok(arena.providers.some((x) => x.id === 'firecrawl' && x.role === 'CHALLENGER' && x.productionReady === false));
assert.ok(registry.arenas.some((x) => x.capability === 'ORCHESTRATION_RUNTIME' && x.providers.some((p) => p.id === 'microsoft-agent-framework')));
assert.ok(registry.arenas.some((x) => x.capability === 'MEMORY' && x.providers.some((p) => p.id === 'supermemory')));
assert.ok(registry.arenas.some((x) => x.capability === 'WEB_OPERATOR' && x.providers.some((p) => p.id === 'stagehand')));
for (const symbol of ['aggregateProviderTrials','paretoDominates','providerUtility','selectProviderChampion','providerAllowedForProduction','shouldRechallenge','inferWebEvidenceContext','contextualArena']) assert.ok(runtime.includes(`export function ${symbol}`));

assert.ok(worker.includes("const providerIds = ['crawl4ai', 'native-fetch']"));
assert.ok(worker.includes("broker('record_trials'"));
assert.ok(worker.includes("broker('set_champion'"));
assert.ok(worker.includes('authority_expanded: false'));
assert.ok(worker.includes("https://example.com/"));
assert.ok(worker.includes("https://example.org/"));
assert.ok(worker.includes("https://example.net/"));
assert.ok(worker.includes("CRAWL4AI_HOOKS_ENABLED=false"));
assert.ok(worker.includes("CRAWL4AI_EXECUTE_JS_ENABLED=false"));

for (const table of ['af_provider_benchmarks','af_provider_trials','af_provider_champions','af_provider_rechallenges']) assert.ok(migration.includes(`public.${table}`));
assert.ok(migration.includes('af_set_provider_champion'));
assert.ok(migration.includes('authority_expanded boolean not null default false check (authority_expanded = false)'));
assert.ok(migration.includes('enable row level security'));
assert.ok(migration.includes('to service_role'));

assert.ok(edge.includes('https://token.actions.githubusercontent.com'));
assert.ok(edge.includes('aifactory-provider-evolution'));
assert.ok(edge.includes('provider-evolution.yml@refs/heads/main'));
assert.ok(edge.includes('factory-tool-executor.yml@refs/heads/main'));
assert.ok(edge.includes('provider_not_production_ready'));
assert.ok(edge.includes('insufficient_trials'));
assert.ok(edge.includes('pass_rate_gate'));
assert.ok(edge.includes('hard_gate_failed'));
assert.ok(edge.includes('authority_expanded: false'));

assert.match(workflow, /permissions:\s*\n\s+contents:\s*read\s*\n\s+id-token:\s*write/m);
assert.doesNotMatch(workflow, /contents:\s*write/i);
assert.doesNotMatch(workflow, /permissions:\s*write-all/i);
assert.ok(workflow.includes('node scripts/validate-provider-evolution.mjs'));
assert.ok(workflow.includes('node evals/runtime/provider-evolution.test.mjs'));
assert.ok(workflow.includes('node scripts/provider-evolution-worker.mjs'));
for (const path of ['scripts/tool-executor.mjs','registry/tool-runtime.json','registry/capability-providers.json']) assert.ok(workflow.includes(`- '${path}'`), `provider workflow must watch ${path}`);

const webTool = toolRuntime.tools.find((x) => x.id === 'factory.web.crawl');
assert.ok(webTool);
assert.equal(webTool.provider, 'contextual-champion');
assert.equal(webTool.autoExecute, true);
assert.equal(webTool.riskClass, 'LOW');
assert.equal(webTool.minimumAutonomy, 'A3');
assert.ok(webTool.argumentContract.provider_context);
assert.equal(toolRuntime.evidencePolicy.providerChampionDoesNotChangeAuthority, true);
const browserTool = toolRuntime.tools.find((x) => x.id === 'factory.browser.operate');
assert.equal(browserTool.ownerApprovalRequired, true);
assert.equal(browserTool.autoExecute, false);
assert.equal(browserTool.riskClass, 'HIGH');

assert.equal(capabilityProviders.evolutionContract, 'registry/provider-evolution.json');
const webCapability = capabilityProviders.capabilities.find((x) => x.id === 'WEB_EVIDENCE');
assert.equal(webCapability.preferredProvider, 'contextual-champion');
assert.equal(webCapability.incumbentProvider, 'crawl4ai');
assert.ok(webCapability.fallbackProviders.includes('native-fetch'));
assert.ok(capabilityProviders.providers.some((x) => x.id === 'native-fetch' && x.security.readOnly === true));

for (const token of [
  'inferWebEvidenceContext',
  'providerRoute',
  "getOidcToken('aifactory-provider-evolution')",
  "routedProvider === 'native-fetch'",
  'nativeFetchTool',
  'normalizeCrawlUrls(args, 8)',
  'max_bytes: 2_000_000',
  "return crawl4aiTool(args, context, routedProvider || 'crawl4ai')",
  'controlled-tool-runtime-v4-provider-champions'
]) assert.ok(executor.includes(token), `tool executor missing provider routing token ${token}`);
assert.ok(executor.includes("rejectKeys(args, ['hooks','execute_js','scripts','cookies','proxy','browser_config','crawler_config','webhook_url'])"));
assert.ok(!executor.includes("case 'factory.browser.operate':"), 'owner-gated browser must not enter deterministic auto-executor');
assert.ok(!executor.includes("case 'factory.dev.workspace':"), 'owner-gated dev workspace must not enter deterministic auto-executor');

console.log('Provider evolution contract validation passed');
