# ShipKeel 定位与重构决策记录

> 来源：2026-11-28 `/grill-me` 对齐（Q1–Q10）。本文件是 M1 澄清阶段的输入，可直接作为 `fh new shipkeel-m1 --prd` 的底稿。

## 一句话定位

**ShipKeel：做任何 agent 之前先定下的龙骨——选型决策树 + 与语言无关的契约 + 按范式分的起步脚手架。**
和 ShipProof 组成同一套隐喻：先定龙骨（ShipKeel：设计期），再验真出海（ShipProof：交付期）。

## 已拍板的决策

| # | 决策 | 结论 |
|---|---|---|
| D1 | 第一用户 | 先服务自己和团队：作为接下来每个 agent（BD / 浏览器手操 / 素材视频）的工程母版；开源传播放后面 |
| D2 | 与新 agent 的关系 | 每个新 agent 是**独立仓库**、技术栈自选；从 ShipKeel 拷脚手架起步，用 ShipProof 验收是否对齐契约。不共享运行时依赖 |
| D3 | 仓库形态 | **就地重构**：本仓改名，现有 runtime 移到 `scaffolds/plan-execute/`，根目录只留方法论 |
| D4 | 品牌名 | **ShipKeel**（npm、GitHub 均无同名项目） |
| D5 | 决策树主轴 | 两层分类：**五级范式**（按「谁决定下一步、要不要跨时间续跑」）+ **可叠加的模式积木**；框架选型下沉为每级范式内的实现选项，业务场景作为案例库 |
| D6 | 第一批脚手架 | 只做有真实项目可抽取的：L2（现有 runtime）、L1 + 生成-验证-修复（Atoms）、L3（finance）；L0 只写文档 + 极简示例；L4 等真做浏览器 agent 再抽 |
| D7 | 语言 | 全部用 TS（L3 用 LangGraph.js，LightRAG 当外部 REST 服务）；契约的跨语言性由契约文档 + ShipProof `agent.md` 保证 |
| D8 | 原架构约束 | 分两层：通用的上升为根目录契约；投放专属字段、qa 域、「只依赖 yaml」下沉到 `scaffolds/plan-execute/AGENTS.md`；每个脚手架自己声明依赖预算 |
| D9 | 外部工程手 | 只读；修正以结构化提议交回，由编排代码走唯一校验路径写入 |
| D10 | L3 样板 | 在 final.ts 基础上补齐 checkpointer、interrupt、口径数据化、三模式 provider 之后才算 L3 |

## 五级范式与真实项目映射

| 级别 | 范式 | 谁决定下一步 | 真实项目 | 脚手架 |
|---|---|---|---|---|
| L0 | 增强型 LLM 调用 | 代码（模型只做一次生成） | VisualStudio（模板拼 prompt + 关键词匹配 + 一次生图） | 文档 + 极简示例 |
| L1 | 固定流水线 | 代码 | Atoms（Planner→Architect→Engineer 串联）、gop 投放流水线 | `scaffolds/generate-verify-repair/`（M2） |
| L2 | 模型出计划、代码执行、代码验收 | 模型出计划一次，之后由代码执行 | build 搭建域 | `scaffolds/plan-execute/`（M1，现有 runtime） |
| L3 | 持久状态图 + 人工审批 | 图的条件边，可断点续跑 | finance（对账返工环 + Pi）、未来的 BD agent | `scaffolds/durable-graph/`（M3） |
| L4 | 自主工具循环 | 模型逐步决定 | 未来的浏览器手操 agent | 暂缓 |

**模式积木**（可叠加在任一范式上）：路由 · 检索 · 生成-验证-修复 · 只读并行发散 · 人工审批/接管。
例：Atoms = L1 + 生成-验证-修复；finance = L3 + 检索 + 外部工程手；浏览器 agent = L4 + 人工接管。

## 通用契约（根目录 `contracts/`）

| # | 契约 | 来源 |
|---|---|---|
| C1 | 确定性的值（时间、版本、ID、金额）由代码或数据推导，模型不产出 | 原第 1、2 条 |
| C2 | 工具白名单在提示侧和代码侧双重约束 | 原第 3 条 |
| C3 | 计划与执行分离：计划是过 schema 的纯数据，执行是不含模型调用的代码 | 原第 4 条 |
| C4 | 验收的通过/失败由确定性代码判定，模型只解释原因，不能改判 | 本仓 Review、Atoms 探针、finance 对账 |
| C5 | 失败往只读/安全侧兜底；只读单元显式拒绝写入 | 原第 5、6 条 |
| C6 | 真值只有一条写入路径；额外的 agent 只贡献智能，不贡献动作 | D9 |
| C7 | 修复/返工循环必须有轮次上限和无进展提前停止 | Atoms、finance |
| C8 | 模型接入支持真实 / mock / 回放三种模式；测试全部离线 | Atoms、本仓 mock-llm |
| C9 | 运行事件与产物落盘（可追踪、可重放） | trace.jsonl、Atoms agent_events |
| C10 | 不可逆写操作前可插入人工审批点（L3+ 必须有） | D10 |
| C11 | 不写密钥、内网地址和内部标识 | 原「不要做的事」 |

M4 会把这份清单导出为 ShipProof 的 `templates/standards/agent.md`，在每个新 agent 仓库里自动当门禁。

## 目标目录结构（M1 完成后）

```text
shipkeel/
├── AGENTS.md                  # 只保留通用契约 + fh 协议块
├── playbook/                  # 五级范式决策树、模式积木、框架选型、案例拆解
│   └── cases/                 # visual-studio / atoms / finance / campaign-build
├── contracts/                 # C1–C11 的完整说明与检查方法
├── scaffolds/
│   ├── plan-execute/          # L2：现有 src/ test/ scripts/ knowledge/ 整体迁入，自带 AGENTS.md（局部约束）
│   ├── generate-verify-repair/  # L1（M2）
│   └── durable-graph/         # L3（M3）
├── package.json               # private，npm workspaces 根
└── .harness/ .agents/         # ShipProof
```

## 里程碑（每个都是一个 fh feature）

| 里程碑 | 范围 | 验收要点 |
|---|---|---|
| M1 重构骨架 | 改名、迁移 runtime、写 playbook/ 与 contracts/、改成 workspaces、更新 CI 和 verify.json | 迁移后原有 typecheck / test / build / smoke / list-domains 全绿；CI 资产检查改用新路径；四份案例拆解齐全 |
| M2 L1 样板 | 从 Atoms `pipeline.ts` 抽取无界面版：角色串联 + 探针接口 + 有上限的修复循环 + 三模式 provider + 事件落盘 | 离线测试覆盖：一次通过、修复后通过、轮次耗尽、无进展提前停 |
| M3 L3 样板 | 从 final.ts 抽取：LangGraph.js 图 + facts 层 + 代码计算/对账 + 只读外部工程手 + checkpointer + interrupt + 口径数据化 | 离线测试覆盖：缺键返工、对账失败升级、interrupt 后按 thread_id 续跑、外部提议被 schema 拒绝 |
| M4 导出 agent.md | 契约清单 → ShipProof standards 包 | 在一个新空仓库里 `fh init` 后能读到并检查它 |

### M1 需求编号（REQ-n，按已确认决策与澄清原意逐条编号）

- REQ-1: 根目录改名为 ShipKeel（根 `package.json` 设为 `name: "shipkeel"`, `private: true`, `workspaces: ["scaffolds/*"]`），并重写根 `README.md` 与 `AGENTS.md`（根目录只保留 C1–C11 通用契约与 ShipProof 协议块）。
- REQ-2: 将现有运行时（`src/`、`test/`、`scripts/`、`knowledge/`、`tsconfig.json`、`entrypoint.sh`、`.env.example` 与运行时文档）完整迁入 `scaffolds/plan-execute/`，作为 `@shipkeel/plan-execute` 子包（保留 `bin: dah`、`yaml` 唯一运行时依赖与 `build`/`qa`/`gop` 三域全部示例资产），并建立 `scaffolds/plan-execute/AGENTS.md` 承接局部约束。
- REQ-3: 在根目录建立纯 Markdown 的 `playbook/`：包含 L0–L4 五级范式决策树、可叠加模式积木、各范式内框架选型指南，以及 4 份引用真实代码证据的案例拆解（`playbook/cases/visual-studio.md`、`atoms.md`、`campaign-build.md`、`finance.md`）。
- REQ-4: 在根目录建立 `contracts/`：完整定义 C1–C11 通用契约的规则说明、反例与确定性检查方法。
- REQ-5: 更新 `.github/workflows/ci.yml`、`.gitignore`、`harness.config.json`、`.harness/verify.json` 与 `.harness/standards.md`，使根目录 workspace 命令、CI 资产校验、安全扫描与 `fh verify` / `fh gate` 在新目录结构下 100% 全绿。
- REQ-6: 全仓无断链、无旧根路径残留、无密钥或内网标识泄露，`scaffolds/plan-execute` 原有 `typecheck` / `test` / `build` / `smoke` / `list-domains` 全部离线通过。

**由你操作**：M1 结束后在 GitHub 上把 `domain-agent-harness` 改名为 `ShipKeel`（旧 URL 会自动重定向）。

## 尚未决定、留给 M1 澄清阶段的细节

- 根 `package.json` 的包名，以及是否保留 `dah` 这个 CLI 命令名（npm 上从未发布过，改名无外部成本）
- `scaffolds/plan-execute/` 内是否保留 build / qa / gop 三个域的全部示例数据（`knowledge/`、mock 服务）
- playbook 的格式：纯 Markdown，还是附带一个交互式决策树页面
