---
name: interactive-review
description: Harness reviewer. Perform the interactive assertions of a review package against the running feature — real keyboard events, continuous interaction, end states a static check cannot reach — capture evidence, and record SHA-bound conclusions in the review report. Use during the review phase, for rubric items marked verify "interactive". Never for items a static check or a judge reading can decide, and never for verify "human" items.
---

# Interactive Review

Some checks cannot be read off the code or the DOM: whether a
keyboard event actually lands, whether a drag stays smooth, whether
a game reaches its end state, whether focus survives a route change.
Static probes guess at these and guess wrong in both directions —
they pass broken interactions and fail working ones. This skill is
the middle layer of the harness's three-layer verification: a fresh
agent with operating capability performs the assertion for real, and
the kernel merges only conclusions it can verify.

## Workflow

1. **Read the package, not the story.** `harness packet <feature>`
   gives you the review package: the pending items, each with
   `assert.steps` and `assert.expect`, its anchor, and the SHA-256 of
   every target artifact. Do not read developer reports, the failure
   log, or state history — you are re-performing the assertion, not
   reviewing someone's account of it.
2. **Start the feature** as `tech-design.md` describes. It does not
   start → every item's finding is the startup failure; record it and
   stop.
3. **Perform each assertion exactly as written.** Real input events
   in a real session (Playwright or the host's browser tooling):
   the steps in order, no shortcuts, no substituting a source read,
   an API call or a unit test for the interaction.
4. **Observe the expected state.** `assert.expect` is the contract:
   it holds, it partially holds, or it does not. Capture the evidence
   at the decisive moment — a screenshot, the session trace, the
   log — under the feature's `review/` or `evidence/` directory.
5. **Re-hash the targets after the run.** The kernel merges a
   conclusion only when the bytes it binds are still the bytes on
   disk. If a target changed since the package was built, say so in
   the note instead of silently re-binding.
6. **Write the report** to the packet's report path: one entry per
   performed item with `score` (1 / 0.5 / 0), `note` (what you did
   and what you observed), `artifacts` (the evidence, including every
   target artifact), and `artifactSha` (each target's hash). Do not
   run `harness review-merge` — the orchestrator validates and
   merges.

## The human boundary

Items marked `verify: "human"` are not yours. Leave them out of the
report entirely; a human records those entries with
`"confirmedBy": "human"` and their own note. An agent's guess at a
human's judgment (how a chime sounds, whether copy reads well) is
exactly the self-report this phase exists to replace.

## Not performed is a result

An assertion you could not perform — environment down, control
unreachable, session crashed — stays OUT of the report. Absence is
honest: the item remains unverified, the verdict stays incomplete,
and the phase repeats. What you must never do is convert "could not
run it" into any score at all.

## Anti-patterns

- ❌ Using this skill for a check a static probe or a judge reading
  can decide — file presence, pattern checks, layout judgment from a
  screenshot. Interaction is the expensive layer; spend it only
  where doing is the only way to know.
- ❌ Deciding a `verify: "human"` item because no human is around.
  The item waits. An unattended human item is an incomplete verdict,
  not an invitation.
- ❌ Scoring from the source: "the handler is registered, so the key
  press works." Registration is not landing; only the performed
  assertion counts.
- ❌ Binding yesterday's run to today's bytes — reusing a report, a
  screenshot or a hash from before the artifact changed. The SHA
  binding exists to reject exactly this; do not route around it.
- ❌ Performing a friendlier version of the steps (slower typing, a
  bigger viewport, a warm cache) than the assertion specifies. The
  assertion is the contract; soften it and the review proves
  nothing.

## Done Criteria

- Every performed item has a report entry with a score, a note that
  says what was done and observed, real evidence artifacts, and a
  current SHA-256 for every target.
- Every item not performed is absent from the report and named in
  the handoff with the reason.
- No `verify: "human"` item appears in the report.
- The reviewed code was not modified during the review.
