# Product Overview — ShipKeel

## Capability Areas
- **Five-Level Paradigm Playbook (`playbook/`)**: Control-flow decision tree (L0–L4), five composable pattern blocks, framework selection guide, and four code-grounded case breakdowns (VisualStudio, Atoms, campaign-build, finance).
- **Language-Agnostic Universal Contracts (`contracts/`)**: Eleven production contracts (C1–C11) with anti-patterns and deterministic verification methods shared across all Agent paradigms and languages.
- **Per-Paradigm Starter Scaffolds (`scaffolds/`)**:
  - `scaffolds/plan-execute/`: L2 Plan-Execute-Review + L1 YAML declarative pipeline reference implementation with multi-domain Catalog routing (`build`, `qa`, `gop`) and full offline mock demo.

## Users and Roles
- **Primary users**: Repository owner and engineering team starting new vertical Agents (BD, browser-use, media/video, finance, campaign ops) in independent repositories.
- **Coding agents**: Antigravity, Claude Code, Codex, and Cursor reading root `AGENTS.md`, `contracts/`, and `playbook/` under ShipProof verification.

## Scope Boundaries
- New business Agents live in independent repositories and copy a paradigm scaffold rather than sharing a monolithic runtime dependency.
- M1 delivers pure Markdown methodology and the migrated L2/L1 reference scaffold; interactive decision-tree UI is out of scope.

## Open Directions
- M2: Extract headless L1 generate-verify-repair scaffold from Atoms.
- M3: Extract and complete L3 durable-graph scaffold (Checkpointer, Interrupt, externalized specs, 3-mode offline testing) from finance.
- M4: Export universal contracts as ShipProof's `agent.md` standards pack.
