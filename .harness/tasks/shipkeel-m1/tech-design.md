# Technical Design — shipkeel-m1

## 1. Stack and key dependencies
- **Runtime**: Node.js `>=20.10.0`, ESM (`"type": "module"`), npm workspaces (`workspaces: ["scaffolds/*"]`).
- **Language & Tooling**: TypeScript `^5.7.2` (`strict` + `noUncheckedIndexedAccess`), `tsx` `^4.19.2`, `@types/node` `^22.10.2` (hoisted in root `devDependencies` so all workspaces share one toolchain).
- **Runtime Dependencies**:
  - Root `package.json`: **0** runtime dependencies (`private: true`).
  - `scaffolds/plan-execute/package.json`: **`yaml: "^2.6.1"` only** (unchanged invariant).
- No new npm dependencies are introduced in M1.

## 2. Architecture overview

```text
shipkeel/                              # root (name: "shipkeel", private: true)
├── README.md                          # ShipKeel entry point (decision tree + contracts + scaffolds)
├── AGENTS.md                          # Universal contracts (C1–C11) + ShipProof protocol block
├── package.json                       # npm workspaces: ["scaffolds/*"], root delegating scripts
├── .gitignore                         # ignores dist/, scaffolds/*/dist/, .runs/, scaffolds/*/.runs/
├── .github/workflows/ci.yml           # workspace build/test/asset-check/CLI-smoke + security scan
├── harness.config.json                # ShipProof config bound to root workspace commands
├── .harness/                          # verify.json, standards.md, docs, agents, tasks
├── .agents/skills/                    # 27 ShipProof skills
├── playbook/                          # L0–L4 decision tree, pattern blocks, framework guide, cases
│   ├── README.md                      # 5-level paradigm decision tree + entry guide
│   ├── patterns.md                    # 5 composable pattern blocks (routing, retrieval, g-v-r, fanout, hitl)
│   ├── frameworks.md                  # Framework selection inside each level (code loop, YAML, LangGraph, ADK, etc.)
│   └── cases/
│       ├── visual-studio.md           # L0 case breakdown (prompt-builder.ts evidence)
│       ├── atoms.md                   # L1 + generate-verify-repair breakdown (pipeline.ts evidence)
│       ├── campaign-build.md          # L1/L2 breakdown (scaffolds/plan-execute evidence)
│       └── finance.md                 # L3 + retrieval + read-only ops breakdown (final.ts + finance-domain evidence)
├── contracts/                         # Language-agnostic universal contracts C1–C11
│   ├── README.md                      # Index & summary matrix of C1–C11 + how ShipProof verifies them
│   └── universal-contracts.md         # Detailed spec, anti-patterns, and deterministic checks for C1–C11
└── scaffolds/
    └── plan-execute/                  # @shipkeel/plan-execute (bin: dah, runtime dep: yaml only)
        ├── AGENTS.md                  # Local invariants (countryTimeRef, floorSetting, qa, yaml-only)
        ├── README.md                  # Scaffold quickstart & domain architecture
        ├── package.json               # @shipkeel/plan-execute
        ├── tsconfig.json
        ├── entrypoint.sh              # Updated to support workspace-hoisted tsx
        ├── .env.example
        ├── docs/                      # Runtime docs (architecture, domains, pipeline, kb, config, plan-schema)
        ├── knowledge/                 # Sample L0/L1/L2 knowledge base (preserved verbatim)
        ├── scripts/                   # copy-assets.mjs, knowledge-mcp.mjs, smoke-e2e.mjs, local/*
        ├── src/                       # Existing runtime + build/qa/gop domains (preserved verbatim)
        └── test/                      # Existing 13 offline test files (preserved verbatim)
```

Legacy `docs/agent-architecture-guide.md` and `docs/finance-domain/` are absorbed into `playbook/` (with `docs/finance-domain/` preserved as `playbook/cases/finance-blueprint/` or referenced cleanly so no valuable blueprint files are lost; specifically we keep `playbook/cases/finance-blueprint/` containing the original `brain.md`, `executor.ts`, `schemas/`, `skills/` design artifacts and remove the old root `docs/` directory so root stays clean).

## 3. Modules and boundaries
- **Root `package.json`**: owns workspace orchestration (`typecheck`, `test`, `build`, `smoke`, `list-domains`, `demo`, `verify` delegating via `npm --workspace=@shipkeel/plan-execute run ...` or `npm run ... --workspaces --if-present`).
- **`scaffolds/plan-execute/`**: self-contained TypeScript package; all relative imports (`../src/`, `../scripts/`, `../knowledge`) stay internal to `scaffolds/plan-execute/`. `entrypoint.sh` resolves `tsx` from `./node_modules/.bin/tsx`, `../../node_modules/.bin/tsx`, or PATH.
- **`playbook/` & `contracts/`**: pure Markdown documentation; zero code coupling to `scaffolds/`.

## 4. Data flow and state
No runtime data flow changes. `scaffolds/plan-execute/` preserves its exact Catalog → session/pipeline → executor → acceptance/review data flow and `.runs/` artifact layout.

## 5. API / interface contracts
- Root CLI delegation:
  - `npm run typecheck` → runs `typecheck` across workspaces (`@shipkeel/plan-execute`)
  - `npm test` → runs offline tests across workspaces
  - `npm run build` → compiles TS and copies domain assets to `scaffolds/plan-execute/dist/`
  - `npm run smoke` → runs offline E2E smoke test in `@shipkeel/plan-execute`
  - `npm run list-domains` (and `npm start -- --list-domains`) → prints available domains
  - `npm run demo` → runs local 3-server demo in `@shipkeel/plan-execute`
- Subpackage CLI: `dah` bin points to `dist/index.js` inside `@shipkeel/plan-execute`.

## 6. Error handling
- Workspace scripts fail-fast with non-zero exit code if any workspace check fails.
- `entrypoint.sh` uses `set -euo pipefail` and locates `tsx` reliably whether installed locally or hoisted to workspace root.

## 7. Test strategy
- ui-evidence: N/A — pure CLI/workspace restructure and Markdown authoring with no web UI.
- **Unit tests**: all 13 existing `node:test` suites run offline via `npm test` (both from root and inside `scaffolds/plan-execute/`).
- **Build & asset integrity**: `npm run build` + explicit checks for `scaffolds/plan-execute/dist/prompts/catalog.md`, `dist/domains/build/schemas/plan.schema.json`, `dist/domains/gop/pipelines/deployment.pipeline.yaml`, `dist/domains/qa/skills/query/spec.md`.
- **Offline E2E smoke**: `npm run smoke` (real CLI subprocess + local mock LLM + local mock MCP).
- **Documentation & link integrity**: deterministic Node verification script checking that every relative Markdown link in `README.md`, `AGENTS.md`, `playbook/**/*.md`, `contracts/**/*.md`, and `scaffolds/plan-execute/**/*.md` resolves to an existing file, and that `scaffolds/plan-execute/package.json` runtime dependencies equal `["yaml"]` and root has zero runtime dependencies.
- **Security scan**: CI regex checks for internal URLs, internal identifiers, and hardcoded secret prefixes.

## 8. Run instructions
- Verify all checks from repo root: `fh verify` or `npm run verify`
- Run local offline demo: `npm run demo`
- Run subpackage directly: `cd scaffolds/plan-execute && npm test`

## 9. Risks and trade-offs
- **Risk**: `npm ci` in CI requires `package-lock.json` to match the new npm workspace layout.
  - **Mitigation**: Regenerate `package-lock.json` via `npm install` during `TASK-1` and verify workspace hoisting cleanly.
- **Risk**: Old relative links inside moved `scaffolds/plan-execute/docs/*.md` or root `README.md` might break.
  - **Mitigation**: Run a deterministic link-checker check in `TASK-5` and in `rubric.json`.

## 10. Overview deltas
- Product overview: Repository repositioned as **ShipKeel** (Agent blueprint & starter kit: 5-level decision tree, C1–C11 universal contracts, per-paradigm scaffolds).
- Technical overview: Repository structured as npm workspaces (`shipkeel` root + `@shipkeel/plan-execute` scaffold); ShipProof gate and CI bound to workspace commands.
