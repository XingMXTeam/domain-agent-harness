---
name: challenge-and-plan
description: Challenge the user's problem framing, align preferences and constraints via focused questions, and present three contrasting options before writing any code. Use when the user asks to design a feature, triage issues, or explore a non-trivial requirement; never use for trivial one-line fixes or already-approved plans.
---

# Challenge and Plan

Do not accept a user's first framing at face value or jump straight into editing files. Separate symptoms from root causes, align constraints first, and let the user choose between concrete trade-offs before any code is written.

## When to Use

- The user proposes a non-trivial feature, architecture change, or issue backlog triage.
- A request names a heavy technical means ("add a container sandbox", "rewrite the module") without yet proving it matches the underlying goal.
- Multiple valid trade-offs exist across speed, scope, cost, or reliability.

Skip it for: one-line bug fixes, typo/copy edits, and tasks where the user already selected an explicit plan.

## Workflow

1. **Analyze read-only first (zero code edits).** Inspect only the relevant files, logs, or issues needed to understand the current system. Do not modify any file during this phase.
2. **Challenge the problem definition.** Evaluate whether the request confuses symptoms with root causes or means with goals. If a higher-leverage underlying problem exists, state it plainly with evidence.
3. **Align preferences and constraints.** Ask 2–4 concise, concrete questions covering goals, non-goals, infrastructure/budget limits, and time window. Wait for the user's answers before proposing options.
4. **Present 3 contrasting options.** After alignment, offer three distinct approaches (e.g., Minimal / Recommended Balanced / Comprehensive) with a comparison table covering scope, trade-offs, risk, effort, and exact impacted files.
5. **Wait for explicit selection.** Do not write or edit code until the user chooses an option (or gives an explicit go-ahead).

## Anti-patterns

- ❌ Editing code or creating files while still "analyzing" or before the user picks an option.
- ❌ Blindly agreeing with a symptom-level request without checking whether a simpler root-cause fix exists.
- ❌ Dumping 3 options before asking alignment questions, or presenting 3 near-identical options that hide real trade-offs.
- ❌ Asking 10 vague open-ended questions instead of 2–4 sharp, decision-driving questions.

## Done Criteria

- Zero repository files were modified prior to option approval.
- A concise root-cause challenge and 2–4 alignment questions were delivered first.
- Three genuinely distinct options with trade-offs and impacted file lists were presented after alignment, awaiting user sign-off.
