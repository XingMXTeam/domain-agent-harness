# Dev Plan — shipkeel-m1

### TASK-1: Migrate runtime into scaffolds/plan-execute and configure npm workspaces

**Goal** — Move existing runtime (`src/`, `test/`, `scripts/`, `knowledge/`, `tsconfig.json`, `entrypoint.sh`, `.env.example`, and runtime docs) into `scaffolds/plan-execute/` as workspace `@shipkeel/plan-execute`, convert root `package.json` to `shipkeel` npm workspaces, and update `.gitignore` and `package-lock.json`.

**Files**
- Create: `scaffolds/plan-execute/package.json`, `scaffolds/plan-execute/AGENTS.md`, `scaffolds/plan-execute/README.md`
- Move: `src/` → `scaffolds/plan-execute/src/`, `test/` → `scaffolds/plan-execute/test/`, `scripts/` → `scaffolds/plan-execute/scripts/`, `knowledge/` → `scaffolds/plan-execute/knowledge/`, `tsconfig.json` → `scaffolds/plan-execute/tsconfig.json`, `entrypoint.sh` → `scaffolds/plan-execute/entrypoint.sh`, `.env.example` → `scaffolds/plan-execute/.env.example`, runtime `docs/*.md` → `scaffolds/plan-execute/docs/`
- Modify: `package.json`, `package-lock.json`, `.gitignore`, `scaffolds/plan-execute/entrypoint.sh`

**Contract**
- Root `package.json`: `"name": "shipkeel"`, `"private": true`, `"workspaces": ["scaffolds/*"]`, zero `dependencies`, delegating scripts (`typecheck`, `test`, `build`, `smoke`, `start`, `list-domains`, `demo`, `verify`).
- `scaffolds/plan-execute/package.json`: `"name": "@shipkeel/plan-execute"`, `"bin": { "dah": "dist/index.js" }`, `"dependencies": { "yaml": "^2.6.1" }` only.
- `scaffolds/plan-execute/AGENTS.md`: holds local invariants (`countryTimeRef`, `floorSetting`, `qa` read-only executor, `yaml`-only runtime dependency).

**Verify**
- Unit & build: `npm run typecheck && npm test && npm run build && npm run smoke && npm run list-domains` — all exit 0.

---

### TASK-2: Author root contracts/ (C1–C11 universal contracts)

**Goal** — Create `contracts/README.md` and `contracts/universal-contracts.md` specifying all 11 language-agnostic universal contracts (C1–C11) with rationale, anti-patterns, and deterministic check methods.

**Files**
- Create: `contracts/README.md`, `contracts/universal-contracts.md`

**Contract**
- Explicitly covers C1 through C11 matching `prd.md`, including D9 (read-only external ops / single write path) and D10 (HITL approval before irreversible writes in L3+).
- Every contract lists a concrete deterministic check method usable by CI or ShipProof.

**Verify**
- Command: `node -e 'const fs=require("fs"); const s=fs.readFileSync("contracts/universal-contracts.md","utf8"); for(let i=1;i<=11;i++) if(!s.includes("C"+i)) process.exit(1);'` — exits 0.

---

### TASK-3: Author root playbook/ (L0–L4 decision tree, pattern blocks, framework guide, and 4 case breakdowns)

**Goal** — Create `playbook/README.md`, `playbook/patterns.md`, `playbook/frameworks.md`, and 4 evidence-backed case breakdowns under `playbook/cases/` (`visual-studio.md`, `atoms.md`, `campaign-build.md`, `finance.md`), moving the finance design blueprint into `playbook/cases/finance-blueprint/` and removing legacy root `docs/`.

**Files**
- Create: `playbook/README.md`, `playbook/patterns.md`, `playbook/frameworks.md`, `playbook/cases/visual-studio.md`, `playbook/cases/atoms.md`, `playbook/cases/campaign-build.md`, `playbook/cases/finance.md`
- Move: `docs/finance-domain/` → `playbook/cases/finance-blueprint/`
- Delete: legacy `docs/agent-architecture-guide.md` (absorbed into `playbook/`)

**Contract**
- `playbook/README.md`: 5-level paradigm decision tree (L0–L4) by control-flow ownership & durability, explicitly showing when NOT to build an agent (L0).
- `playbook/patterns.md`: 5 composable pattern blocks (Routing, Retrieval, Generate-Verify-Repair, Read-Only Parallel Fan-out, Human Approval / Hand-off).
- `playbook/frameworks.md`: Framework selection table inside each level (pure code loop, YAML pipeline, LangGraph.js, Google ADK / Claude Agent SDK / OpenAI Agents SDK, Temporal).
- All 4 cases cite real code/architecture evidence (`prompt-builder.ts`, `pipeline.ts`, `scaffolds/plan-execute/src/`, `final.ts` + `finance-blueprint/`).

**Verify**
- Command: `test -f playbook/README.md && test -f playbook/patterns.md && test -f playbook/frameworks.md && test -f playbook/cases/visual-studio.md && test -f playbook/cases/atoms.md && test -f playbook/cases/campaign-build.md && test -f playbook/cases/finance.md` — exits 0.

---

### TASK-4: Rewrite root README.md and AGENTS.md for ShipKeel

**Goal** — Update root `README.md` to position the repository as **ShipKeel** (connecting `playbook/`, `contracts/`, `scaffolds/`, and `ShipProof`) and refactor root `AGENTS.md` to keep only universal contracts C1–C11, workspace directory conventions, and the ShipProof protocol block.

**Files**
- Modify: `README.md`, `AGENTS.md`

**Contract**
- `README.md` introduces ShipKeel in one sentence, links to `playbook/README.md`, `contracts/README.md`, `scaffolds/plan-execute/README.md`, and explains the ShipKeel + ShipProof pairing and M1–M4 roadmap.
- `AGENTS.md` contains C1–C11 universal rules (no campaign-specific fields like `countryTimeRef` or `floorSetting` in root rules; those stay in `scaffolds/plan-execute/AGENTS.md`) and preserves the `<!-- frontend-harness:start -->` block.

**Verify**
- Command: `grep -q "ShipKeel" README.md && grep -q "C11" AGENTS.md && grep -q "frontend-harness:start" AGENTS.md` — exits 0.

---

### TASK-5: Update CI, ShipProof config/standards, and verify full-repo integrity

**Goal** — Update `.github/workflows/ci.yml`, `harness.config.json`, `.harness/verify.json`, and `.harness/standards.md` for the workspace layout, and verify zero broken Markdown links, dependency boundaries, CI asset paths, and security scan cleanliness.

**Files**
- Modify: `.github/workflows/ci.yml`, `harness.config.json`, `.harness/verify.json`, `.harness/standards.md`

**Contract**
- `.github/workflows/ci.yml` validates built assets under `scaffolds/plan-execute/dist/...`, runs `node scaffolds/plan-execute/dist/index.js --list-domains`, and keeps all 3 security grep checks intact.
- `harness.config.json` `gateCommands` and `.harness/verify.json` `checks` run workspace `typecheck`, `unit`, `build`, `smoke`, and `list-domains` cleanly from root.
- `.harness/standards.md` reflects ShipKeel's two-layer contract boundary.

**Verify**
- Full verification: `fh verify && fh gate` — all checks pass.

## Editable scope
- `package.json`
- `package-lock.json`
- `.gitignore`
- `README.md`
- `AGENTS.md`
- `playbook/**`
- `contracts/**`
- `scaffolds/**`
- `docs/**`
- `src/**`
- `test/**`
- `scripts/**`
- `knowledge/**`
- `tsconfig.json`
- `entrypoint.sh`
- `.env.example`
- `.github/workflows/ci.yml`
- `harness.config.json`
- `.harness/verify.json`
- `.harness/standards.md`
