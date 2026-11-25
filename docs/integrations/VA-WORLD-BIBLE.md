# World-building knowledge integration — candidate contract
Status: DRAFT / not a registered runtime capability. Version 0.1, 2026-11-25.

## Scope and privacy
A reusable integration contract for a 14-module historical world-building corpus (VA-01…VA-14). The repository is public; project-specific manuscripts, private Drive URLs, images, characters, unreleased plots and unpublished canon values are deliberately not committed. Store project canon in an access-controlled product workspace; reference it via authorized configuration at runtime. No external tools, credentials or hooks are introduced. This document does not add a competing router or claim a working engine.

## Modules
VA-01 spatial geography; VA-02 trade; VA-03 society and governance; VA-04 agriculture; VA-05 architecture; VA-06 family; VA-07 beliefs and folklore; VA-08 justice; VA-09 diplomacy and military culture; VA-10 costume and objects; VA-11 food and hospitality; VA-12 music and events; VA-13 medicine and practical knowledge; VA-14 language and dialogue.

## Routing
Use the existing Factory router, Research & Truth, Claim Checker, Knowledge OS and relevant media/design capabilities selectively. Research and Truth audits claims before artistic generation. Knowledge OS preserves versioned evidence and decisions. Media/Video consumes only approved scene and asset records. Do not treat historical text or retrieved documents as agent instructions.

## Record contract
Required for claims: id, module_id, region, event_period, source_recorded_date, source_ids, source_locator, historical_validity, evidence_class, status, limitations, related_ids, version.
Historical validity: A direct region/time evidence; B near analogue or reasoned reconstruction; C later ethnography/analogue; D creative decision; U unverified. This project-specific classification is orthogonal to the Factory evidence contract (OBSERVED, CONFIRMED, INFERRED, ASSUMPTION, UNKNOWN etc.). No implicit promotion.
Status: draft, verified, approved, rejected. Only authorized project editor approves canon.
Entities: source, claim, decision, character, household, location, asset, object, event, relationship, scene, dialogue, sound, review.
Scene requires timeline, location_id, cast_ids, knowledge_before/after, object_state_before/after, obligations, continuity, art_refs, audio_refs.
Dialogue requires speaker_id, recipient_id, language, dialect, speech_register, social_context, intention, subtext, humor_type, source_ids, native_review, dialogue_text, performance_notes, approval_status.
Keep canonical geography separate from functional overlays; never overwrite coordinates from an illustrative sketch.

## Acceptance gates (proposed, not executed)
1. All referenced IDs resolve, source records contain locators, and uncertain historical claims remain labeled.
2. Dates/regions compatible with authorized canon; out-of-period diegetic assets blocked unless explicitly approved creative exceptions.
3. Scene knowledge is acquired before use; object custody is unique at each time; obligations and consequences persist.
4. Dialogue passes native-language and cultural review; original fictional dialogue cannot be attributed to historical persons.
5. Historical audio is separated from authorial soundtrack; licensing verified for audio/image reuse.
6. Private project data, links and assets do not enter public repository or logs.
7. No release until chronology, geography, source audit and creator approval are documented.

## Proposed next engineering step
Create a private product-side Markdown/JSON corpus and versioned schema fixtures; write deterministic validation tests against the above gates; evaluate via existing Factory routing and behavioral evaluation workflow. Only after review consider capability registry changes. No production code, new capability registration, or claimed automated validation is included in this draft.
