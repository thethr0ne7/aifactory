# Source Provenance and Adoption Boundaries

AI Factory records useful upstream projects as provenance, not as automatic trusted dependencies. Local skills in this repository are adapted operating contracts written for this factory.

| Local capability | Upstream inspiration | Adoption mode |
|---|---|---|
| Context Governor | muratcankoylan/Agent-Skills-for-Context-Engineering | patterns only until code audit |
| Engineering Kernel | obra/superpowers | adapted engineering discipline |
| Skill Foundry | anthropics/skills: skill-creator | adapted skill lifecycle/eval model |
| Frontend Design | anthropics/skills: frontend-design | adapted design discipline |
| Design DNA | zanwei/design-dna | adapted reference-analysis model |
| Brand & Theme | anthropics/skills: brand-guidelines + theme-factory | architecture only; product-specific brand DNA |
| Web Artifacts | anthropics/skills: web-artifacts-builder | adapted artifact-building discipline |
| Motion Director | LottieFiles/motion-design-skill | adapted motion reasoning |
| Web Animation | greensock/gsap-skills | selective implementation patterns |
| Media / Video | remotion-dev/remotion | selective programmatic-video patterns |
| Web 3D | CloudAI-X/threejs-skills | controlled; source/install audit required |
| Algorithmic Art | anthropics/skills: algorithmic-art | specialist generative-art patterns |
| Creative Pattern Lab | AThevon/genjutsu | pattern donor only |
| Marketing Growth | coreyhaines31/marketingskills | selective capability routing |
| SEO / GEO | aaron-he-zhu/aaron-marketing-skills | selective capability routing |
| SEO Audit Patterns | AgriciDaniel/claude-seo | checks/patterns only; no imported multi-agent layout |
| Knowledge OS | kepano/obsidian-skills | portable Markdown/JSON knowledge patterns |
| Source-grounded Notebook | PleasePrompto/notebooklm-skill | architecture idea only |
| Spreadsheet Adapter | haris-musa/excel-mcp-server | controlled adapter pattern; bounded filesystem |
| Code Navigation | massgen/massgen | search/navigation patterns only; no default voting swarm |

## General third-party rule

Before any upstream project moves from `pattern-only` to executable integration, audit:

1. license;
2. install scripts and hooks;
3. arbitrary command execution;
4. filesystem scope and path traversal;
5. secrets handling;
6. network listeners and authentication;
7. browser automation permissions;
8. remote downloads or dynamic code loading;
9. data exfiltration paths;
10. maintenance health and documented failure modes.

The factory must also prove that the new integration improves a relevant eval compared with the existing local capability. Popularity is not evidence of quality or necessity.
