# Evaluation Report — shipkeel-m1 (Cycle 2)

- **HEAD**: `9581413`
- **Action**: `evaluate` (independent evaluator)
- **`fh verify`**: All 5 checks passed (`typecheck`, `unit`, `build`, `smoke`, `list-domains`) — recorded in `.harness/verify/last.json`.
- **UI Capture**: N/A (`pages.json` is null; pure CLI workspace restructure and Markdown documentation).

## 1. E2E Case Matrix

| Case ID | Category | Blocking | Status | Evidence |
|---|---|---|---|---|
| E2E-1 | core | yes | PASS | `fh verify` (`build` + `smoke`) exited 0 at HEAD `9581413`; offline mock LLM + mock MCP E2E passed. |
| E2E-2 | core | yes | PASS | `fh verify` (`list-domains`) and direct `cd scaffolds/plan-execute && node dist/index.js --list-domains` both exited 0 and listed `build`, `qa`, `gop`. |
| E2E-3 | negative | yes | PASS | Covered by `npm run smoke` (`scripts/smoke-e2e.mjs`) and `catalogRoute` unit tests (`scaffolds/plan-execute` 124/124 pass): invalid domain fails closed to read-only `qa`. |
| E2E-4 | negative | no | PASS | Markdown link validator scanned 47 `.md` files with 0 broken relative links; CI security regex scan across `README.md`, `AGENTS.md`, `playbook`, `contracts`, `scaffolds`, and harness configs returned 0 matches (`SEC_OK`). |
| E2E-5 | boundary | no | PASS | Direct `cd scaffolds/plan-execute && npm test` passed 124/124 tests (30 suites, 0 failures), matching root `npm test`. |

## 2. Per-Layer Summary

- **L1 (Core functionality & contracts)**: All 5 `fh verify` checks (`typecheck`, `unit`, `build`, `smoke`, `list-domains`) and `fh doctor` passed cleanly at `9581413`.
- **L2 (Robustness, hygiene & editorial quality)**: Direct sub-package test/CLI execution, 47-file Markdown link check, security regex scan, and `RB-16` independent audit all passed (`RB-16 = 1`).
- **L3 / L4**: N/A per `rubric.json` policy (no web UI in M1).

## 3. REF-1 / ANTI-1 / RL-4 Audit (`RB-16`)

| Deliverable | REF-1 Alignment | ANTI-1 / RL-4 Check | Result |
|---|---|---|---|
| `playbook/README.md` | Crisp 2-question origin formula, L0–L4 table, 3-step decision flow ("选能解决问题的最低级别"), explicit build-time vs runtime Agent boundary, honest non-goals (L0 non-agent, L4 deferred). | Zero hype; clear control-flow criteria. | PASS |
| `playbook/patterns.md` | 5 composable pattern blocks mapped to C1–C11 & real files; explicit pass-by-value vs pass-by-key criteria; 3-gate rule for read-only multi-agent fan-out. | Actionable topology rules, grounded in real patterns. | PASS |
| `playbook/frameworks.md` | L0–L4 implementation mapping table with pitfalls; Vendor SDK vs Thin Harness trade-off table; Tool Context Economics with explicit safety constraint against Code Mode for write-heavy systems. | Rejects framework-first hype; concrete control-flow criteria. | PASS |
| `playbook/cases/visual-studio.md` | Cites `prompt-builder.ts` (`matchTemplateByTopic`, `assemblePrompt`), `api/generate/route.ts`, `openai-image.ts`, `canvas/composer.ts`, `typography.ts`, `security/`, `PLATFORM_SPECS`; maps C1/C8/C11. | Explicitly argues L0 should NOT be an Agent; distinguishes `.agents/skills/`. | PASS |
| `playbook/cases/atoms.md` | Cites `pipeline.ts` (`runPlanner`/`runArchitect`/`runEngineer`, `persistEvent`, `probePreview` + `esbuild-wasm`, `verifySandbox` + `tsc --noEmit`, `hasProbeFailure`, `computeFilesSha256`, `MAX_FIX_ROUNDS = 3`, `failureSignature`, `stalled = true`, 3-mode provider); maps C4/C7/C8/C9. | Concrete deterministic verification & stall-detection evidence. | PASS |
| `playbook/cases/campaign-build.md` | Cites `orchestrator.ts` (`catalogRoute`), `executor.ts`, `resolve-time.ts` (`countryTimeRef`), `page-build.ts`, `acceptance.ts` + `review-rules.md`, `deployment.pipeline.yaml`, `QUERY_ALLOWED_TOOLS`, `qa/executor.ts`; maps C1–C5, C9. | Explains L2 vs L1 coexistence with concrete latency impact (~60–120m → ~5–7m). | PASS |
| `playbook/cases/finance.md` | Cites `final.ts`, `finance-blueprint/README.md`, LightRAG, `query_graph`, `save_fact` Zod Schema, `compute()`, `reconcile()`, 8B empirical rule finding; honestly documents 2 prototype gaps (`piOps` write bypass → C6; missing checkpointer/interrupt/mock → C8/C10). | Honest gap analysis rather than overclaiming prototype readiness. | PASS |
| `contracts/README.md` & `contracts/universal-contracts.md` | Complete C1–C11 index and specification; every contract includes Rule, Real Evidence, Counter-example, and Deterministic Check. | Zero vague slogans; all 11 contracts mechanically checkable. | PASS |

## 4. Exploratory Probes

1. **In-repo symbol grounding check**: Verified all cited files and symbols under `scaffolds/plan-execute/src/` (`catalogRoute`, `QUERY_ALLOWED_TOOLS`, `acceptance.ok`, `executeToolCall`, `MAX_TOOL_ROUNDS`, `countryTimeRef`, `resolveFloorSetting`, `parallelMap` in `src/runtime/parallel.ts`, `runAcceptance`, `QA domain does not support batch execution`, `resolveTokenPlaceholders`, `pipeline-state.ts`, `trace.ts`, `plan.schema.json`, `deployment.pipeline.yaml`). All exist and match the docs.
2. **3-click navigation & CI path hygiene**: Verified `README.md` → `playbook/README.md` → `contracts/README.md` → `scaffolds/plan-execute/README.md` navigation links and `.github/workflows/ci.yml` asset paths (`scaffolds/plan-execute/dist/...`). No stale root `src/` or `dist/` paths.
3. **`finance-blueprint/` cross-link check**: Confirmed `playbook/cases/finance-blueprint/` exists and contains `README.md`, `brain.md`, `executor.ts`, `schemas/`, and `skills/`.

## 5. Findings Table

| heuristic | artifact | severity | problem | recommendation | rubric id |
|---|---|---|---|---|---|
| — | — | none | No defects found in Cycle 2. | — | — |
