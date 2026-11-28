---
name: repo-community-patrol
description: Patrol GitHub Issues, rigorously review and locally test pull requests, and monitor community channels such as Discord with verified replies. Use only when the user explicitly triggers a patrol or recurring loop (such as /loop or /schedule); never post publicly, close issues, or merge PRs without explicit patrol authorization.
---

# Repo Community Patrol

Run disciplined repository and community maintenance: triage GitHub Issues with clear rationale, locally run and line-review every PR to block unverified low-quality submissions, and keep every community channel responsive.

## When to Use

- The user explicitly starts a repository/community patrol or recurring `/loop` / `/schedule` check covering GitHub Issues, PRs, or Discord channels.

Do not use for: unprompted public replies, automatic PR merges during normal feature work, or repositories where the user has not authorized community actions.

## Workflow

1. **Triage GitHub Issues.** Inspect open issues one by one:
   - Identify high-value bugs and features; implement, verify, release, and reply with concrete evidence before closing.
   - For out-of-scope or wontfix issues, reply politely with clear engineering rationale.
   - For unsolicited third-party API relay or promotional spam issues, reply politely ("感谢关注，日后会出相关合作方案，敬请期待。") and never integrate third-party relays blindly.
2. **Line-by-line PR review and local test execution.** For every open PR:
   - Read every changed line and verify architectural fit, edge cases, and security.
   - Check out the PR locally and run the real test/build suite—never trust a PR description alone.
   - Reject or close unverified, low-quality, or unrun agent-generated PRs with specific, actionable findings. Merge only after confirming code health and passing local tests.
3. **Full-channel community patrol (e.g. Discord).** When community channels are in scope:
   - Check every configured channel without skipping any.
   - Convert actionable user feedback into tracked fixes or features, and follow up on pending clarifications.
   - Always use real platform `@mention` syntax (not plain text usernames) so users receive notifications.
4. **Report patrol summary.** Summarize issues triaged/closed, PRs merged/rejected with test evidence, and community threads handled.

## Anti-patterns

- ❌ Merging a PR without checking it out locally and running the real test suite.
- ❌ Silently closing issues without explaining why, or blindly integrating third-party relay spam into the product.
- ❌ Posting public replies, closing PRs, or messaging Discord channels without explicit patrol authorization.
- ❌ Typing a user's display name in plain text instead of a real `@mention` on Discord.

## Done Criteria

- Every inspected GitHub Issue has either a verified fix + evidence reply, a polite rationale reply, or the standard polite decline for promotional relay spam.
- Every reviewed PR was checked line-by-line and locally tested before any merge decision.
- Every in-scope community channel was checked and replied to with proper `@mention` notifications, followed by a concise patrol summary.
