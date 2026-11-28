---
name: ui-variants-studio
description: Research live trending UI libraries and category benchmarks (shadcn/ui, 21st.dev, Magic UI, Origin UI, GitHub) and generate 3 to 5 distinct, clickable interactive HTML prototypes in ~/Downloads/ before editing production code. Use when building a 0-to-1 page, restyling a landing page, or exploring visual/interaction directions; never use for trivial copy edits or brownfield tweaks locked to an existing internal design system.
---

# UI Variants Studio

Words lie about visual taste and interaction feel. Writing CSS directly into a production repo before aligning on visual direction wastes rounds and pollutes diffs. This skill runs live trend research first — never recycling the same four static templates — and delivers an interactive multi-variant fitting room so the user picks by clicking, not guessing.

## When to Use

- Starting a 0-to-1 landing page, dashboard, or flagship workflow where visual polish and interaction feel matter.
- The user asks for a more "hype", modern, or elevated UI/interaction direction.
- Exploring multiple layout, density, or interaction paradigms before locking Design Tokens.

Do not use for: single-field brownfield tweaks inside a locked internal UI library (use `component-from-design` and follow the repo's brownfield contract instead), or backend-only changes.

## Workflow

1. **Check Greenfield vs. Brownfield boundary first.** Inspect the repo (`AGENTS.md`, `package.json`, `tokens.css`, or `.harness/brownfield-contract.md`). If the repo locks a mandatory internal UI kit and benchmark page, confirm whether this screen is allowed to explore new directions or must stay strictly within existing tokens.
2. **Scout live, current trends before designing.** Do NOT rely on stale mental defaults. Search GitHub and the live web for current open-source UI libraries and category leaders matching the product domain (for example: `shadcn/ui` blocks, `21st.dev`, `Magic UI`, `Aceternity UI`, `Origin UI`, `Motion Primitives`, plus category leaders like Linear / Attio / Raycast / Resend / Vercel). Record the exact library or benchmark inspiring each variant.
3. **Generate 3–5 genuinely distinct interactive variants (isolated from the repo).** Where the host supports parallel subagents (Antigravity `Swarm`, Claude Code `Subagents`), fan out independent workers so variants do not collapse into recolored copies of the same layout. Bundle them into a single self-contained `~/Downloads/<feature>-ui-variants.html` with top tabs to switch live between variants, showing real hover states, micro-interactions, and responsive behavior.
4. **Annotate each variant transparently.** Display a compact header bar on each variant naming its visual lineage (referenced UI library/benchmark), stack portability (e.g. Tailwind + `shadcn/ui` ready), and key trade-off.
5. **Let the user pick (or remix) before touching production code.** Present the preview path and ask the user to choose a winning variant — or mix pieces (e.g. "Variant B hero + Variant A data table"). Only after explicit sign-off extract the chosen Design Tokens and hand off to `component-from-design` / `implement-task`.

## Anti-patterns

- ❌ Recycling the same hardcoded 3–4 generic AI themes across every project without researching current open-source UI ecosystems and domain benchmarks.
- ❌ Editing production app files speculatively before the user has seen and approved a visual direction.
- ❌ Producing 3 variants that are merely light/dark/accent color swaps of the identical wireframe.
- ❌ Ignoring an existing brownfield repository's mandatory UI library and sneaking a second component library into `package.json`.

## Done Criteria

- Live trend research was performed and each variant explicitly cites its UI library or category benchmark inspiration.
- A standalone, directly openable `~/Downloads/<feature>-ui-variants.html` exists with 3–5 genuinely distinct, interactive variants.
- Zero production repository files were modified before the user selected a direction.
- Once selected, the chosen variant's tokens and component decisions are recorded cleanly for implementation.
