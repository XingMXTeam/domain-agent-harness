# Host setup (generic)

Add this to your agent instructions file (AGENTS.md or equivalent):

> At the start of every session run `harness next <feature>` and follow the returned action. The rules are in `.harness/protocol.md`. Each action belongs to one role — clarify/replan: planner, implement-task/remediate: developer, evaluate/confirm-evaluation: evaluator, review: reviewer — whose instructions are in `.harness/agents/<role>.md`. When your host supports separate sessions or sub-agents, run each role in its own context and give it only `harness packet <feature>`. Never stop at a summary: after every verdict, run the next action.

The bundled skills pack is installed at `.agents/skills/` for cross-host discovery (Antigravity, Codex, Cursor, etc.), and can also be installed anywhere with `harness skills install --dir <your skills dir>`.
