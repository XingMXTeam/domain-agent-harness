# Evaluation Report — `shipkeel-m1` (Cycle 1)

- **Feature**: `shipkeel-m1`
- **Role**: Independent Evaluator (Pass 1 — `evaluate`)
- **HEAD**: `45010db`
- **UI Capture**: N/A (`pages.json` is null; pure Node/TypeScript workspace restructure and Markdown playbook/contracts)
- **Recorded `fh verify` checks**: `typecheck`, `unit`, `build`, `smoke`, `list-domains` — all 5 **PASS** at `45010db`

---

## 1. E2E Case Matrix

| Case ID | Category | Blocking | Status | Evidence |
|---|---|---|---|---|
| `E2E-1` | core | yes | **PASS** | `fh verify` (`build`, `smoke`) passed at `45010db`; inspected `scaffolds/plan-execute/scripts/smoke-e2e.mjs` verifying explicit `qa`, Catalog auto-route `qa`, and invalid-domain fallback exit 0 with clean 1-line stdout and stderr logging. |
| `E2E-2` | core | yes | **PASS** | `fh verify` (`list-domains`) passed; direct execution of `npm run list-domains` at root and `node dist/index.js --list-domains` inside `scaffolds/plan-execute` both exited 0 listing `build`, `qa`, and `gop`. |
| `E2E-3` | negative | yes | **PASS** | `smoke-e2e.mjs` scenario 3 (`not-a-real-domain`) passed via `fh verify` (`smoke`), and `catalogRoute` unit tests verified invalid domain, non-JSON, and network error all fail closed to read-only `qa`. |
| `E2E-4` | negative | no | **PASS** | Executed Markdown relative link check across all 47 `.md` files (`LINKS_OK files=47`) and CI security regex scan (`SEC_OK`, 0 matches). |
| `E2E-5` | boundary | no | **PASS** | Executed `npm test` directly inside `scaffolds/plan-execute/` (124/124 tests passed across 30 suites in 518ms), matching root `fh verify` (`unit`). |

---

## 2. Per-Layer Summary

- **L1 (Core functionality & deterministic contract checks)**: All 5 `fh verify` checks (`typecheck`, `unit`, `build`, `smoke`, `list-domains`) and `fh doctor` passed. Root `package.json`, `README.md`, `AGENTS.md`, `scaffolds/plan-execute/`, `playbook/`, `contracts/`, and `.github/workflows/ci.yml` match `REQ-1`..`REQ-6`.
- **L2 (Robustness, hygiene & editorial quality)**:
  - Subdirectory execution (`E2E-2`, `E2E-5`), link integrity (`47` Markdown files, 0 broken links), and security scan (0 leaks) all passed.
  - Judge item `RB-16`: **1 / 1** (`evaluation/judge-rb-16.json`).
- **L3 / L4 (UI / Interactive UX)**: N/A per `rubric.json` policy (`layerNA`).

---

## 3. Comparison Against Vision Anchors

### `REF-1` (`docs/agent-architecture-guide.md` & `docs/finance-domain/README.md`)
- **Crisp decision formulas**: Present in `playbook/README.md` (two-question origin axis + L0–L4 table + Q1–Q3 decision tree) and `playbook/patterns.md` (single-sentence topology/data-handoff rule).
- **Explicit trade-off tables**: Present in `playbook/frameworks.md` (paradigm-to-implementation mapping, Vendor SDK vs thin custom harness, tool context economics) and `playbook/patterns.md` (5 composable patterns mapped to contracts).
- **Concrete code & contract citations**: All 4 cases (`VisualStudio`, `Atoms`, `campaign-build`, `finance`) cite real source files, symbols, constants, and design gaps; `contracts/universal-contracts.md` maps every C1–C11 contract to real evidence, anti-examples, and deterministic checks.
- **Honest non-goals**: Explicitly states L0 should not use an agent framework, L4 is deferred until a real browser agent is built, and build-time coding-agent skills (`.agents/skills/`) are not runtime agent architecture.
- **Concrete gap vs REF-1**: None blocking; only one minor heading/count mismatch in `playbook/README.md` (see Findings).

### `ANTI-1` (Generic AI framework hype docs)
- **Not present**: No vague advice without verifiable checks, no claiming every LLM app is an Agent (`VisualStudio` is explicitly called L0 non-Agent), and every framework recommendation is tied to concrete control-flow and durability criteria.

### `RL-4` (4 real cases + C1–C11 completeness)
- **Satisfied**: All 4 cases (`visual-studio.md`, `atoms.md`, `campaign-build.md`, `finance.md`) have substantive, code-grounded breakdowns, and all 11 contracts (`C1`–`C11`) are defined in both `contracts/README.md` and `contracts/universal-contracts.md`.

---

## 4. Exploratory Probes

1. **In-repo symbol & file spot-check (`H-PR-2.1`)**: Verified that every cited symbol and file path in `playbook/cases/campaign-build.md` and `contracts/universal-contracts.md` (`resolveFloorSetting`, `QUERY_ALLOWED_TOOLS`, `executeToolCall`, `MAX_TOOL_ROUNDS = 30`, `catalogRoute`, `resolveTokenPlaceholders`, `QA domain does not support batch execution`, `gcpCall`, and the 124 unit test count) exists and matches `scaffolds/plan-execute/src/` and actual `npm test` output.
2. **Root hygiene & stale directory check (`ANTI-2`)**: Listed repo root (`ls -la`); confirmed no stale root `src/`, `test/`, `scripts/`, `knowledge/`, or `dist/` directories remain.
3. **3-click navigation path check (`vision.md` Design Intent)**: Verified `README.md` → `playbook/README.md` → `contracts/README.md` → `scaffolds/plan-execute/README.md` all link cleanly with zero dead relative links.

---

## 5. Findings Table

| Heuristic | Artifact | Severity | Problem | Recommendation | Rubric ID |
|---|---|---|---|---|---|
| H-PR-2.1 | `playbook/README.md` | minor | Section 2 heading and intro say "4 步选型决策流" / "按顺序问这 4 个问题", while the decision tree contains 3 questions (`Q1`–`Q3`) yielding 5 outcomes. | Rename to "3 步选型决策流 / 按顺序问这 3 个问题" or split `Q3` into `Q3` and `Q4`. | RB-16 |
| H-PR-2.1 | `playbook/cases/finance-blueprint/README.md` | info | Preserved pre-migration blueprint text refers to `src/orchestrator.ts`, `src/prompts/catalog.md`, and `src/domains/finance/` without the `scaffolds/plan-execute/` prefix. | Optionally add a note or prefix paths with `scaffolds/plan-execute/` in M3 when extracting `durable-graph`. | RB-16 |
