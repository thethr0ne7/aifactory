# PDF Routing

## Purpose

Inspect a PDF before choosing native extraction, selective OCR or vision so document processing is cheaper, faster and more traceable.

Pattern source: `firecrawl/pdf-inspector` (MIT) via `registry/upstreams/agent-nursery-intelligence-pack.json`.

## Flow

`PDF → classify document/pages → choose extraction route → preserve page provenance → evidence-locked extraction`

Routes:

- `TEXT_BASED` → native extraction;
- `MIXED` → per-page routing;
- `SCANNED` → OCR or vision;
- `IMAGE_BASED` → vision-first;
- `UNKNOWN` → inspect/fallback, never pretend confidence.

Use `runtime/intelligence-routing.mjs` for normalization and route planning.

## Rules

- Classification selects an extraction method; it does not validate document claims.
- Preserve page numbers/source refs through every extraction step.
- Do not OCR a native-text PDF without a reason.
- Do not hide low/unknown classifier confidence.
- Mixed PDFs should be routed per page when page-level evidence is available.
