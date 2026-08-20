import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const read=(p)=>fs.readFile(p,'utf8');
const [policyText,migration,broker,worker,telegram,workflow]=await Promise.all([
  read('registry/agent-organization.json'),
  read('infra/supabase/migrations/20260820_343_visible_agent_organization.sql'),
  read('supabase/functions/ai-factory-agent-org/index.ts'),
  read('scripts/agent-organization-worker.mjs'),
  read('supabase/functions/ai-factory-telegram-hq/index.ts'),
  read('.github/workflows/agent-organization.yml'),
]);
const policy=JSON.parse(policyText);

assert.equal(policy.factoryVersion,'2.7.0');
assert.equal(policy.mode,'visible-owner-controlled-agent-organization');
assert.equal(policy.telegram.oneBotManyAgents,true);
assert.deepEqual(policy.initiative.defaultMode,'AUTO_INTERNAL');
assert.equal(policy.initiative.maximumAutoTasksPerSession,16);
assert.equal(policy.initiative.maximumActiveTasks,4);
assert.equal(policy.initiative.maximumTaskDepth,6);
assert.deepEqual(policy.risk.autoExecutable,['LOW']);
assert.equal(policy.risk.rootOfTrustImmutable,true);
assert.equal(policy.risk.agentSelfPromotion,false);
for(const command of ['SUPPORT','REJECT','PAUSE','RESUME','STOP','SET_PRIORITY','SET_INITIATIVE_MODE','FOCUS','STATUS']) assert(policy.telegram.ownerControls.includes(command),`owner control missing ${command}`);

for(const table of ['af_agent_sessions','af_agent_tasks','af_agent_activity','af_agent_controls']){
  assert(migration.includes(`public.${table}`),`migration missing ${table}`);
  assert(migration.includes(`alter table public.${table} enable row level security`),`RLS missing ${table}`);
}
for(const rpc of ['af_claim_agent_tasks','af_finish_agent_task','af_fail_agent_task','af_claim_agent_activity','af_complete_agent_activity','af_fail_agent_activity','af_recover_agent_org']) assert(migration.includes(rpc),`migration missing ${rpc}`);
assert(migration.includes("initiative_mode in ('AUTO_INTERNAL','SUGGEST','OFF')"));
assert(migration.includes("risk_class in ('LOW','MEDIUM','HIGH','ROOT')"));
assert(migration.includes("requires_owner_approval"));
assert(migration.includes("unique(session_id,fingerprint)"));
assert(migration.includes("grant all on public.af_agent_sessions,public.af_agent_tasks,public.af_agent_activity,public.af_agent_controls to service_role"));

assert(broker.includes('const AUDIENCE="aifactory-agent-org"'));
assert(broker.includes('EXPECTED_REPOSITORY_ID="1334997374"'));
assert(broker.includes('EXPECTED_REF="refs/heads/main"'));
assert(broker.includes('agent-organization.yml@refs/heads/main'));
assert(broker.includes('action==="create_task"'));
assert(broker.includes('expected_value_below_threshold'));
assert(broker.includes('task_depth_limit'));
assert(broker.includes('auto_task_budget_exhausted'));
assert(broker.includes('initiative_mode_off'));
assert(broker.includes('ownerGateText'));
for(const marker of ['publish','production write','purchase','credential','permission','autonomy','root of trust','external side effect','merge to main']) assert(broker.toLowerCase().includes(marker),`owner gate marker missing ${marker}`);

assert(worker.includes("delegations.slice(0,2)"),'delegations must be bounded to two');
assert(worker.includes("claim_idle_session"),'idle initiative scan missing');
assert(worker.includes("initiativeAgents"),'initiative rotation missing');
assert(worker.includes("deliver_agent_activity"),'Telegram event delivery missing');
assert(worker.includes("status:'DONE|DELEGATE|BLOCKED|WAIT_OWNER'"),'strict work-result contract missing');
assert(worker.includes("Do not create tasks merely to keep busy"),'anti-busywork instruction missing');
assert(worker.includes("PROVIDER_FAILURE"),'provider failure guard missing');

for(const command of ['/status','/new','/pause','/resume','/stop','/initiative','/focus','/support','/reject','/priority']) assert(telegram.includes(`command==='${command}'`)||telegram.includes(`command==="${command}"`),`Telegram command missing ${command}`);
for(const callback of ['af:pause:','af:resume:','af:stop:','af:status:','af:support:','af:reject:']) assert(telegram.includes(callback),`Telegram callback missing ${callback}`);
assert(telegram.includes('deliver_agent_activity'));
assert(telegram.includes('af_agent_activity'));
assert(telegram.includes('agent_live_mode'));
assert(telegram.includes('default_initiative_mode'));
assert(telegram.includes("if(message.from?.is_bot)return json({ok:true,ignored:\"bot_message\"})"),'bot-originated inbound must remain ignored; agent visibility is rendered from durable events');

assert(workflow.includes("cron: '*/5 * * * *'"));
assert(workflow.includes('contents: read'));
assert(workflow.includes('id-token: write'));
assert(!/^\s*(contents|actions|checks|deployments|packages|pull-requests|statuses|security-events):\s*write\s*$/mi.test(workflow),'workflow may not request write permissions other than OIDC id-token');
assert(!/permissions:\s*write-all/i.test(workflow),'write-all forbidden');
assert(workflow.includes("if: github.event_name != 'pull_request'"),'PR must not execute live agent work');

console.log('VISIBLE_AGENT_ORGANIZATION_VALIDATION_OK');
