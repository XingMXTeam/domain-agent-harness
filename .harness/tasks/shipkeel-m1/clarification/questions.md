# Clarification Questions — shipkeel-m1 (Imported PRD Gap Closure)

Imported PRD: `.harness/tasks/shipkeel-m1/prd.md` (from `shipkeel-decisions.md`).
Note: `REQ-n` numbering will be added in place to `prd.md` after confirmation without rewriting user wording.

## Batch 1 (Open Gaps + Module 11 Quality Expectations)

1. **Root & workspace package naming / CLI bin**: Root `package.json` name (`shipkeel`, `private: true`, npm workspaces), and `scaffolds/plan-execute/package.json` name + `bin` (`dah` vs `shipkeel-pe` vs none).
2. **Sample data inside `scaffolds/plan-execute/`**: Keep all 3 domains (`build`/`qa`/`gop`), `knowledge/`, `scripts/local/` mocks, and `smoke-e2e.mjs` intact, or trim them?
3. **Playbook format in M1**: Pure Markdown (`playbook/` + `contracts/`), or include an interactive HTML/Web decision-tree page?
4. **Quality level & red lines (Module 11)**: Target quality level and non-negotiable red lines for M1.
