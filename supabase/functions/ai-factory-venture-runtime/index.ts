import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "npm:jose@6";

type Claims = JWTPayload & {
  repository?: string;
  repository_id?: string;
  ref?: string;
  event_name?: string;
  workflow_ref?: string;
  job_workflow_ref?: string;
  run_id?: string;
  actor?: string;
  sha?: string;
};

type Body = {
  action?: string;
  worker?: string;
  run_id?: string;
  candidate_id?: string;
  ids?: string[];
  record?: Record<string, unknown>;
  records?: Record<string, unknown>[];
  objective?: string;
  hypothesis?: string;
  run_mode?: string;
};

const SUPABASE_URL = mustEnv("SUPABASE_URL");
const db = createClient(SUPABASE_URL, adminKey(), { auth: { persistSession: false, autoRefreshToken: false } });
const ISSUER = "https://token.actions.githubusercontent.com";
const AUDIENCE = "aifactory-venture-runtime";
const EXPECTED_REPOSITORY = "thethr0ne7/aifactory";
const EXPECTED_REPOSITORY_ID = "1334997374";
const EXPECTED_REF = "refs/heads/main";
const EXPECTED_WORKFLOW = "thethr0ne7/aifactory/.github/workflows/venture-economy.yml@refs/heads/main";
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks`));
const ALLOWED_EVENTS = new Set(["push", "schedule", "workflow_dispatch"]);
const STAGES = new Set(["RESOURCE", "MATERIAL", "GLOBAL_NEED", "PRODUCT", "MANUFACTURING", "GO_TO_MARKET", "USER_FEEDBACK", "SELECTION"]);
const EVIDENCE = new Set(["MEASURED", "OBSERVED", "CONFIRMED", "DERIVED"]);
const FITNESS_DIMENSIONS = ["task_success", "evidence_quality", "truthfulness", "contradiction_detection", "downstream_value", "latency", "cost_efficiency", "tool_discipline", "safety_compliance"];
const CONTROL_OBJECTIVE = "Hosted control: prove a complete evidence-gated venture lifecycle without external spending, publication, procurement, or authority expansion.";
const CONTROL_HYPOTHESIS = "A compatible resource-to-market chain can be selected, a measurable purification bottleneck can trigger a bounded specialist birth, and feedback can repair the chain while all authority remains A2/bounded.";
const CONTROL_SCENARIO = {
  scenario_id: "VX1",
  evidence_class: "DERIVED",
  disclaimer: "Synthetic control facts for exercising the live runtime; they are not claims about the external world.",
  resource_options: [
    { id: "R-A", unit_cost: 8, annual_capacity: 100000, supply_risk: 20, regulatory_risk: 25 },
    { id: "R-B", unit_cost: 11, annual_capacity: 160000, supply_risk: 12, regulatory_risk: 32 },
    { id: "R-C", unit_cost: 6, annual_capacity: 65000, supply_risk: 38, regulatory_risk: 18 }
  ],
  material_options: [
    { id: "M-A", unit_cost: 22, purity_pct: 95, yield_pct: 78, energy_index: 12, purification_cost_share: 0.42 },
    { id: "M-B", unit_cost: 31, purity_pct: 99.5, yield_pct: 69, energy_index: 22, purification_cost_share: 0.49 },
    { id: "M-C", unit_cost: 17, purity_pct: 90, yield_pct: 84, energy_index: 8, purification_cost_share: 0.34 }
  ],
  product_constraints: { max_material_input_cost: 25, minimum_purity_pct: 92, target_gross_margin: 45 },
  manufacturing_options: [
    { id: "MF-A", capex: 12000000, opex: 5200000, time_to_market_months: 14 },
    { id: "MF-B", capex: 20000000, opex: 4100000, time_to_market_months: 18 },
    { id: "MF-C", capex: 35000000, opex: 3300000, time_to_market_months: 24 }
  ],
  market_constraints: { capital_ceiling: 25000000, target_adoption_probability: 0.68, target_gross_margin: 45 },
  feedback: { kind: "manufacturing cost regression", severity: 0.72, measured_regression: true, summary: "Purification remains 42% of transformation cost and constrains margin." },
  gap: { stage: "MANUFACTURING", specialization: "industrial purification optimization", metric: "purification_cost_share", description: "Reduce purification share while preserving >=92% purity and >=78% yield.", severity: 0.42, existing_capability_score: 68, expected_gain: 17 }
};

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const claims = await authenticate(request);
    const body = await safeJson<Body>(request);
    const action = clean(body.action, 80);
    const provenance = {
      provider: "github-actions-oidc",
      repository: claims.repository,
      ref: claims.ref,
      workflow_ref: claims.job_workflow_ref ?? claims.workflow_ref,
      github_run_id: claims.run_id,
      github_sha: claims.sha,
      actor: claims.actor,
      authenticated_at: new Date().toISOString()
    };

    if (action === "start_control") {
      const sha = clean(claims.sha, 64);
      if (sha) {
        const { data: existing, error } = await db.from("af_value_chain_runs")
          .select("*")
          .eq("run_mode", "LIVE_RUNTIME_SYNTHETIC_SCENARIO")
          .contains("provenance", { github_sha: sha })
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        if (existing) return json({ created: false, run: existing });
      }
      const record = {
        objective: CONTROL_OBJECTIVE,
        hypothesis: CONTROL_HYPOTHESIS,
        status: "DISCOVERING",
        current_stage: "RESOURCE",
        run_mode: "LIVE_RUNTIME_SYNTHETIC_SCENARIO",
        context: { control_scenario: CONTROL_SCENARIO, budget: { external_spend: 0 }, kpis: { authority_expansion: 0, external_side_effects: 0 }, assumptions: ["Control scenario is synthetic and cannot establish external-world truth."] },
        selected_chain: {},
        provenance: { ...provenance, github_sha: sha, control_scenario: "VX1" }
      };
      const { data, error } = await db.from("af_value_chain_runs").insert(record).select("*").single();
      if (error) throw error;
      return json({ created: true, run: data });
    }

    if (action === "start_run") {
      if (claims.event_name !== "workflow_dispatch") return json({ error: "manual_dispatch_required" }, 403);
      const objective = clean(body.objective, 4000);
      if (!objective) return json({ error: "objective_required" }, 400);
      const mode = clean(body.run_mode || "LIVE", 64);
      if (!new Set(["LIVE", "LIVE_RUNTIME_SYNTHETIC_SCENARIO"]).has(mode)) return json({ error: "invalid_run_mode" }, 400);
      const { data, error } = await db.from("af_value_chain_runs").insert({
        objective,
        hypothesis: nullable(body.hypothesis, 4000),
        status: "DISCOVERING",
        current_stage: "RESOURCE",
        run_mode: mode,
        context: mode === "LIVE_RUNTIME_SYNTHETIC_SCENARIO" ? { control_scenario: CONTROL_SCENARIO } : {},
        selected_chain: {},
        provenance
      }).select("*").single();
      if (error) throw error;
      return json({ created: true, run: data });
    }

    if (action === "claim") {
      const worker = clean(body.worker || `venture:${claims.run_id || "unknown"}`, 200);
      const { data, error } = await db.rpc("af_claim_venture_run", { p_worker: worker });
      if (error) throw error;
      return json({ run: Array.isArray(data) ? data[0] ?? null : data ?? null });
    }

    if (action === "get_run") {
      const runId = uuid(body.run_id, "run_id");
      const { data, error } = await db.from("af_value_chain_runs").select("*").eq("id", runId).single();
      if (error) throw error;
      return json({ run: data });
    }

    if (action === "get_candidates") {
      const ids = uniqueStrings(body.ids, 40, 120).map(candidateId);
      if (!ids.length) return json({ candidates: [] });
      const { data, error } = await db.from("af_agent_candidates")
        .select("candidate_id,n8n_agent_id,name,generation,role,state,autonomy_level,parent_refs,skills,tools,model,mutation_summary,fitness,metadata")
        .in("candidate_id", ids);
      if (error) throw error;
      return json({ candidates: data ?? [] });
    }

    if (action === "add_evidence") {
      const r = record(body.record);
      const runId = uuid(r.run_id, "run_id");
      const stage = stageValue(r.stage);
      const producer = candidateId(r.producer_candidate_id);
      const evidenceClass = evidenceValue(r.evidence_class);
      const claim = clean(r.claim, 6000);
      if (!claim) return json({ error: "claim_required" }, 400);
      const sourceRefs = uniqueStrings(r.source_refs, 40, 300);
      if (!sourceRefs.length) return json({ error: "source_refs_required" }, 400);
      await assertRun(runId);
      await assertCandidates([producer]);
      const { data, error } = await db.from("af_venture_evidence").insert({
        run_id: runId,
        stage,
        producer_candidate_id: producer,
        evidence_class: evidenceClass,
        claim,
        source_refs: sourceRefs,
        payload: object(r.payload),
        provenance: { ...object(r.provenance), broker: provenance }
      }).select("id").single();
      if (error) throw error;
      return json({ evidence_id: data.id });
    }

    if (action === "add_stage_result") {
      const r = record(body.record);
      const runId = uuid(r.run_id, "run_id");
      const stage = stageValue(r.stage);
      const candidate = candidateId(r.candidate_id);
      const evidenceClass = evidenceValue(r.evidence_class);
      const evidenceRefs = uuidArray(r.evidence_refs, 40, "evidence_refs");
      if (!evidenceRefs.length) return json({ error: "evidence_refs_required" }, 400);
      const status = clean(r.status || "PASS", 24);
      if (!new Set(["PROPOSED", "PASS", "BLOCK", "REPAIR", "SUPERSEDED"]).has(status)) return json({ error: "invalid_stage_status" }, 400);
      await assertEvidence(runId, candidate, evidenceRefs);
      const { data, error } = await db.from("af_value_chain_stage_results").insert({
        run_id: runId,
        stage,
        candidate_id: candidate,
        claim: clean(r.claim, 6000),
        evidence_class: evidenceClass,
        evidence_refs: evidenceRefs,
        metrics: object(r.metrics),
        status
      }).select("id").single();
      if (error) throw error;
      await db.from("af_value_chain_runs").update({ current_stage: stage, updated_at: new Date().toISOString() }).eq("id", runId);
      return json({ stage_result_id: data.id });
    }

    if (action === "add_fitness_trials") {
      const rows = Array.isArray(body.records) ? body.records.slice(0, 30) : [];
      if (!rows.length) return json({ error: "records_required" }, 400);
      const inserts = [];
      for (const raw of rows) {
        const r = record(raw);
        const candidate = candidateId(r.candidate_id);
        const evidenceRefs = uuidArray(r.evidence_refs, 40, "evidence_refs");
        const scores = fitnessScores(r.scores);
        if (!evidenceRefs.length) return json({ error: "fitness_evidence_required" }, 400);
        const outcome = clean(r.outcome || "PASS", 24);
        if (!new Set(["PASS", "FAIL", "INCONCLUSIVE", "BLOCKED"]).has(outcome)) return json({ error: "invalid_fitness_outcome" }, 400);
        inserts.push({
          candidate_id: candidate,
          niche: clean(r.niche, 160),
          context_key: clean(r.context_key || "global", 240),
          task_ref: nullable(r.task_ref, 400),
          outcome,
          scores,
          evidence_refs: evidenceRefs,
          latency_ms: boundedInt(r.latency_ms, 0, 3600000),
          cost_units: boundedNumber(r.cost_units, 0, 1000000000),
          provenance: { ...object(r.provenance), broker: provenance }
        });
      }
      const { data, error } = await db.from("af_agent_fitness_trials").insert(inserts).select("id,candidate_id,niche,context_key,outcome");
      if (error) throw error;
      return json({ trials: data ?? [] });
    }

    if (action === "set_champion") {
      const r = record(body.record);
      const candidate = candidateId(r.candidate_id);
      const { data, error } = await db.rpc("af_set_active_champion", {
        p_niche: clean(r.niche, 160),
        p_context_key: clean(r.context_key || "global", 240),
        p_candidate_id: candidate,
        p_fitness_snapshot: object(r.fitness_snapshot),
        p_evidence_refs: uuidArray(r.evidence_refs, 40, "evidence_refs")
      });
      if (error) throw error;
      return json({ champion_id: data, candidate_id: candidate });
    }

    if (action === "add_chains") {
      const runId = uuid(body.run_id, "run_id");
      const rows = Array.isArray(body.records) ? body.records.slice(0, 128) : [];
      if (!rows.length) return json({ error: "records_required" }, 400);
      const inserts = rows.map((raw, index) => {
        const r = record(raw);
        return {
          run_id: runId,
          chain_key: clean(r.chain_key || r.id || `chain-${index + 1}`, 200),
          composition: object(r.composition),
          metrics: object(r.metrics),
          constraint_result: object(r.constraint_result),
          valid: r.valid === true,
          score: finiteOrNull(r.score),
          rank: boundedInt(r.rank ?? index + 1, 1, 10000),
          selected: false,
          provenance: { ...object(r.provenance), broker: provenance }
        };
      });
      const { data, error } = await db.from("af_value_chain_candidates").upsert(inserts, { onConflict: "run_id,chain_key" }).select("id,chain_key,valid,score,rank");
      if (error) throw error;
      return json({ chains: data ?? [] });
    }

    if (action === "select_chain") {
      const r = record(body.record);
      const runId = uuid(r.run_id, "run_id");
      const chainKey = clean(r.chain_key, 200);
      const { data: target, error: targetError } = await db.from("af_value_chain_candidates").select("id,chain_key,composition,metrics,valid,score,constraint_result").eq("run_id", runId).eq("chain_key", chainKey).single();
      if (targetError || !target) return json({ error: "chain_not_found" }, 404);
      if (target.valid !== true || !Number.isFinite(Number(target.score))) return json({ error: "chain_not_valid" }, 409);
      const { data: better, error: betterError } = await db.from("af_value_chain_candidates").select("id").eq("run_id", runId).eq("valid", true).gt("score", target.score).limit(1);
      if (betterError) throw betterError;
      if (better?.length) return json({ error: "higher_scoring_valid_chain_exists" }, 409);
      await db.from("af_value_chain_candidates").update({ selected: false, updated_at: new Date().toISOString() }).eq("run_id", runId).eq("selected", true);
      const { error } = await db.from("af_value_chain_candidates").update({ selected: true, updated_at: new Date().toISOString() }).eq("id", target.id);
      if (error) throw error;
      await db.from("af_value_chain_runs").update({ current_stage: "SELECTION", status: "ACTIONABLE", selected_chain: { chain_id: target.id, chain_key: target.chain_key, composition: target.composition, metrics: target.metrics, score: target.score }, updated_at: new Date().toISOString() }).eq("id", runId);
      return json({ selected: target });
    }

    if (action === "create_cell") {
      const r = record(body.record);
      const runId = uuid(r.run_id, "run_id");
      const { data: run, error: runError } = await db.from("af_value_chain_runs").select("id,objective,hypothesis,context,selected_chain").eq("id", runId).single();
      if (runError) throw runError;
      const chainId = uuid(object(run.selected_chain).chain_id, "selected_chain_id");
      const { data: chain, error: chainError } = await db.from("af_value_chain_candidates").select("id,composition,metrics,valid,selected").eq("id", chainId).eq("run_id", runId).single();
      if (chainError || !chain || chain.valid !== true || chain.selected !== true) return json({ error: "selected_chain_required" }, 409);
      const evidenceRefs = uuidArray(r.evidence_refs, 120, "evidence_refs");
      const { data: cell, error } = await db.from("af_venture_cells").upsert({
        run_id: runId,
        objective: run.objective,
        hypothesis: run.hypothesis,
        status: "ACTIVE",
        champion_chain_id: chain.id,
        champion_chain: chain.composition,
        budget: object(object(run.context).budget),
        kpis: object(object(run.context).kpis),
        assumptions: array(object(run.context).assumptions).slice(0, 40),
        evidence_refs: evidenceRefs,
        provenance: { ...object(r.provenance), broker: provenance },
        updated_at: new Date().toISOString()
      }, { onConflict: "run_id" }).select("*").single();
      if (error) throw error;
      const members = uniqueStrings(r.members, 30, 120).map(candidateId);
      if (members.length) {
        await assertCandidates(members);
        const memberRows = members.map((candidate) => ({ venture_cell_id: cell.id, candidate_id: candidate, role: "champion-chain-member", scope: "VENTURE_LOCAL", active: true, provenance: { broker: provenance } }));
        const { error: memberError } = await db.from("af_venture_cell_members").upsert(memberRows, { onConflict: "venture_cell_id,candidate_id,role" });
        if (memberError) throw memberError;
      }
      return json({ cell });
    }

    if (action === "add_bottleneck_gap") {
      const r = record(body.record);
      const cellId = uuid(r.venture_cell_id, "venture_cell_id");
      const stage = stageValue(r.stage);
      if (stage === "SELECTION") return json({ error: "invalid_bottleneck_stage" }, 400);
      const severity = boundedNumber(r.severity, 0, 1);
      const capability = boundedNumber(r.existing_capability_score, 0, 100);
      const gain = boundedNumber(r.expected_gain, 0, 100);
      if (severity < 0.25 || capability > 75 || gain < 5) return json({ error: "specialization_gap_threshold_not_met" }, 409);
      const evidenceRefs = uuidArray(r.evidence_refs, 40, "evidence_refs");
      if (!evidenceRefs.length) return json({ error: "gap_evidence_required" }, 400);
      const parents = uniqueStrings(r.parent_refs, 4, 120).map(candidateId);
      if (parents.length < 2) return json({ error: "at_least_two_parents_required" }, 400);
      await assertCandidates(parents);
      const { data: cell, error: cellError } = await db.from("af_venture_cells").select("id,run_id").eq("id", cellId).single();
      if (cellError) throw cellError;
      await assertEvidenceIds(cell.run_id, evidenceRefs);
      const { data: bottleneck, error } = await db.from("af_venture_bottlenecks").insert({
        venture_cell_id: cellId,
        stage,
        specialization: clean(r.specialization, 240),
        metric: clean(r.metric, 160),
        description: clean(r.description, 4000),
        severity,
        existing_capability_score: capability,
        expected_gain: gain,
        evidence_class: evidenceValue(r.evidence_class || "MEASURED"),
        evidence_refs: evidenceRefs,
        status: "GAP_CONFIRMED",
        provenance: { ...object(r.provenance), broker: provenance }
      }).select("*").single();
      if (error) throw error;
      const { data: gap, error: gapError } = await db.from("af_specialization_gaps").insert({
        venture_cell_id: cellId,
        bottleneck_id: bottleneck.id,
        specialization: bottleneck.specialization,
        metric: bottleneck.metric,
        severity,
        existing_capability_score: capability,
        expected_gain: gain,
        parent_refs: parents,
        status: "CONFIRMED",
        evidence_refs: evidenceRefs,
        provenance: { ...object(r.provenance), broker: provenance }
      }).select("*").single();
      if (gapError) throw gapError;
      return json({ bottleneck, gap });
    }

    if (action === "spawn_offspring") {
      const r = record(body.record);
      const gapId = uuid(r.gap_id, "gap_id");
      const { data: gap, error: gapError } = await db.from("af_specialization_gaps").select("*,af_venture_cells(run_id)").eq("id", gapId).single();
      if (gapError) throw gapError;
      if (!new Set(["CONFIRMED", "BREEDING"]).has(String(gap.status))) return json({ error: "gap_not_breedable" }, 409);
      const candidate = candidateId(r.candidate_id);
      const autonomy = clean(r.autonomy_level || "A2", 2);
      if (autonomy !== "A2" || array(r.tools).length || r.production_authority_granted === true || r.publication_attempted === true) return json({ error: "offspring_authority_boundary_violation" }, 403);
      const parents = uniqueStrings(r.parent_refs, 4, 120).map(candidateId);
      if (parents.length < 2 || parents.some((parent) => !gap.parent_refs.includes(parent))) return json({ error: "offspring_parent_mismatch" }, 409);
      await assertCandidates(parents);
      const generation = boundedInt(r.generation, 1, 12);
      const candidateRecord = {
        candidate_id: candidate,
        n8n_agent_id: nullable(r.n8n_agent_id, 240),
        name: clean(r.name, 240),
        generation,
        role: clean(r.role, 160),
        state: "SPAWNED",
        autonomy_level: "A2",
        parent_refs: parents,
        skills: array(r.skills).slice(0, 40),
        tools: [],
        model: object(r.model),
        mutation_summary: nullable(r.mutation_summary, 4000),
        fitness: {},
        provenance: { ...object(r.provenance), broker: provenance, source_gap_id: gapId },
        metadata: { venture_scope: "VENTURE_LOCAL", production_authority_granted: false, publication_attempted: false, communication_transport: "AF-HANDOFF/1" },
        updated_at: new Date().toISOString()
      };
      const { error: candidateError } = await db.from("af_agent_candidates").upsert(candidateRecord, { onConflict: "candidate_id" });
      if (candidateError) throw candidateError;
      const immutable = { root_of_trust_mutable: false, maximum_autonomy: "A2", production_authority: false, external_publication: false, secret_scope_expansion: false };
      const genome = object(r.genome);
      const { error: genomeError } = await db.from("af_agent_genomes").upsert({ candidate_id: candidate, genome_version: 1, genome, immutable_factory_genes: immutable, lineage_refs: parents, updated_at: new Date().toISOString() }, { onConflict: "candidate_id" });
      if (genomeError) throw genomeError;
      const { data: breeding, error: breedingError } = await db.from("af_agent_breeding_events").insert({
        objective: `Resolve specialization gap: ${gap.specialization}`,
        niche: gap.specialization,
        context_key: `venture:${gap.venture_cell_id}`,
        parent_refs: parents,
        parent_traits: object(r.parent_traits),
        crossover: object(r.crossover),
        mutation: object(r.mutation),
        expected_gain: { metric: gap.metric, expected_gain: gap.expected_gain },
        child_candidate_id: candidate,
        status: "SPAWNED",
        evidence_refs: gap.evidence_refs,
        provenance: { ...object(r.provenance), broker: provenance, gap_id: gapId }
      }).select("*").single();
      if (breedingError) throw breedingError;
      await db.from("af_specialization_gaps").update({ child_candidate_id: candidate, breeding_event_id: breeding.id, status: "EVALUATING", updated_at: new Date().toISOString() }).eq("id", gapId);
      const { error: memberError } = await db.from("af_venture_cell_members").upsert({ venture_cell_id: gap.venture_cell_id, candidate_id: candidate, role: gap.specialization, scope: "VENTURE_LOCAL", active: true, provenance: { broker: provenance } }, { onConflict: "venture_cell_id,candidate_id,role" });
      if (memberError) throw memberError;
      return json({ candidate: candidateRecord, breeding_event: breeding });
    }

    if (action === "record_capability_proof") {
      const r = record(body.record);
      const candidate = candidateId(r.candidate_id);
      const cellId = uuid(r.venture_cell_id, "venture_cell_id");
      const outcome = clean(r.outcome, 24);
      if (!new Set(["WIN", "LOSS", "INCONCLUSIVE", "BLOCKED"]).has(outcome)) return json({ error: "invalid_capability_outcome" }, 400);
      const { data, error } = await db.from("af_capability_proofs").insert({
        candidate_id: candidate,
        venture_cell_id: cellId,
        outcome,
        metric: clean(r.metric, 160),
        value: finiteOrNull(r.value),
        evidence_refs: uuidArray(r.evidence_refs, 40, "evidence_refs"),
        provenance: { ...object(r.provenance), broker: provenance }
      }).select("*").single();
      if (error) throw error;
      return json({ proof: data });
    }

    if (action === "promote_capability_scope") {
      const candidate = candidateId(body.candidate_id);
      const { data, error } = await db.rpc("af_promote_capability_scope", { p_candidate_id: candidate });
      if (error) throw error;
      return json({ candidate_id: candidate, scope: data, authority_expanded: false });
    }

    if (action === "record_feedback") {
      const r = record(body.record);
      const cellId = uuid(r.venture_cell_id, "venture_cell_id");
      const runId = uuid(r.run_id, "run_id");
      const targetStage = stageValue(r.target_stage);
      if (targetStage === "SELECTION") return json({ error: "invalid_feedback_target" }, 400);
      const actionValue = clean(r.feedback_action || r.action, 32);
      if (!new Set(["CONFIRM", "LOWER_CONFIDENCE", "REPAIR", "SUPERSEDE", "BRANCH"]).has(actionValue)) return json({ error: "invalid_feedback_action" }, 400);
      const severity = boundedNumber(r.severity, 0, 1);
      const regression = r.measured_regression === true;
      if (regression && !new Set(["REPAIR", "SUPERSEDE", "BRANCH"]).has(actionValue)) return json({ error: "measured_regression_requires_repair_action" }, 409);
      const evidenceRefs = uuidArray(r.evidence_refs, 40, "evidence_refs");
      await assertEvidenceIds(runId, evidenceRefs);
      const { data: event, error } = await db.from("af_venture_feedback_events").insert({
        venture_cell_id: cellId,
        run_id: runId,
        kind: clean(r.kind, 160),
        summary: clean(r.summary, 4000),
        severity,
        measured_regression: regression,
        target_stage: targetStage,
        action: actionValue,
        evidence_class: evidenceValue(r.evidence_class || "MEASURED"),
        evidence_refs: evidenceRefs,
        provenance: { ...object(r.provenance), broker: provenance }
      }).select("*").single();
      if (error) throw error;
      if (new Set(["REPAIR", "SUPERSEDE", "BRANCH"]).has(actionValue)) {
        const stageStatus = actionValue === "SUPERSEDE" ? "SUPERSEDED" : "REPAIR";
        await db.from("af_value_chain_stage_results").update({ status: stageStatus }).eq("run_id", runId).eq("stage", targetStage).eq("status", "PASS");
        await db.from("af_value_chain_runs").update({ status: "WORKING", current_stage: targetStage, updated_at: new Date().toISOString() }).eq("id", runId);
        await db.from("af_venture_cells").update({ status: "REPAIRING", updated_at: new Date().toISOString() }).eq("id", cellId);
      }
      return json({ feedback: event });
    }

    if (action === "resolve_gap") {
      const r = record(body.record);
      const gapId = uuid(r.gap_id, "gap_id");
      const child = candidateId(r.child_candidate_id);
      const { data: gap, error: gapError } = await db.from("af_specialization_gaps").select("id,venture_cell_id,child_candidate_id,breeding_event_id").eq("id", gapId).single();
      if (gapError) throw gapError;
      if (gap.child_candidate_id !== child) return json({ error: "gap_child_mismatch" }, 409);
      await db.from("af_specialization_gaps").update({ status: "RESOLVED", updated_at: new Date().toISOString() }).eq("id", gapId);
      if (gap.breeding_event_id) await db.from("af_agent_breeding_events").update({ status: "RETAINED", updated_at: new Date().toISOString() }).eq("id", gap.breeding_event_id);
      await db.from("af_venture_bottlenecks").update({ status: "RESOLVED", updated_at: new Date().toISOString() }).eq("venture_cell_id", gap.venture_cell_id).eq("status", "GAP_CONFIRMED");
      await db.from("af_venture_cells").update({ status: "ACTIVE", updated_at: new Date().toISOString() }).eq("id", gap.venture_cell_id);
      return json({ resolved: true, gap_id: gapId, child_candidate_id: child });
    }

    if (action === "complete_run") {
      const runId = uuid(body.run_id, "run_id");
      const { data: selected, error: selectedError } = await db.from("af_value_chain_candidates").select("id").eq("run_id", runId).eq("selected", true).eq("valid", true).limit(1);
      if (selectedError) throw selectedError;
      const { data: cell, error: cellError } = await db.from("af_venture_cells").select("id,status").eq("run_id", runId).maybeSingle();
      if (cellError) throw cellError;
      if (!selected?.length || !cell) return json({ error: "run_not_actionable" }, 409);
      const { data, error } = await db.rpc("af_release_venture_run", { p_run_id: runId, p_status: "COMPLETE", p_error: {} });
      if (error) throw error;
      await db.from("af_venture_cells").update({ status: "COMPLETE", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", cell.id);
      return json({ completed: data === true, run_id: runId });
    }

    if (action === "fail_run") {
      const runId = uuid(body.run_id, "run_id");
      const r = object(body.record);
      const status = clean(r.status || "BLOCKED", 24);
      if (!new Set(["BLOCKED", "REJECTED", "WORKING"]).has(status)) return json({ error: "invalid_fail_status" }, 400);
      const { data, error } = await db.rpc("af_release_venture_run", { p_run_id: runId, p_status: status, p_error: object(r.error) });
      if (error) throw error;
      return json({ released: data === true });
    }

    if (action === "snapshot") {
      const runId = uuid(body.run_id, "run_id");
      const runQuery = db.from("af_value_chain_runs").select("*").eq("id", runId).single();
      const stagesQuery = db.from("af_value_chain_stage_results").select("*").eq("run_id", runId).order("created_at");
      const evidenceQuery = db.from("af_venture_evidence").select("*").eq("run_id", runId).order("created_at");
      const chainsQuery = db.from("af_value_chain_candidates").select("*").eq("run_id", runId).order("rank");
      const cellQuery = db.from("af_venture_cells").select("*").eq("run_id", runId).maybeSingle();
      const [runR, stagesR, evidenceR, chainsR, cellR] = await Promise.all([runQuery, stagesQuery, evidenceQuery, chainsQuery, cellQuery]);
      for (const result of [runR, stagesR, evidenceR, chainsR, cellR]) if (result.error) throw result.error;
      const cell = cellR.data;
      let extras: Record<string, unknown> = { bottlenecks: [], gaps: [], members: [], feedback: [], capability_proofs: [] };
      if (cell?.id) {
        const [b, g, m, f, p] = await Promise.all([
          db.from("af_venture_bottlenecks").select("*").eq("venture_cell_id", cell.id),
          db.from("af_specialization_gaps").select("*").eq("venture_cell_id", cell.id),
          db.from("af_venture_cell_members").select("*").eq("venture_cell_id", cell.id),
          db.from("af_venture_feedback_events").select("*").eq("venture_cell_id", cell.id),
          db.from("af_capability_proofs").select("*").eq("venture_cell_id", cell.id)
        ]);
        for (const result of [b, g, m, f, p]) if (result.error) throw result.error;
        extras = { bottlenecks: b.data ?? [], gaps: g.data ?? [], members: m.data ?? [], feedback: f.data ?? [], capability_proofs: p.data ?? [] };
      }
      const candidates = uniqueStrings((stagesR.data ?? []).map((row: any) => row.candidate_id), 80, 120);
      let champions: unknown[] = [];
      let breeding: unknown[] = [];
      let promotions: unknown[] = [];
      if (candidates.length) {
        const [c, br, pr] = await Promise.all([
          db.from("af_agent_champions").select("*").in("candidate_id", candidates).order("selected_at"),
          db.from("af_agent_breeding_events").select("*").or(candidates.map((id) => `child_candidate_id.eq.${id}`).join(",")),
          db.from("af_capability_promotions").select("*").in("candidate_id", candidates).order("created_at")
        ]);
        if (c.error) throw c.error;
        if (br.error) throw br.error;
        if (pr.error) throw pr.error;
        champions = c.data ?? [];
        breeding = br.data ?? [];
        promotions = pr.data ?? [];
      }
      return json({ run: runR.data, stages: stagesR.data ?? [], evidence: evidenceR.data ?? [], chains: chainsR.data ?? [], cell, champions, breeding, capability_promotions: promotions, ...extras });
    }

    return json({ error: "unsupported_action" }, 400);
  } catch (error) {
    const message = safeError(error);
    const unauthorized = message.startsWith("oidc_") || message.startsWith("invalid_");
    console.error(JSON.stringify({ event: "venture_runtime_error", error: message }));
    return json({ error: unauthorized ? "unauthorized" : "venture_runtime_error", detail: message }, unauthorized ? 401 : 500);
  }
});

async function authenticate(request: Request): Promise<Claims> {
  const token = (request.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new Error("oidc_missing_bearer_token");
  const { payload } = await jwtVerify(token, JWKS, { issuer: ISSUER, audience: AUDIENCE, algorithms: ["RS256"], clockTolerance: 10 });
  const claims = payload as Claims;
  if (claims.repository !== EXPECTED_REPOSITORY) throw new Error("oidc_repository_mismatch");
  if (claims.repository_id !== EXPECTED_REPOSITORY_ID) throw new Error("oidc_repository_id_mismatch");
  if (claims.ref !== EXPECTED_REF) throw new Error("oidc_ref_mismatch");
  if (!ALLOWED_EVENTS.has(String(claims.event_name || ""))) throw new Error("oidc_event_mismatch");
  const workflow = String(claims.job_workflow_ref ?? claims.workflow_ref ?? "");
  if (workflow !== EXPECTED_WORKFLOW) throw new Error("oidc_workflow_mismatch");
  return claims;
}

async function assertRun(runId: string) {
  const { data, error } = await db.from("af_value_chain_runs").select("id").eq("id", runId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("invalid_run_not_found");
}
async function assertCandidates(ids: string[]) {
  const unique = [...new Set(ids)];
  const { data, error } = await db.from("af_agent_candidates").select("candidate_id").in("candidate_id", unique);
  if (error) throw error;
  if ((data ?? []).length !== unique.length) throw new Error("invalid_candidate_not_found");
}
async function assertEvidence(runId: string, producer: string, ids: string[]) {
  const { data, error } = await db.from("af_venture_evidence").select("id").eq("run_id", runId).eq("producer_candidate_id", producer).in("id", ids);
  if (error) throw error;
  if ((data ?? []).length !== [...new Set(ids)].length) throw new Error("invalid_evidence_producer_or_run_mismatch");
}
async function assertEvidenceIds(runId: string, ids: string[]) {
  if (!ids.length) throw new Error("invalid_evidence_required");
  const { data, error } = await db.from("af_venture_evidence").select("id").eq("run_id", runId).in("id", ids);
  if (error) throw error;
  if ((data ?? []).length !== [...new Set(ids)].length) throw new Error("invalid_evidence_run_mismatch");
}
function record(value: unknown): Record<string, any> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_record_required"); return value as Record<string, any>; }
function object(value: unknown): Record<string, any> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}; }
function array(value: unknown): any[] { return Array.isArray(value) ? value : []; }
function clean(value: unknown, max: number) { return String(value ?? "").replace(/[\u0000\r]+/g, " ").trim().slice(0, max); }
function nullable(value: unknown, max: number) { const v = clean(value, max); return v || null; }
function uniqueStrings(value: unknown, maxItems: number, maxLen: number) { return Array.isArray(value) ? [...new Set(value.map((x) => clean(x, maxLen)).filter(Boolean))].slice(0, maxItems) : []; }
function uuid(value: unknown, name: string) { const v = String(value ?? ""); if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)) throw new Error(`invalid_${name}`); return v; }
function uuidArray(value: unknown, max: number, name: string) { return Array.isArray(value) ? [...new Set(value.map((x) => uuid(x, name)))].slice(0, max) : []; }
function candidateId(value: unknown) { const v = clean(value, 120); if (!/^[a-z0-9][a-z0-9-]{2,119}$/.test(v)) throw new Error("invalid_candidate_id"); return v; }
function stageValue(value: unknown) { const v = clean(value, 32).toUpperCase(); if (!STAGES.has(v)) throw new Error("invalid_stage"); return v; }
function evidenceValue(value: unknown) { const v = clean(value, 32).toUpperCase(); if (!EVIDENCE.has(v)) throw new Error("invalid_evidence_class"); return v; }
function boundedInt(value: unknown, min: number, max: number) { const n = Number(value); if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) throw new Error("invalid_integer_range"); return n; }
function boundedNumber(value: unknown, min: number, max: number) { const n = Number(value); if (!Number.isFinite(n) || n < min || n > max) throw new Error("invalid_number_range"); return Math.round(n * 1000) / 1000; }
function finiteOrNull(value: unknown) { const n = Number(value); return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null; }
function fitnessScores(value: unknown) { const obj = object(value); const out: Record<string, number> = {}; for (const key of FITNESS_DIMENSIONS) out[key] = boundedNumber(obj[key], 0, 100); return out; }
async function safeJson<T>(request: Request): Promise<T> { try { return await request.json() as T; } catch { return {} as T; } }
function adminKey() { const keys = Deno.env.get("SUPABASE_SECRET_KEYS"); if (keys) { try { const parsed = JSON.parse(keys); if (parsed.default) return String(parsed.default); } catch {} } return mustEnv("SUPABASE_SERVICE_ROLE_KEY"); }
function mustEnv(name: string) { const value = Deno.env.get(name); if (!value) throw new Error(`missing_env_${name}`); return value; }
function safeError(error: unknown) { return (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, " ").slice(0, 1600); }
function json(payload: unknown, status = 200) { return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } }); }
