---
name: autonomous-delivery-proof
description: Execute an approved plan end-to-end in a Git worktree, polish UI and performance with restrained micro-interactions, ship a clean PR, and generate a standalone runnable HTML acceptance report in ~/Downloads/. Use only when the user explicitly opts into autonomous or overnight delivery (such as /goal); never self-trigger during exploratory discussion.
---

# Autonomous Delivery Proof

Carry an approved plan all the way from isolated worktree implementation to verified PR merge and a self-contained HTML proof the user can open directly in a browser after returning.

## When to Use

- The user explicitly requests unattended, overnight, or `/goal`-style end-to-end delivery after a plan is approved.
- The user asks for a standalone runnable HTML acceptance proof under `~/Downloads/`.

Do not use for: open-ended brainstorming, unapproved architecture changes, or quick exploratory chats where autonomous commits/deployments would be unexpected.

## Workflow

1. **Work in an isolated Git worktree.** Create or use a dedicated feature branch/worktree so `main` stays clean. Keep commits focused and verify zero secrets exist in diffs.
2. **Implement incrementally and polish craft.** Deliver every planned requirement first, then elevate visual hierarchy, restrained reduced-motion-safe micro-interactions, and runtime performance without breaking existing selectors or accessibility.
3. **Run full verification gates without stopping prematurely.** Run typecheck, lint, unit tests, production build, and E2E/live verification. Fix failures autonomously until every gate passes with zero errors.
4. **Generate a standalone HTML acceptance report in `~/Downloads/`.** Write `~/Downloads/<project>-acceptance-report-<YYYY-MM-DD>.html` containing:
   - Offline base64-embedded real screenshots from live/E2E runs.
   - Actual verification outputs (commands, pass counts, deployed version IDs, PR links).
   - An interactive or directly verifiable proof demonstrating the delivered behavior works end-to-end.
5. **Ship cleanly.** Commit cleanly, push the branch, open/merge the PR as requested, and confirm `git status` is clean before writing the final summary.

## Anti-patterns

- ❌ Self-triggering autonomous commits, deployments, or PR merges when the user only asked to discuss or review.
- ❌ Stopping mid-task to ask trivial questions during an explicitly requested unattended `/goal` run.
- ❌ Generating an HTML report with fabricated test results, broken local image paths, or skipped verification gates.
- ❌ Committing secrets, `.env` files, or unverified code.

## Done Criteria

- All planned features and UI/performance polish are implemented in a clean Git worktree and merged/pushed via PR.
- Every verification gate (typecheck, lint, unit, build, E2E) passed after the final edit.
- A self-contained, directly openable HTML acceptance report exists in `~/Downloads/` with real embedded screenshots and factual test outputs.
