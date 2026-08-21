import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const read = (path) => fs.readFile(path, 'utf8');
const [policyText, runtime, worker, edge, migration, evidenceMigration, workflow] = await Promise.all([
  read('registry/venture-economy.json'),
  read('runtime/venture-economy.mjs'),
  read('scripts/venture-economy-worker.mjs'),
  read('supabase/functions/ai-factory-venture-runtime/index.ts'),
  read('infra/supabase/migrations/20260820_340_venture_economy_runtime.sql'),
  read('infra/supabase/migrations/20260820_341_venture_evidence.sql'),
  read('.github/workflows/venture-economy.yml'),
]);
const policy = JSON.parse(policyText);
const stages = ['RESOURCE','MATERIAL','GLOBAL_NEED','PRODUCT','MANUFACTURING','GO_TO_MARKET','USER_FEEDBACK','SELECTION'];

assert.equal(policy.mode, 'bounded-venture-evolution');
assert.deepEqual(policy.valueChain.stages, stages);
assert.ok(policy.valueChain.minimumCandidatesPerStage >= 3);
assert.ok(policy.valueChain.maximumChains >= 12);
for (const stage of stages.slice(0, -1)) assert.ok((policy.stageRouting[stage] || []).length >= 3, `stage ${stage} must have >=3 competitors`);
assert.equal(policy.authorityBoundary.rootOfTrustMutable, false);
assert.equal(policy.authorityBoundary.automaticAuthorityPromotion, false);
assert.equal(policy.authorityBoundary.maximumOffspringAutonomy, 'A2');
assert.equal(policy.authorityBoundary.productionWriteExpansion, false);
assert.equal(policy.authorityBoundary.externalPublication, false);
assert.equal(policy.authorityBoundary.financialCommitment, false);
assert.equal(policy.authorityBoundary.realWorldProcurement, false);
assert.equal(policy.breeding.offspringAutonomy, 'A2');
assert.deepEqual(policy.breeding.offspringInitialTools, []);
assert.equal(policy.breeding.offspringExternalPublication, false);
assert.equal(policy.breeding.offspringProductionAuthority, false);
assert.ok(policy.capabilityPromotion.minimumIndependentVenturesForCrossVenture >= 2);
assert.ok(policy.capabilityPromotion.minimumIndependentVenturesForFactoryWide >= 3);
assert.ok(policy.capabilityPromotion.minimumWinsPerVenture >= 2);

for (const symbol of ['validateStageCandidate','selectChampion','generateCompatibleChains','propagateChainConstraints','selectBestChain','detectSpecializationGap','breedSpecialist','capabilityTier','applyFeedbackToChain','buildVentureCell']) assert.ok(runtime.includes(`export function ${symbol}`), `runtime missing ${symbol}`);
assert.ok(runtime.includes('MATERIAL_COST_EXCEEDS_PRODUCT_LIMIT'));
assert.ok(runtime.includes('CAPEX_EXCEEDS_GTM_CEILING'));
assert.ok(runtime.includes("autonomy_level: 'A2'"));
assert.ok(runtime.includes('production_authority_granted: false'));
assert.ok(runtime.includes('publication_attempted: false'));

for (const table of ['af_value_chain_candidates','af_venture_cells','af_venture_cell_members','af_venture_experiments','af_venture_metrics','af_venture_bottlenecks','af_specialization_gaps','af_venture_feedback_events','af_capability_proofs','af_capability_promotions']) assert.ok(migration.includes(`public.${table}`), `migration missing ${table}`);
for (const fn of ['af_claim_venture_run','af_release_venture_run','af_set_active_champion','af_promote_capability_scope']) assert.ok(migration.includes(fn), `migration missing ${fn}`);
assert.ok(migration.includes("having count(*) >= 2"));
assert.ok(migration.includes("v_ventures >= 3"));
assert.ok(migration.includes("v_ventures >= 2"));
assert.ok(migration.includes("authority_expanded boolean not null default false check (authority_expanded = false)"));
assert.ok(migration.includes('enable row level security'));
assert.ok(migration.includes('to service_role'));
assert.ok(evidenceMigration.includes('public.af_venture_evidence'));
assert.ok(evidenceMigration.includes("evidence_class in ('MEASURED','OBSERVED','CONFIRMED','DERIVED')"));
assert.ok(evidenceMigration.includes('enable row level security'));

assert.ok(edge.includes('https://token.actions.githubusercontent.com'));
assert.ok(edge.includes('aifactory-venture-runtime'));
assert.ok(edge.includes('refs/heads/main'));
assert.ok(edge.includes('thethr0ne7/aifactory/.github/workflows/venture-economy.yml@refs/heads/main'));
assert.ok(edge.includes('repository_id !== EXPECTED_REPOSITORY_ID'));
assert.ok(edge.includes('offspring_authority_boundary_violation'));
assert.ok(edge.includes('r.production_authority_granted === true'));
assert.ok(edge.includes('r.publication_attempted === true'));
assert.ok(edge.includes('measured_regression_requires_repair_action'));
assert.ok(edge.includes('higher_scoring_valid_chain_exists'));
assert.ok(edge.includes('specialization_gap_threshold_not_met'));
assert.ok(edge.includes('promote_capability_scope'));
assert.ok(edge.includes('authority_expanded: false'));

assert.ok(worker.includes("tool('call_agent'"));
assert.ok(worker.includes("tool('create_agent'"));
assert.ok(worker.includes('This exact task is being sent to competing agents'));
assert.ok(worker.includes('const finalists = primary.slice(0, Math.min(2, primary.length));'));
assert.ok(worker.includes('for (let roundNo = 2; roundNo <= 3; roundNo += 1)'));
assert.ok(worker.includes("const rounds = id === child.candidate_id ? 5 : 3"));
assert.ok(worker.includes("scope.scope !== 'VENTURE_LOCAL'"));
assert.ok(worker.includes("broker('record_feedback'"));
assert.ok(worker.includes("broker('add_bottleneck_gap'"));
assert.ok(worker.includes("broker('spawn_offspring'"));
assert.ok(worker.includes("broker('resolve_gap'"));
assert.ok(worker.includes("broker('complete_run'"));
assert.ok(worker.includes("broker('create_cell'"));
assert.ok(!worker.includes("broker('update_cell_chain'"));
assert.ok(!worker.includes('SUPABASE_SERVICE_ROLE_KEY'));

assert.match(workflow, /permissions:\s*\n\s+contents:\s*read\s*\n\s+id-token:\s*write/m);
assert.doesNotMatch(workflow, /permissions:\s*write-all/i);
assert.doesNotMatch(workflow, /contents:\s*write/i);
assert.ok(workflow.includes("if: github.event_name != 'pull_request'"));
assert.ok(workflow.includes('N8N_MCP_TOKEN: ${{ secrets.N8N_MCP_TOKEN }}'));
assert.ok(workflow.includes('timeout-minutes: 45'));
assert.ok(workflow.includes('node scripts/venture-economy-worker.mjs'));

console.log('Venture Economy contract validation passed');
