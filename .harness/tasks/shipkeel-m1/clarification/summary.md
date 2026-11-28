# Clarification Summary — shipkeel-m1

## Imported PRD Reference
- Source: `.harness/tasks/shipkeel-m1/prd.md` (imported from `shipkeel-decisions.md`, approved 2026-11-28).
- Note: `REQ-n` IDs will be added in place to `prd.md` during `write-prd` (normalize-only) without altering user wording.

## Goals (M1 Scope)
1. Rename repository identity to **ShipKeel** (`package.json` root `"name": "shipkeel"`, `"private": true`, npm workspaces `["scaffolds/*"]`) and update root `README.md` / `AGENTS.md` to position the repo as the Agent blueprint & starter kit (decision tree + language-agnostic contracts + per-paradigm scaffolds).
2. Migrate existing runtime (`src/`, `test/`, `scripts/`, `knowledge/`, `tsconfig.json`, `entrypoint.sh`, `.env.example`, runtime docs) cleanly into `scaffolds/plan-execute/` as workspace package `@shipkeel/plan-execute` (retaining `bin: { "dah": "dist/index.js" }` and all 3 domains `build`/`qa`/`gop` + sample knowledge/mocks/smoke tests), with its own `scaffolds/plan-execute/AGENTS.md` holding local constraints (`countryTimeRef`, `floorSetting`, `qa` read-only executor, `yaml`-only runtime dependency).
3. Establish root `playbook/` (pure Markdown):
   - 5-level paradigm decision tree (L0–L4) + composable pattern blocks + framework selection guide.
   - 4 evidence-backed case breakdowns under `playbook/cases/`: `visual-studio.md` (L0), `atoms.md` (L1 + generate-verify-repair), `campaign-build.md` (L1/L2), `finance.md` (L3 + retrieval + read-only external ops).
4. Establish root `contracts/`: complete specification and deterministic check methods for universal contracts **C1–C11** (elevated from the original 6 architectural constraints + D9/D10).
5. Update root `AGENTS.md`, `.github/workflows/ci.yml`, `harness.config.json`, `.harness/verify.json`, and `.harness/standards.md` so root workspace scripts, CI asset checks, security scans, and `fh verify` / `fh gate` run cleanly against the new workspace layout.

## Non-Goals (Explicitly Deferred)
- M2 (`scaffolds/generate-verify-repair/` extracted from Atoms) — separate feature.
- M3 (`scaffolds/durable-graph/` extracted & completed from finance `final.ts`) — separate feature.
- M4 (exporting `agent.md` into `XingMXTeam/ShipProof`) — separate feature.
- Interactive web/HTML decision-tree UI — deferred; M1 is pure Markdown.
- GitHub repository rename (`XingMXTeam/domain-agent-harness` → `XingMXTeam/ShipKeel`) — performed by the owner after M1 completes.

## Users & Roles
- **Primary user**: Repository owner & team starting new vertical Agents (BD, browser-use, media/video, finance, campaign ops) in independent repos.
- **Secondary user**: Coding agents (Antigravity / Claude Code / Codex / Cursor) reading `AGENTS.md`, `contracts/`, and `playbook/` under ShipProof.

## Main & Edge Paths
- **Main path**: Run `npm run typecheck`, `npm test`, `npm run build`, `npm run smoke`, `npm run list-domains` from root (delegating via npm workspaces to `@shipkeel/plan-execute`); read `README.md` → `playbook/` → `contracts/` → `scaffolds/plan-execute/`.
- **Edge paths**:
  - Running commands directly inside `scaffolds/plan-execute/` works identically to running via root workspace scripts.
  - Relative paths in `copy-assets.mjs`, `smoke-e2e.mjs`, `demo.mjs`, `knowledge-mcp.mjs`, `paths.ts`, and `entrypoint.sh` resolve relative to `scaffolds/plan-execute/`, not hardcoded to repo root.
  - `dist/` remains gitignored both at root and under `scaffolds/*/dist/`.

## Stack & Dependency Decision
- **Stack**: Node.js >= 20.10.0, TypeScript 5.7+ (`strict` + `noUncheckedIndexedAccess`), ESM, `node:test` via `tsx`, npm workspaces.
- **Dependencies**: Root has zero runtime dependencies; `@shipkeel/plan-execute` retains `yaml` as its sole runtime dependency.

## Budgets & Delivery Gate
- `maxMacroCycles: 5`, `maxTaskRetries: 3`, `requiredStablePasses: 2`, `passScore: 0.9`.
- Delivery gate & `fh verify`: `typecheck`, `unit`, `build`, `smoke`, `list-domains` + CI asset & security checks.

## Quality Level & Red Lines
- **Level**: C (Production engineering quality).
- **Red Lines**:
  - RL-1: All existing verification checks (`typecheck`, `unit`, `build`, `smoke`, `list-domains`, CI asset & security checks) pass 100% after migration.
  - RL-2: `scaffolds/plan-execute` keeps `yaml` as its only runtime dependency; root adds zero runtime dependencies.
  - RL-3: Zero broken Markdown links, zero stale root `src/` path references in scripts/CI/configs, zero secret or internal-identifier leaks.
  - RL-4: `playbook/` and `contracts/` cite real code/design evidence from the 4 real projects (no generic fluff).

## Eleven-Module Coverage Table
| # | Module | Covered | Where Answered |
|---|---|---|---|
| 1 | Goal & success measure | yes | `prd.md` (M1 table) + `answers.md` #4 |
| 2 | Users, roles & permissions | yes | `prd.md` (D1, D2) |
| 3 | Main path | yes | `prd.md` (target layout, M1) + `answers.md` #1–#3 |
| 4 | Error & edge paths | yes | `answers.md` #2, #4 + workspace path resolution rules |
| 5 | Data objects & field meanings | yes | `prd.md` (L0–L4, C1–C11) |
| 6 | Integrations & API boundaries | yes | `prd.md` (D2, D8) + `answers.md` #1 |
| 7 | Non-functional limits | yes | `prd.md` (D7, D8, C8, C11) + `answers.md` #3, #4 |
| 8 | Non-goals | yes | `prd.md` (M2–M4 deferred, GitHub rename manual) + `answers.md` #3 |
| 9 | Acceptance criteria | yes | `prd.md` (M1 acceptance) + `answers.md` #4 |
| 10 | Budgets & stop policy | yes | `harness.config.json` |
| 11 | Quality expectations & references | yes | `quality-expectations.md` + `answers.md` #4 |

confirmed-by-user: yes (2026-11-28, "确认")
open-questions: 0
