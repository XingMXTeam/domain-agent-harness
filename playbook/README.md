# ShipKeel 选型决策树（五级范式 + 模式积木）

> 做任何 Agent 之前，先回答一个原点问题：**「下一步做什么，是由代码决定，还是由模型决定？进程崩了要不要断点续跑？」**
>
> 很多项目翻车不是模型不够强，而是把本来该用 L0/L1 写死的确定性流程硬做成 L4 自主循环，或把需要跨天续跑的 L3 硬塞进一次性脚本。

## 一、五级范式总表（L0–L4）

| 级别 | 范式名称 | 谁决定下一步 | 需要跨时间续跑吗 | 典型特征 | 真实案例 | 对应脚手架 |
|---|---|---|---|---|---|---|
| **L0** | 增强型 LLM 调用 | 代码（模型只做一次生成/分类） | 否 | 模板拼 Prompt、单次调用、外围是普通软件工程 | [VisualStudio](cases/visual-studio.md) | 文档 + 极简示例（不建重框架） |
| **L1** | 固定流水线（Workflow） | 代码写死或 YAML 声明 | 否（单次跑完，靠落盘重放） | 阶段可提前枚举、步骤间契约清晰、常被业务调整 | [Atoms](cases/atoms.md)、[gop 投放](cases/campaign-build.md) | `scaffolds/plan-execute`（`pipeline` 引擎）；`scaffolds/generate-verify-repair`（M2） |
| **L2** | 模型出计划 → 代码执行 → 代码验收 | 模型规划一次，之后全由代码执行 | 否（失败可按步骤重试） | 步骤参数动态，但落地是批量、并发、强幂等写入 | [build 活动搭建](cases/campaign-build.md) | [scaffolds/plan-execute](../scaffolds/plan-execute/README.md)（`session` 引擎） |
| **L3** | 持久状态图 + 人工审批 | 图的条件边（含返工环） | **是**（Checkpointer + `thread_id`） | 含返工环、跨小时/跨天等待外部事件、写前需人工审批 | [finance 财报解析](cases/finance.md)、未来 BD 商家 Agent | `scaffolds/durable-graph`（M3） |
| **L4** | 自主工具循环 | 模型逐步观察并决定下一步 | 视任务时长而定 | 环境高度动态（DOM/终端/风控），无法提前规划完整路径 | 未来浏览器手操 / CUA Agent | 暂缓（待真实项目抽取） |

## 二、3 步选型决策流

按顺序问这 3 个问题，命中即停，**永远选能解决问题的最低级别**：

```text
Q1：单次模型调用 + 确定性前后处理就能交付吗？
 ├── 是 → 选 L0（别强行做成 Agent！参考 VisualStudio）
 └── 否 ↓
Q2：流程里有返工环、跨小时/跨天等待，或必须在关键节点暂停等人工审批？
 ├── 是 → 选 L3（持久状态图 + Checkpointer + Interrupt，参考 finance / BD）
 └── 否 ↓
Q3：下一步动作能提前枚举，或模型可以一次性产出结构化计划再由代码批量执行吗？
 ├── 步骤可枚举、契约稳定、业务侧常调 → 选 L1（YAML 声明式 / 代码串联 + 校验环）
 ├── 决策动态，但落地是批量写入、要并发与幂等 → 选 L2（Plan → Execute → Review）
 └── 否（每一步都依赖实时观察环境反馈，如浏览器 DOM/弹窗）→ 选 L4（自主工具循环 + 人工接管）
```

> **开发时 Agent ≠ 运行时 Agent**：仓库里装了 ShipProof 或 `.agents/skills/`，是给「写代码的 Coding Agent」用的，不代表产品本身是 Agent（详见 [VisualStudio 案例](cases/visual-studio.md)）。

## 三、两层结构：范式 + 模式积木

选定 L0–L4 之后，再按需叠加可复用的**模式积木**（详见 [patterns.md](patterns.md)）：

- **路由（Routing）**：先判域再分派，失败兜底只读（如 `Catalog → qa`）。
- **检索（Retrieval）**：知识库目录导航或图谱检索，只负责「找到」，不负责「算对」。
- **生成-验证-修复（Generate-Verify-Repair）**：确定性探针判失败 + 有上限且带早停的修复环（如 Atoms）。
- **只读并行发散（Read-Only Fan-out）**：仅当「只读 + 独立 + 只合情报」三条件全满足时，才用多 Agent 并行。
- **人工审批 / 接管（HITL / Hand-off）**：不可逆写操作前暂停审批，或遇到登录/支付/验证码时交给人接管。

典型真实组合：
- `VisualStudio` = **L0**
- `Atoms` = **L1 + 生成-验证-修复**
- `campaign-build` = **路由 + L2（build）/ L1（gop）+ 知识库检索**
- `finance` = **L3 + 检索（LightRAG）+ 只读外部工程手**
- 未来 `BD 商家 Agent` = **L3 + 人工审批 + 幂等外发**
- 未来 `浏览器手操 Agent` = **L4 + 人工接管 + 步数预算**

## 四、下一步阅读

1. [模式积木与串联判据（patterns.md）](patterns.md) — 决定模块之间怎么传数、何时能并行。
2. [框架与 SDK 选型（frameworks.md）](frameworks.md) — 在选定 L0–L4 后，怎么选具体技术实现（自研薄循环 / YAML / LangGraph / 厂商 SDK / Temporal）。
3. [通用契约 C1–C11（contracts/）](../contracts/README.md) — 任何级别进入生产前必须对齐的 11 条底线。
4. 案例拆解：[VisualStudio](cases/visual-studio.md) · [Atoms](cases/atoms.md) · [campaign-build](cases/campaign-build.md) · [finance](cases/finance.md)。
