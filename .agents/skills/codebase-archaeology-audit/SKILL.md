---
name: codebase-archaeology-audit
description: Audit Git history for removable architectural baggage, evaluate new-engineer onboarding cognitive cost, and distill recurring bugs and rework into automated guardrails, rules, or skills. Use when the user asks for a deep codebase health check, architecture archaeology, or bug retrospective; do not use for routine single-bug fixes or active feature delivery.
---

# Codebase Archaeology Audit

Treat recurring rework and confusing code as architectural evidence, not isolated accidents. Inspect Git history, evaluate onboarding friction, and codify systemic fixes into rules, tests, or skills so the team stops paying the same cost twice.

## When to Use

- The user asks for Git history archaeology, legacy baggage cleanup, onboarding cognitive cost audit, or a bug/rework retrospective.
- A project has gone through rapid AI-assisted iterations and accumulated duplicate workarounds, unclear boundaries, or repeated regressions.

Do not use for: urgent production hotfixes or routine single-feature implementation where deep historical analysis would block delivery.

## Workflow

1. **Git history and architectural baggage archaeology.** Inspect commit history and major PRs to separate intentional architecture from historical workarounds built for problems that no longer exist. Produce a concrete list of baggage that can be safely removed.
2. **New-engineer cognitive cost audit.** Walk the codebase as a strong engineer joining tomorrow with zero tribal knowledge. Flag confusing names, over-abstractions, blurred module responsibilities, and hidden implicit context; pair each finding with a concrete simplification.
3. **Bug and rework root-cause retrospective.** Review bugs, reverts, and repeated edits over the target time range. Go beyond counting incidents—identify shared systemic root causes across failures.
4. **Codify preventive guardrails.** Turn each systemic root cause into the strongest practical enforcer: an automated guardrail test, a lint/CI check, a concise rule in `CLAUDE.md`/`AGENTS.md`, or a dedicated project skill.
5. **Verify cleanup and guardrails.** Run the full test/verify suite after any approved removals or new guardrail checks to prove zero regressions.

## Anti-patterns

- ❌ Listing commit counts or bug counts without extracting shared root causes.
- ❌ Recommending vague refactors ("clean up the code") instead of naming exact files, symbols, and deletion/simplification steps.
- ❌ Deleting intentional load-bearing safeguards because their rationale was not checked in Git history.
- ❌ Ending a retrospective with prose notes only, without turning repeat bugs into automated checks or rules.

## Done Criteria

- A structured report covers all three lenses: removable Git baggage, cognitive-cost hotspots with simplifications, and shared root causes of recurring bugs.
- Every actionable systemic root cause is codified into a concrete rule, automated guardrail test, or reusable skill.
- Any applied cleanup passes the repository's verification suite cleanly.
