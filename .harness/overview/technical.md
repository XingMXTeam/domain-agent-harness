# Technical Overview — ShipKeel

## Modules and Boundaries
- **Workspace Root (`shipkeel`)**: Private npm workspaces root (`scaffolds/*`) with zero runtime dependencies; holds methodology (`playbook/`, `contracts/`), shared dev toolchain (TypeScript, `tsx`, `@types/node`), CI workflow, and ShipProof verification harness (`.harness/`, `.agents/`).
- **L2/L1 Reference Scaffold (`@shipkeel/plan-execute` in `scaffolds/plan-execute/`)**: Self-contained TypeScript ESM package exposing `dah`, keeping `yaml` as its sole runtime dependency, with its own `AGENTS.md` for local invariants, `src/runtime/`, `src/domains/{build,qa,gop}/`, `knowledge/`, `scripts/`, and offline `test/` suites.
- **Playbook & Contracts (`playbook/`, `contracts/`)**: Pure Markdown documentation decoupled from scaffold runtime code, including the un-wired finance domain blueprint under `playbook/cases/finance-blueprint/`.

## Data Sources
- Sample knowledge base (`scaffolds/plan-execute/knowledge/`) exposed via local read-only MCP server for offline planning and acceptance checks.
- ShipProof state, verification logs, and evaluation reports stored under `.harness/`.

## Cross-Cutting Constraints
- Two-layer governance: universal contracts C1–C11 enforced at root; domain-specific fields and dependency budgets declared per scaffold in `scaffolds/<paradigm>/AGENTS.md`.
- TypeScript `strict` + `noUncheckedIndexedAccess`; all unit and E2E smoke tests run 100% offline without external keys or network.
- Strict sanitization: no hardcoded secrets, internal URLs, internal identifiers, or built `dist/` artifacts committed to git.
