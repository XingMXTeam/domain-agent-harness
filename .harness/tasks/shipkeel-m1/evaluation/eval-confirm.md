# Confirmation Evaluation Report — `shipkeel-m1`

- **Action**: `confirm-evaluation` (Macro Cycle 2, fresh independent pass)
- **HEAD**: `9581413`
- **Capture**: N/A (`pages: null` — pure Node/TypeScript workspace restructure and Markdown playbook/contracts with no web UI)
- **Fresh `fh verify`**: PASS (`typecheck`, `unit`, `build`, `smoke`, `list-domains` — all 5 recorded at `@ 9581413`)

---

## 1. E2E Case Matrix

| Case ID | Category | Blocking | Result | Evidence |
|---|---|---|---|---|
| E2E-1 | core | yes | **PASS** | Fresh `fh verify` `smoke` passed (`npm run smoke` exit 0 @ `9581413`). |
| E2E-2 | core | yes | **PASS** | Fresh `fh verify` `list-domains` passed AND direct `cd scaffolds/plan-execute && node dist/index.js --list-domains` listed `build`, `qa`, `gop` with exit 0. |
| E2E-3 | negative | yes | **PASS** | `smoke` invalid-domain fallback scenario + `catalogRoute` unit tests (4/4 fallback cases pass, failing closed to `qa`). |
| E2E-4 | negative | no | **PASS** | Relative Markdown link check scanned 47 `.md` files with 0 broken links; CI security regex scan returned 0 matches. |
| E2E-5 | boundary | no | **PASS** | Direct `cd scaffolds/plan-execute && npm test` passed 124/124 unit tests (30 suites, 0 failures), matching root `npm test`. |

---

## 2. Per-Layer Summary

| Layer | Status | Notes |
|---|---|---|
| L1 (Core functionality & pitfalls) | **PASS** | Root `package.json`, `README.md`, `AGENTS.md`, `scaffolds/plan-execute` workspace (`@shipkeel/plan-execute`, `bin.dah`, single runtime dep `yaml`), `playbook/`, `contracts/`, CI/harness config (`fh doctor` 6/6 green), and all 5 `fh verify` checks pass. |
| L2 (Robustness, hygiene & judge) | **PASS** | Direct scaffold test/CLI execution, 0 broken relative Markdown links across 47 files, 0 security/internal-identifier matches, and `RB-16` scored `1`. |
| L3 (UI design) | **N/A** | Waived per `rubric.json` (`policy.layerNA.L3`). |
| L4 (Interaction / UX) | **N/A** | Waived per `rubric.json` (`policy.layerNA.L4`). |

---

## 3. Anchor Comparison (`vision.md`)

- **REF-1 (`docs/agent-architecture-guide.md` & `docs/finance-domain/README.md`)**: **Matched (no gap).**
  - `playbook/README.md` opens with a crisp 2-question decision formula, L0–L4 table, 3-step decision tree, and honest non-goals (e.g., `VisualStudio` is L0 and should not be made an Agent; build-time Agent ≠ runtime Agent; L4 deferred).
  - `playbook/patterns.md` and `playbook/frameworks.md` provide explicit trade-off tables, pass-by-key vs pass-by-value criteria, 3-gate parallel fan-out rules, and tool context economics.
  - All 4 cases (`visual-studio.md`, `atoms.md`, `campaign-build.md`, `finance.md`) cite concrete source paths, functions, constants, and failure modes.
  - `contracts/README.md` and `contracts/universal-contracts.md` cover C1–C11 completely, each with rule, real code evidence, counterexample, and deterministic check method.
- **REF-2 (Original repo hygiene)**: **Matched.** Root has 0 runtime dependencies; `scaffolds/plan-execute` has only `yaml`; strict TypeScript and 124 offline unit tests + offline E2E smoke tests pass cleanly.
- **ANTI-1 (Generic AI hype)**: **Not present.** Zero vague advice; explicitly rejects turning every LLM app into an Agent and grounds every framework choice in control-flow requirements.
- **ANTI-2 (Half-migrated monorepo)**: **Not present.** Root contains only methodology and workspace plumbing; 0 broken relative Markdown links; `fh doctor` and CI path references are aligned.
- **RL-1..RL-4**: All 4 red lines verified clear.

---

## 4. Exploratory Probes

1. **Root cleanliness & dependency budget probe**: Verified `ls -la` at root has no stale `src/`, `test/`, `scripts/`, or `knowledge/` directories; `package.json` `dependencies` is `{}` and `scaffolds/plan-execute/package.json` `dependencies` is `["yaml"]`.
2. **Code-citation accuracy probe (`H-PR-2.1`)**: Grepped `scaffolds/plan-execute/src/` for symbols cited in `playbook/` and `contracts/` — all verified present (`catalogRoute`, `QUERY_ALLOWED_TOOLS`, `MAX_TOOL_ROUNDS = 30`, `resolveTokenPlaceholders`, `resolveFloorSetting`, `QA domain does not support batch execution`), and `npm test` count (`124`) matches `README.md` and `playbook/cases/campaign-build.md`.
3. **3-click navigation & blueprint path probe**: Confirmed `README.md` → `playbook/README.md` → `contracts/README.md` → `scaffolds/plan-execute/README.md` links resolve cleanly. One minor info note: the un-wired historical blueprint `playbook/cases/finance-blueprint/README.md` still refers to `src/orchestrator.ts` / `src/prompts/catalog.md` relative to the scaffold root rather than `scaffolds/plan-execute/src/...`.

---

## 5. Findings Table

| heuristic | artifact | severity | problem | recommendation | rubric id |
|---|---|---|---|---|---|
| H-PR-2.1 | `playbook/cases/finance-blueprint/README.md` | info | Historical un-wired blueprint references `src/orchestrator.ts` and `src/prompts/catalog.md` without the `scaffolds/plan-execute/` prefix. | Optionally clarify in the blueprint header that `src/*` paths are relative to `scaffolds/plan-execute/` (non-blocking polish). | RB-16 |
