# ShipKeel 通用契约（C1–C11）

> **框架会换，语言会换，但生产级 Agent 防翻车的底线不变。**
>
> 无论你选 L0、L1、L2、L3 还是 L4，无论用 TypeScript、Python、LangGraph 还是 Google ADK，只要进入生产，下面 11 条契约就是所有项目的共同底线。

## 契约总览

| 编号 | 契约 | 适用级别 | 一句话判据 |
|---|---|---|---|
| **C1** | 确定性的值由代码推导，模型不产出 | L0–L4 | 时间、版本号、ID、金额、公式结果不让模型填，模型只给引用或键 |
| **C2** | 工具白名单双重约束 | L1–L4 | Prompt 侧软引导 + 代码侧硬拦截必须同时存在且同步 |
| **C3** | 计划与执行分离 | L2（及所有批量写场景） | 计划是过 JSON Schema 的纯数据；执行是不含 LLM 调用的纯代码 |
| **C4** | 验收由代码判定，模型只解释 | L1–L4 | pass / fail 由确定性代码/探针决定，模型不能推翻或改判 |
| **C5** | 失败往安全侧兜底，只读单元显式拒写 | L1–L4 | 路由或解析异常默认落只读路径；只读执行器显式抛错拒绝写操作 |
| **C6** | 真值只有一条写入路径，额外 Agent 只献智不动手 | L1–L4 | 外部工程手（如 Pi / Coding Agent）只读输出结构化提议，经唯一校验路径写入 |
| **C7** | 修复与返工循环必有上限与无进展早停 | L1 / L3 / L4 | 必须配置最大轮次；连续两轮失败特征不变时提前终止，禁止死循环 |
| **C8** | 三模式 Provider 与全离线测试 | L0–L4 | 支持 `real / mock / replay`；单测与冒烟测试零网络、零真实 API Key |
| **C9** | 运行事件与产物外置落盘 | L1–L4 | 每次运行落盘状态、事件流与中间产物；大文本/精确数值/二进制传键不传值 |
| **C10** | 不可逆写操作前可插入人工审批点 | L3–L4（外发写场景必选） | 发消息、写 CRM、发布、扣款等动作前支持 `interrupt` 暂停与断点续跑 |
| **C11** | 严禁硬编码密钥、内网地址与内部标识 | L0–L4 | 凭证统一走环境变量占位符（如 `{{ENV_VAR}}`），CI 自动正则阻断 |

## 如何使用这套契约

1. **设计期（ShipKeel）**：在 [选型决策树](../playbook/README.md) 定完范式后，逐条对照 [universal-contracts.md](universal-contracts.md) 把适用项写进新项目的 `tech-design.md` 与 `rubric.json`。
2. **交付期（ShipProof）**：M4 会把这套清单同步导出为 ShipProof 的 `templates/standards/agent.md`，让每个新 Agent 仓库在 `fh init` 后自动作为验收门禁。
3. **局部约束不进本目录**：某个业务或脚手架特有的字段名与依赖预算（例如 `countryTimeRef`、`yaml` 单依赖）留在各自脚手架的 `AGENTS.md`（见 [scaffolds/plan-execute/AGENTS.md](../scaffolds/plan-execute/AGENTS.md)）。
