<!-- 中文阅读版 · 生效文件为同目录 SKILL.md -->

# UI Variants Studio（实时采风 × 多方案交互试衣间）

用文字描述「高级感 / Hype 感 / 交互爽感」一定会失真；没对齐审美就直接改正式代码库，只会来回返工污染 Diff。本 Skill 强制在写正式 UI 代码之前，先做**实时开源审美采风**，再生成 3~5 套真正可点击体验的交互原型试衣间供拍板。

## 适用与禁用边界
- **适用**：从 0 到 1 新页面、落地页改版、核心看板交互重构，或用户希望更有时代感与 Hype 氛围时。
- **禁用**：已有老仓库内被锁死在内部组件库的小修小改（应直接遵循老仓库组件白名单与 `component-from-design`）。

## 执行步骤
1. **先判新旧仓库边界**：读取 `AGENTS.md` / `package.json` / `.harness/brownfield-contract.md`，确认是绿地探索还是老仓库严格复用。
2. **强制实时采风（拒绝套固定 AI 模板）**：去 GitHub 与主流开源 UI 生态检索当下最新设计语言与品类标杆（如 `shadcn/ui` Blocks、`21st.dev`、`Magic UI`、`Origin UI`、`Aceternity UI`、Linear / Attio / Raycast / Resend 等），每套方案必须注明参考来源。
3. **并行生成 3~5 套差异化可交互原型**：在支持多代理的宿主（Antigravity `Swarm` / Claude Code `Subagents`）下尽量并行独立出稿避免雷同，打包成一份可双击打开的 `~/Downloads/<feature>-ui-variants.html`（顶部 Tab 秒切，含真实 Hover 与微动效）。
4. **选定或混搭后再落正式代码**：不提前污染生产仓库；等用户拍板（支持“方案 B 氛围 + 方案 A 表格”混搭）后，再抽出 Design Token 移交正式实现。

## 验收标准
- 产出包含 3~5 套明显不同流派、注明最新开源/标杆来源的可交互 `~/Downloads/<feature>-ui-variants.html`。
- 用户明确拍板前，未改动正式仓库业务代码。
