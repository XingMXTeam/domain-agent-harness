# finance 域：财报解析（设计稿 · 未接线）

用本仓 session 引擎的形态设计的财报指标解析域。场景：362 页年报 → 查图谱取数 → 结构化事实 → 代码计算 → 与年报自披露值对账。

> **状态：设计稿，尚未注册进运行时。** 本目录是可评审的域包蓝图（spec / schema / executor / review 齐全），但没有注册到 `src/orchestrator.ts` 的 `DOMAIN_META`，运行时路由不到它。接线清单：
>
> 1. 在 `DOMAIN_META` 注册 `finance: { engine: "session", singleSkill: "analyze" }`，并补 `DOMAIN_CONFIGS` 配置
> 2. 补 `mcp.json`（如需平台类工具；图谱走 REST 可无此项，但域完整性测试要求文件存在）
> 3. 在 `src/prompts/catalog.md` 增加 finance 的路由规则（注意严格顺序匹配）
> 4. 把 `executor.ts` 的纯函数适配到运行时 executor 接口，并实现 `query_graph` / `save_fact` 两个工具（或等价的取数通道）
> 5. 同步代码侧工具白名单（`QUERY_ALLOWED_TOOLS`）与 spec.md 的工具表
>
> 接线完成后把本目录整体移入 `src/domains/finance/` 并跑全量测试。

## 为什么是这个形态（取舍）

- **口径写死在 spec，不进计划**：算哪些指标、每项扣什么，是契约不是决策。总则式口径会被模型过度推广（实测：总则版 ROAE 对了 ROA 坏了；逐项写死后 8B 模型一次全对）。
- **图谱只负责找，不负责算**：LightRAG 图里存的是描述文本，数字活在句子里；先落成 facts（值+单位+期间+出处，过 Schema）钉死，计算只认键。这是「句子里的数只能读，格子里的数才能算」。
- **对账是外部真值校验**：年报自披露 ROA/ROAE，校验不经模型的手——弱模型会为自己的错误编出可信归因，自查循环抓不住。
- **维修在图外**：对账 3 次不过才叫 Pi 修图谱/事实文件，只交结论；数仍须回本域重新对账才算数。

## 与独立原型（final.ts）的对应

| 原型 | 本域 |
|---|---|
| analyst 节点（Deep Agent + query_graph/save_fact） | session 引擎 + skills/analyze/spec.md 的工具白名单 |
| facts.json | facts.schema.json 约束的事实落盘 |
| compute 节点 | executor.ts |
| reconcile 节点 + 条件边 | review.md 规则 + executor 的代码判定 |
| pi_ops 节点 | review.md 的升级条款 |

## 运行前置

- LightRAG 官方服务端独立部署（REST），执行器经其 `/query` 取上下文；入库为离线步骤（ainsert），成本随时长线性增长，先小册验证再上全本。
- 换公司/年份：改 executor.ts 的 DISCLOSED 披露值与 spec.md 的事实键清单；新增指标必须先在 spec.md 写逐项口径。
