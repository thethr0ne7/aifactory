# Minicharts for AI Factory reporting and presentations

## Decision (2026-11-22)

Register `minicharts-reporting` as a **selectively routed, data-driven visualization adapter**. Use it when numeric explanations in reports, dashboards or presentations would benefit from subject-aware illustrated charts. Do not route every report or slide through it.

**Implementation boundary:** the local Factory adapter and routing policy are maintained in this repository. The upstream Minicharts skill is **not vendored, installed, security-audited or runtime-certified** by this change. The official website describes 54 chart types and an MIT license; independently inspect downloaded code before any installation. A Factory registry entry is not proof of host deployment.

## Routing

| Deliverable | Use the adapter when | Alternative |
|---|---|---|
| Grant/financial reporting | Verified funding categories, spending, variances, outcomes | Plain tables when audit detail matters more |
| Executive analytics | Actual KPI changes, segment comparisons, funnels | Native charts if interactive package unavailable |
| Presentations / investor decks | One clean quantitative message per selected slide | Canvas design for purely visual/non-numeric slides |
| Educational reports | Data-backed comparisons/distributions accessible to audience | Text and figures where an illustrated chart obscures meaning |
| Research summaries | Source-backed measurements or clearly labeled estimates | Evidence-first tables for uncertainty-heavy data |

## Default visualization requirements

1. Start from actual source data. Capture file/source, date, units, denominator, handling of missing observations and formulas.
2. Select the chart to answer a defined question before stylizing it. Preserve meaningful scales and meaningful comparisons.
3. Use subject-aware illustration only if it is accurate and more legible than a standard chart.
4. Apply brand-theme, typography, print-safe margins and visual-fidelity QA. Avoid putting text over the illustration or outside safe areas.
5. Label sources, dates, estimated vs verified values and any transformations. Never invent statistics to make slides persuasive.
6. Verify numeric chart labels and visual proportions against the original dataset. Check exports at slide and PDF size.
7. For a static slide or PDF use raster/vector exports; do not promise browser-like hover/click interaction in a PDF.
8. For consequential reports keep a machine-readable values table alongside the illustration where useful.

## Supported delivery modes

- **Registered adapter**: skill routing, quality protocol and provenance in repository; available after merge to `main`.
- **Native fallback**: render accurate charts via host-supported visualization utilities without claiming the original Minicharts package was run.
- **Official Minicharts runtime**: gated. Requires package inspection, explicit permitted installation on target host, runtime proof, verified numeric fixtures and source provenance. Track in `registry/upstreams/minicharts.json`.

## Verification checklist

- [ ] Data source/version cited
- [ ] Units/time window/denominator clear
- [ ] Proportions checked against exact numbers
- [ ] Output is legible at actual presentation scale
- [ ] Brand applied only where it doesn't distort information
- [ ] Export type and interactivity claims checked
- [ ] If upstream is claimed, audited host installation evidence recorded

Official source: https://april-zhu.com/minicharts. Routing: `registry/capabilities.json`. Eval fixtures: `evals/minicharts-reporting.json`.
