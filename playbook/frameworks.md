# 框架与 SDK 选型指南

> **先定范式（L0–L4），再选框架。** 编排框架正在快速商品化，真正拉开生产差距的是口径规则、确定性验收与离线评估集。框架只负责提供你需要的运行时能力，绝不为了用框架而把 L0/L1 复杂化。

## 一、按范式映射实现选项

| 范式级别 | 首选实现 | 何时引入外部框架 / 厂商 SDK | 避免的坑 |
|---|---|---|---|
| **L0 增强型 LLM** | 直接调官方 REST / 轻量 SDK + 结构化输出（Zod / JSON Schema） | 几乎不需要编排框架 | 为单次生图或分类引入 LangGraph 或多 Agent 框架 |
| **L1 固定流水线** | 两种路线：① 流程常被非研发/业务调、要审计 diff → **YAML 声明式引擎**（如 `scaffolds/plan-execute` 的 `pipeline`）；② 含验证修复循环且由工程师维护 → **纯代码串联 + 循环**（如 `Atoms` 的 `pipeline.ts`） | 需要跨机器调度或定时重试时，才考虑 Temporal / Inngest / Cloudflare Workflows | 把简单 3 步串联包装成隐式黑盒链，出 bug 无法单步重放 |
| **L2 Plan-Execute-Review** | **薄 Harness 代码**（Provider 无关 LLM Client + MCP Client + JSON Schema 校验 + 并发执行器，见 `scaffolds/plan-execute`） | 仅当某一步工具数极多且需厂商原生代码执行沙箱时局部接入 | 在批量执行器里直接嵌 LLM 调用，或把控制流让渡给黑盒框架 |
| **L3 持久状态图 + HITL** | **LangGraph.js**（`StateGraph` + Checkpointer + `interrupt`） | 已有重型跨天业务编排底座（如生产级工作流集群）时，用 **Temporal / Inngest** 托管持久执行，LangGraph 只管图内节点 | 自己从零手写持久化状态机与断点恢复；或用 LangGraph 却不配 Checkpointer（退化成一次性脚本） |
| **L4 自主工具循环** | **薄循环 Harness**（`sdk-client.ts` 式 while 循环 + 工具白名单）或 **厂商 SDK**（Google ADK / Claude Agent SDK / OpenAI Agents SDK） | 需要第一时间吃厂商原生能力（如 Gemini Live / 多模态 → Google ADK；代码编辑循环 → Claude Agent SDK；轻量 handoff → OpenAI Agents SDK）时直接用厂商 SDK，**外围强制套 C1–C11 契约** | 不设 `maxTurns` 上限、不加人工接管点、不落盘每步工具证据 |

## 二、厂商 SDK vs 自研薄 Harness 怎么选？

| 维度 | 厂商 SDK（Google ADK / Claude Agent SDK / OpenAI Agents SDK） | 自研薄 Harness（如 `scaffolds/plan-execute/src/runtime/`） |
|---|---|---|
| **优势** | 起步极快；直接享有厂商原生循环优化、Live/多模态与托管调试界面 | 零重型依赖；Prompt / 上下文 / 控制流 100% 透明；多模型与离线 mock 切换无痛 |
| **代价** | 存在一定厂商绑定；黑盒行为在最后 20% 难微调 | 需要自己维护轻量工具循环、重试与流式解析 |
| **适用判断** | 探索期、重度依赖单家多模态/原生生态、团队希望「买循环、只写业务」 | 多模型/本地模型混跑、强审计、强离线测试、需要跨项目长期掌控 |

## 三、工具上下文经济学（工具多时怎么处理）

工具定义（输入侧）与工具原始输出（过程侧）是上下文膨胀的两大元凶：

1. **工具数 ≤ 10**：直接按阶段切分静态白名单（规划只读、执行受限），全量加载最稳也最准（**C2**）。
2. **工具数 > 10**：先拆分更细的域或阶段子集；仍不够时，再评估按需工具搜索（如 Anthropic `defer_loading` / Tool Search）。
3. **工具数成百上千且读多写少**（平台型 API）：可评估代码化调用 / Code Mode（只暴露 `search()` + `execute()`），但**写操作重、靠逐工具契约保命的系统禁止用万能执行口**，契约安全性优先于省 token。
4. **过程侧输出**：工具返回的大段原始数据先落盘，只向模型回传结构化摘要 + 指针（**C9**）。
