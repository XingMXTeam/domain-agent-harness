# 案例拆解：财报指标解析（L3 · 持久状态图 + 检索 + 只读外部工程手）

> 原型来源：`final.ts`（LangGraph.js + LightRAG REST + Pi 外部工程手）
> 域包设计稿：[finance-blueprint/README.md](finance-blueprint/README.md)
> 判定级别：**L3（持久状态图 + 人工审批）+ 检索积木 + 只读外部工程手**。
> 对应脚手架：`scaffolds/durable-graph/`（将在 M3 补齐生产能力后抽取）。

## 一、场景为什么必须到 L3？

场景是从 362 页银行年报中查清 7 个核心财务数字，计算 ROA 与 ROAE，并与年报自披露值对账：

1. **为什么不能靠一次规划（L2）解决**：
   数字散落在年报不同章节，检索一次经常缺键或取错口径，必须经过「查数 → 代码计算 → 对账失败 → 带着精确缺键/误差提示回到图谱重查 → 连续失败升级排障」的**条件边返工环**。
2. **「句子里的数只能读，格子里的数才能算」（C1 + C9）**：
   - LightRAG 建图只负责「找到」相关段落；
   - `analyst` 降级为「填表员」，只能调 `query_graph` 与 `save_fact`（Zod Schema 强校验 `id / name / value / unit / period / source`），不许自己算指标；
   - `compute()` 是纯代码节点，按键读 `facts.json` 算公式，缺键直接报错不猜；
   - `reconcile()` 是纯代码对账节点，用年报自披露值做外部真值校验（**C4**）。
3. **口径必须逐项写死，不能给总则**：
   实测显示，给 8B 模型一句总则式口径时修好了 ROAE 却带坏了 ROA；逐项写死每个键的扣减口径后一次全对。

## 二、从原型 `final.ts` 抽成生产级 L3 脚手架时暴露的两个关键缺口

对照 ShipKeel 通用契约复盘 `final.ts`，发现了两个在原型阶段容易忽略、但进入生产必踩的坑：

1. **外部工程手权限越界（直接催生了契约 C6）**：
   设计稿写的是 Pi「只交结论」，但原型实际给了 Pi `bash,read,write,edit` 权限直接改 `facts.json`，绕过了 `save_fact` 的 Schema 校验。在最不可信的「对账连续失败」时刻恰恰最不该开无校验写通道。
   → **M3 修正方案**：Pi 仅保留只读工具，输出结构化修正提议 `[{ id, value, unit, period, source, reason }]`，由编排代码逐条走 `save_fact` 同一条 Schema 校验路径落盘。
2. **缺少 L3 定义性的持久执行与人工审批能力（C8 + C10）**：
   - 原型没有 `checkpointer`，进程崩了只能从头重跑；
   - 原型没有 `interrupt`，升级叫外部工程手或覆盖真值前无法等人工确认；
   - 原型把 `NEED` 键清单、公式与披露值 `1.28/14.49` 写死在代码里，且没有 `mock / replay` 离线测试模式。
   → **M3 补齐清单**：接入 LangGraph.js Checkpointer（单测 `MemorySaver`、本地 SQLite）按 `thread_id` 断点续跑；在升级外部工程手与写入真值前加 `interrupt`；指标口径与披露值外置为数据文件；模型与图谱客户端均支持三模式离线测试。

## 三、给未来 BD 商家 Agent 的直接复用点

BD 商家跟进本质上与本案同构：同样是「检索背调 → 结构化画像 → 生成触达 → **人工审批暂停（interrupt）** → 跨天等待回复后按 `thread_id` 唤醒 → 对账/写入 CRM（唯一校验路径）」。M3 补齐后的 `scaffolds/durable-graph/` 将直接作为 BD Agent 的起步龙骨。
