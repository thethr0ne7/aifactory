# SEO Audit Patterns

## Purpose

Provide an optional library of full-site SEO audit checks without importing a large multi-agent SEO architecture.

## Activate when

A broad site audit is requested and the dedicated SEO/GEO skill needs deeper check coverage.

## Workflow

1. Start from SEO/GEO's technical/content/schema/indexability structure.
2. Expand only the check families relevant to the site.
3. Record evidence for every issue: URL, observed condition, expected condition, impact and confidence.
4. Deduplicate symptoms that share a root cause.
5. Prioritize systemic fixes before page-by-page cleanup.
6. Return findings to SEO/GEO for integrated prioritization.

## Guardrails

- Pattern-only: do not import upstream agent orchestration wholesale.
- Do not report tool warnings as confirmed SEO problems without inspection.
- Avoid huge unranked issue lists.
- Every recommendation must map to an observed problem or explicit opportunity.

## Provenance

Check ideas inspired by `AgriciDaniel/claude-seo`; local adoption is pattern-only.
