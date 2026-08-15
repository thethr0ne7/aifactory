# Source-Grounded Notebook

## Purpose

Answer questions over a bounded document corpus while preserving source grounding and traceability.

## Activate when

The user supplies a collection of documents, policies, manuals, research papers or project files and wants synthesis across that corpus.

## Workflow

1. Define the corpus and exclude out-of-scope material.
2. Index or retrieve relevant passages for the question.
3. Preserve document/page/section identifiers.
4. Synthesize only from retrieved evidence plus clearly marked external context if allowed.
5. Highlight contradictions across documents.
6. Return citations/locators with the answer.
7. Save reusable corpus notes to Knowledge OS when appropriate.

## Guardrails

- The notebook layer is not the sole evidence store.
- Do not answer corpus-specific questions from general model memory when retrieval is available.
- Distinguish missing evidence from negative evidence.
- Browser automation or vendor-specific notebook tooling is optional and must be audited separately.

## Provenance

Architecture idea inspired by `PleasePrompto/notebooklm-skill`; local implementation is tool-agnostic and does not depend on Claude-only browser automation.
