# 案例拆解：Atoms Studio（L1 + 生成-验证-修复）

> 仓库：`XingMXTeam/Atoms`（一句话生成可验证的前端应用）
> 判定级别：**L1（固定流水线）+ 模式积木「生成-验证-修复」**。
> 对应脚手架：`scaffolds/generate-verify-repair/`（将在 M2 从本案例抽取无界面版）。

## 一、架构证据（`src/lib/agents/pipeline.ts`）

`Atoms` 对外展示为 Planner → Architect → Engineer → QA 四个角色，但从控制流看，它是一个非常克制的 **L1 Agentic Workflow**，而不是自由游走的 L4 自主 Agent：

1. **前半段是代码写死的线性串联（Prompt Chaining）**：
   `runPlanner` → `runArchitect` → `runEngineer` 按固定顺序执行，每步产出结构化 JSON（PRD 与验收标准、文件结构设计、文件集合），并经 `persistEvent` 按 `seq` 写入 `agent_events`。
2. **后半段是确定性驱动的「生成-验证-修复」循环（Evaluator-Optimizer）**：
   - **双轨确定性探针**：每轮并发执行浏览器端 `esbuild-wasm` 隔离 iframe DOM/运行时错误探针（`probePreview`）与后端沙箱 `tsc --noEmit` 静态校验（`verifySandbox`），二者合并为 `probe`。
   - **模型只补盲区、不改判硬错误**：`hasProbeFailure(probe)` 只要有编译错误、运行时错误或白屏，就确定触发修复；`runQa` 与 `planInteractiveReview` 只针对探针无法自动判定的验收项，并绑定产物 `computeFilesSha256(files)` 防篡改。
   - **两道防死循环刹车**：
     - 轮次上限：`MAX_FIX_ROUNDS = 3`；
     - 无进展早停：构造 `failureSignature`（编译错误 + 运行时错误 + 白屏 + 失败标准列表），连续两轮完全一致时设 `stalled = true` 立即终止，提示用户补充需求。
3. **三模式 Provider 与安全降级**：
   支持 `gemini`（主）→ `deepseek`（故障切换）→ `mock`（确定性单测与 E2E）→ `replay`（演示回放），且在 follow-up 增量修改时若触发回放降级直接中止保存，防止覆盖用户已有版本。

## 二、与 ShipKeel 通用契约的对应

| 契约 | Atoms 的落点 |
|---|---|
| **C4 验收由代码判定** | `hasProbeFailure`（DOM + `tsc`）独立裁决；SHA-256 绑定审查产物 |
| **C7 上限与无进展早停** | `MAX_FIX_ROUNDS = 3` + `failureSignature` 连续相同即 `stalled` |
| **C8 三模式与离线测试** | `LLM_PROVIDER=mock` 跑通 118+ Vitest 单测与 37 Playwright E2E |
| **C9 事件外置落盘** | `persistEvent` 写入数据库事件流，`currentFiles` 版本快照可回滚 |

## 三、给选型的启发

凡是「**产出物可被编译/渲染/规则脚本客观检验，且一次生成达不到 100% 稳定**」的场景（代码生成、SQL/报表生成、结构化文档/配置文件生成），**L1 + 生成-验证-修复** 是性价比最高的生产形态——比 L4 可控得多，比纯 L0 靠谱得多。
