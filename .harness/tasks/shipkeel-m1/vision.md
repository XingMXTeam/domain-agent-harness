# Quality vision — shipkeel-m1

ui-vision: N/A — pure Node/TypeScript workspace restructure and Markdown playbook/contracts authoring with no web UI.

## 1. Positioning
Level: production
Priorities: correctness > code quality > security > clarity
Tone: concise, concrete, engineering-first Chinese documentation grounded in real code evidence; zero marketing fluff.

## 2. References
REF-1: `docs/agent-architecture-guide.md` & `docs/finance-domain/README.md` — worth copying: crisp decision formulas, explicit trade-off tables, concrete code/contract citations, honest non-goals — applies to: playbook & contracts
REF-2: Original `domain-agent-harness` repo hygiene — worth copying: strict TypeScript (`noUncheckedIndexedAccess`), 100% offline hermetic `node:test` + E2E smoke tests, single runtime dependency (`yaml`), zero secrets/internal leaks — applies to: workspace & scaffold migration
ANTI-1: Generic AI framework hype docs — avoid: vague advice without verifiable checks, claiming every LLM app is an "Agent", listing frameworks without concrete control-flow criteria — applies to: playbook & contracts
ANTI-2: Half-migrated monorepo — avoid: stale `src/` or `dist/` paths in CI/scripts/docs, broken relative Markdown links, or runtime dependencies leaking into root or `scaffolds/plan-execute` — applies to: workspace migration

## 3. Design intent
- Structure: Root holds only methodology (`README.md`, `AGENTS.md`, `playbook/`, `contracts/`) and workspace plumbing (`package.json`, `.github/`, `.harness/`, `.agents/`). All runnable L2 runtime code lives cleanly under `scaffolds/plan-execute/`.
- Clarity: A developer opening ShipKeel can go from root `README.md` → `playbook/README.md` (5-level decision tree) → `contracts/README.md` (C1–C11) → `scaffolds/plan-execute/README.md` in 3 clicks with zero dead links.

## 4. Red lines
RL-1: Existing `typecheck`, `unit`, `build`, `smoke`, `list-domains`, or CI asset checks fail after migrating runtime to `scaffolds/plan-execute/`. (check: command)
RL-2: `scaffolds/plan-execute/package.json` adds any runtime dependency beyond `yaml`, or root `package.json` adds any runtime dependency. (check: command)
RL-3: Any broken relative Markdown link, stale root `src/` reference in CI/harness config, or secret/internal-identifier leak exists in the repo. (check: command)
RL-4: `playbook/` or `contracts/` lacks real code-grounded evidence for the 4 cases (`VisualStudio`, `Atoms`, `campaign-build`, `finance`) or omits any of C1–C11. (check: command)

## 5. Rubric mapping
- REQ-1..REQ-6 -> L1 essential deterministic checks (`command` / `file` / `grep`)
- Workspace edge paths & path resolution -> L2 robustness checks
- L3/L4 UI layers -> N/A (pure CLI/Markdown restructure)
- RL-1..RL-4 -> pitfall & essential deterministic checks
