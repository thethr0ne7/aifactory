import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const [registryText, runtime, worker, migration, edge, workflow] = await Promise.all([
  fs.readFile('registry/provider-evolution.json', 'utf8'),
  fs.readFile('runtime/provider-evolution.mjs', 'utf8'),
  fs.readFile('scripts/provider-evolution-worker.mjs', 'utf8'),
  fs.readFile('infra/supabase/migrations/20260821_360_provider_evolution.sql', 'utf8'),
  fs.readFile('supabase/functions/ai-factory-provider-evolution/index.ts', 'utf8'),
  fs.readFile('.github/workflows/provider-evolution.yml', 'utf8'),
]);
const registry = JSON.parse(registryText);
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
for (const symbol of ['aggregateProviderTrials','paretoDominates','providerUtility','selectProviderChampion','shouldRechallenge','inferWebEvidenceContext','contextualArena']) assert.ok(runtime.includes(`export function ${symbol}`));
assert.ok(worker.includes("const providerIds = ['crawl4ai', 'native-fetch']"));
assert.ok(worker.includes("broker('record_trials'"));
assert.ok(worker.includes("broker('set_champion'"));
assert.ok(worker.includes('authority_expanded: false'));
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
console.log('Provider evolution contract validation passed');
