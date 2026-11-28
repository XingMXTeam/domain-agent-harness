# ShipKeel

> **先定龙骨（ShipKeel），再验真出海（ShipProof）。**
>
> 做任何 Agent 之前先定下的工程母版：**五级范式选型决策树 + 与语言无关的 11 条通用契约（C1–C11）+ 按范式抽取的起步脚手架**。

---

## 这是什么

市面上不缺编排框架，缺的是「面对一个新业务，怎么先判断是否该做成 Agent、该选哪一级控制流、以及如何第一天就带上生产纪律和离线测试」。

**ShipKeel** 与 [**ShipProof**](https://github.com/XingMXTeam/ShipProof) 组成完整闭环：
- **设计期（ShipKeel）**：用决策树选范式 → 对照通用契约 C1–C11 定边界 → 从对应范式拷贝脚手架到独立业务仓库起步（技术栈按场景自选，不强制共享运行时）。
- **交付期（ShipProof）**：用确定性验证门禁、角色隔离与独立验真，确保新 Agent 仓库守住契约下限。

---

## 一眼看懂：五级范式与真实案例

判断原点只有两个问题：**下一步是代码决定还是模型决定？进程崩了要不要跨时间续跑？**

| 级别 | 范式 | 谁决定下一步 | 真实案例 | 起步脚手架 |
|---|---|---|---|---|
| **L0** | 增强型 LLM 调用 | 代码（单次生成） | [VisualStudio](playbook/cases/visual-studio.md)（不是 Agent，也不该做成 Agent） | 文档 + 极简示例 |
| **L1** | 固定流水线 | 代码 / YAML | [Atoms](playbook/cases/atoms.md) · [gop 投放](playbook/cases/campaign-build.md) | `scaffolds/generate-verify-repair/`（M2）· [scaffolds/plan-execute/](scaffolds/plan-execute/README.md) |
| **L2** | 模型出计划 → 代码执行 → 代码验收 | 模型规划一次，代码并发执行 | [build 活动搭建](playbook/cases/campaign-build.md) | [scaffolds/plan-execute/](scaffolds/plan-execute/README.md) |
| **L3** | 持久状态图 + 人工审批 | 图的条件边 + Checkpoint | [finance 财报解析](playbook/cases/finance.md) · 未来 BD Agent | `scaffolds/durable-graph/`（M3） |
| **L4** | 自主工具循环 | 模型逐步观察决策 | 未来浏览器手操 / CUA Agent | 暂缓（待真实项目抽取） |

详见 [**选型决策树（playbook/README.md）**](playbook/README.md)、[**模式积木与串联判据**](playbook/patterns.md) 与 [**框架与 SDK 选型**](playbook/frameworks.md)。

---

## 11 条通用契约（C1–C11）

无论选哪一级范式、用 TS 还是 Python，进入生产必须对齐同一份底线（完整细则与确定性检查见 [**contracts/universal-contracts.md**](contracts/universal-contracts.md)）：

- **C1**：确定性的值（时间、版本、ID、金额、公式结果）由代码推导，模型不产出
- **C2**：工具白名单在提示侧与代码侧双重约束
- **C3**：计划与执行分离（计划过 JSON Schema，执行是不含 LLM 调用的纯代码）
- **C4**：验收 pass / fail 由确定性代码判定，模型只解释，不能改判
- **C5**：失败往安全侧兜底；只读单元显式抛错拒绝写入
- **C6**：真值只有一条写入路径；额外 Agent 只献智不动手（只读输出结构化提议）
- **C7**：修复与返工循环必有轮次上限与无进展早停
- **C8**：模型接入支持 `real / mock / replay` 三模式；测试全部离线
- **C9**：运行事件与产物外置落盘；大文本/精确数值/二进制传键不传值
- **C10**：不可逆写操作前可插入人工审批点（L3+ 必选）
- **C11**：严禁硬编码密钥、内网地址与内部标识

---

## 目录结构

```text
shipkeel/
├── README.md                  # 总入口
├── AGENTS.md                  # 通用契约 C1–C11 + ShipProof 协议
├── playbook/                  # 五级范式决策树、模式积木、框架选型与 4 份真实案例拆解
│   ├── README.md
│   ├── patterns.md
│   ├── frameworks.md
│   └── cases/                 # visual-studio / atoms / campaign-build / finance
├── contracts/                 # 通用契约 C1–C11 索引与确定性检查细则
├── scaffolds/
│   └── plan-execute/          # @shipkeel/plan-execute（L2 + L1 参考实现，单依赖 yaml）
├── .harness/ & .agents/       # ShipProof 交付验真体系与 27 份 Skills
└── package.json               # npm workspaces 根配置
```

---

## 快速验证（全部离线，无需 API Key）

```bash
npm install
npm run verify          # typecheck + 124 条离线单测 + 构建 + 离线 E2E 冒烟 + 域列表
npm run demo            # 启动本地 3 个 mock 服务，一键演示 L2 三阶段搭建闭环
```

---

## 演进路线

- **M1（当前）**：ShipKeel 骨架重构、`playbook/` 决策树与 4 份案例拆解、`contracts/` C1–C11、`scaffolds/plan-execute/` workspace 迁移与全链路验真。
- **M2**：从 `Atoms` 抽取无界面 L1「生成-验证-修复」脚手架（`scaffolds/generate-verify-repair/`）。
- **M3**：从 `finance` 抽取并补齐 Checkpointer、Interrupt、口径数据化与三模式离线测试的 L3 脚手架（`scaffolds/durable-graph/`）。
- **M4**：将 C1–C11 导出为 ShipProof 的 `templates/standards/agent.md` 规范包。

---

## 贡献与协议

- 贡献说明见 [CONTRIBUTING.md](CONTRIBUTING.md)
- 安全策略见 [SECURITY.md](SECURITY.md)
- License: [Apache-2.0](LICENSE)
