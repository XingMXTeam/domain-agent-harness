# Quality Expectations — shipkeel-m1

- **Quality Level**: C — 生产工程级（Production engineering quality）
- **Priority Ranking**: correctness > code quality > security > clarity/usability
- **Positive References**:
  - `docs/agent-architecture-guide.md` & `docs/finance-domain/README.md` (concise, concrete, evidence-backed Chinese engineering prose with explicit trade-off tables)
  - Existing `domain-agent-harness` repo hygiene (strict TS, offline hermetic tests, zero heavy runtime deps, clean CI)
- **Anti-References**:
  - Generic AI hype / hand-wavy playbook prose without concrete code citations or verifiable check criteria
  - Broken relative paths or stale `src/` references after moving runtime into `scaffolds/plan-execute/`
  - Bloated dependencies leaking into `scaffolds/plan-execute/`
- **Non-Negotiable Red Lines**:
  1. All existing verification checks (`typecheck`, `test`, `build`, `smoke`, `list-domains`, CI asset & security checks) pass 100% after migration.
  2. `scaffolds/plan-execute/package.json` keeps `yaml` as its sole runtime dependency; root `package.json` adds zero runtime dependencies.
  3. Zero broken internal links, stale root `src/` path references, or secret/internal-identifier leaks.
  4. `playbook/` and `contracts/` cite real code evidence from `VisualStudio`, `Atoms`, `finance` (`final.ts`), and `plan-execute` rather than vague slogans.
