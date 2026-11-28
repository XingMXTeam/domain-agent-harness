---
name: deterministic-eval
description: Verify AI-generated code with deterministic checks only — compiler exit codes, grep, AST, scripts — never by eyeballing. Use when reviewing or accepting generated code.
---

# Deterministic Evaluation

An AI reviewer grading AI output is biased toward approval: it sees a
real problem, talks itself into "that's probably fine", and passes the
work. This skill replaces judgement with measurement. Every check is a
command or a script with a binary outcome and a file:line citation.

## When to Use

- Before accepting AI-generated code into a branch or PR.
- After a generate/fix loop, to decide whether the loop is actually done.
- When a review comment would otherwise be "looks good to me".
- When setting up acceptance criteria for a new project or feature.

## Workflow

1. **Fix the check list first.** Write down the checks before looking at
   results: typecheck passes, lint passes, no banned patterns (e.g.
   `any`, suppressed type errors), required patterns present (e.g.
   every storage key namespaced, every user-visible string externalized).
   Output: a checklist where each item names the exact command or query.
2. **Run, don't read (Three-Layer Verification & Host Isolation).** Execute
   each check using your host's native isolation boundary (Claude Code
   static `.claude/agents/` roles, Antigravity dynamic `Swarm` + `Browser`
   subagents, or Cursor / Codex isolated worktrees & scripts):
   - **Layer 1 (Code, Data & Logic)**: real compiler/linter/test exit codes,
     runtime schema checks against live API responses, field consumption
     verification, and property-based tests (e.g. `fast-check`) for stateful
     transitions, sorting/filtering invariants, or currency/permission math.
   - **Layer 2 (Real Browser & DOM Audit)**: live interactive walkthrough
     (`interactive-review`) + browser `getComputedStyle` checks (zero
     horizontal overflow, no clipped/overlapping text, token compliance) +
     SHA-256 artifact binding.
   - **Layer 3 (Human Sign-off)**: leave `verify: "human"` subjective taste
     and release sign-off to the user via the standalone HTML report.
   Output: raw results, not impressions.
3. **Cite evidence per check.** Every passed check records where the
   evidence is (file:line of the match, the command and its exit code).
   Output: no check is marked passed without a citation.
4. **Mark unverifiable checks honestly.** If a check cannot run in this
   environment (no browser, no credentials), mark it "not verified" —
   never passed, never silently dropped. Output: an explicit
   not-covered list. In the kernel this is a third state, not a score:
   an item with no valid evidence is `unverified`, the weighted score
   is computed over verified items only, and the verdict is
   `incomplete` until the item is decided — by evidence, by an
   interactive review, or by a human. Never convert "could not check"
   into 0: 0 is a judgment ("checked, and it failed"), unverified is
   the absence of one.
5. **Report only.** Produce the report and stop. Do not edit the code
   you just evaluated, even for a "one-line obvious fix". Output: a
   report with per-check pass/fail/not-verified and evidence.
6. **Route failures back.** Hand each failure to whoever owns fixing
   (the generator, a human) with the failing evidence attached. Output:
   failures listed in dependency order (compile errors before style).

## Anti-patterns

- ❌ Reading the diff and writing "LGTM" because the code style looks
  plausible — plausibility is exactly what generated code is best at.
- ❌ Fixing a failure inline while evaluating, then reporting the fixed
  state as the evaluation result. The report must describe the code as
  it was when checked.
- ❌ Softening a failed check to "warning" because the deadline is near.
  If a check is wrong, change the checklist openly — don't bend results.
- ❌ Reporting "tests pass" from a run that only collected tests, used
  cached results, or silently skipped the failing suite.

## Done Criteria

- A report exists listing every check as pass, fail, or not-verified.
- Every pass cites file:line or a command exit code as evidence.
- The evaluated code was not modified during evaluation.
- Failed checks are listed in fix order with their evidence attached.
