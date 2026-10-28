# 架构

> **CC 做决策，代码做批量执行。**

## 设计理念

1. **模型自主性最大化** —— 模型拿到 spec 后自主完成规划与审查，代码不干预其思考过程
2. **代码只做模型不擅长的事** —— 批量并发 API 调用（32 页面 × 10 楼层 = 320 次调用）
3. **按域隔离** —— 每个业务域独立维护 spec + executor + MCP 配置
4. **Harness 可追踪** —— 每次运行有独立目录，全程日志落盘

## 三阶段模型

```
用户 prompt
   │
   ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase 1: Plan（模型会话）                                    │
│                                                             │
│ 模型读取 spec.md 作为 system prompt                          │
│ 模型使用 MCP 工具读知识库、理解业务                          │
│ 模型输出结构化 JSON: execution_plan                          │
│                                                             │
│ 耗时: ~2-3 min | context: 轻（只读，不做写入操作）           │
└─────────────────────────────────────────────────────────────┘
   │ execution_plan (JSON)
   ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase 2: Execute（代码并发，无模型）                         │
│                                                             │
│ executor.ts 接收 plan，直连 MCP 批量执行                     │
│ 并发度可配（默认 8）                                         │
│ 纯 API 调用，无 LLM 开销                                     │
│                                                             │
│ 耗时: ~2-3 min | 32 页面并发                                │
└─────────────────────────────────────────────────────────────┘
   │ execution_results (JSON)
   ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase 3: Review（模型会话）                                  │
│                                                             │
│ 模型接收执行结果                                             │
│ 检查完整性、标注异常、给出修复建议                           │
│ 输出 review_report                                          │
│                                                             │
│ 耗时: ~1 min | context: 轻（只看结果摘要）                   │
└─────────────────────────────────────────────────────────────┘
```

加上跨域路由，这一共是**四段**：

```
Catalog（跨域路由） → Plan → Execute → Review
```

Catalog 是可选的：`--domain=xxx` 会跳过它直接进域。

### 性能对比

| 方案 | 32 页面耗时 |
|---|---|
| 模型逐一执行 | ~60-120 min |
| 三阶段（模型规划 + 代码并发 + 模型审查） | **~5-7 min** |

这就是整个框架存在的理由。

## 域模型

每个域回答三个问题：

| 问题 | 定义文件 |
|---|---|
| 模型如何规划和审查？ | `spec.md` / `skills/*/spec.md` |
| 代码如何批量执行？ | `executor.ts` |
| 能用什么外部工具？ | `mcp.json` |

**新增域 = 新建目录 + 这几个文件。Runtime 不需要改动。**

## 为什么本项目仍然保留 Pipeline 引擎

原始实现里明确讨论过这个问题，结论是「三阶段是固定模式，不需要 YAML DSL」：

| 考虑 | 原始结论 |
|---|---|
| 模型够聪明吗？ | 够。给好 spec，模型自主完成规划和审查 |
| 需要代码编排吗？ | 不需要。三阶段是固定模式 |
| 需要 schema 校验吗？ | 不需要。spec 里定义好输出格式，模型遵循 |
| 需要 expr 引擎吗？ | 不需要。阶段间传递的就是 JSON 对象 |
| 批量执行需要模型吗？ | 不需要。确定性操作，代码并发更快更可靠 |

本项目**两条路都留**：

- `session` 引擎（三阶段）是默认路径，对应绝大多数场景
- `pipeline` 引擎（YAML 声明式）是可选路径，用于「阶段数不固定、每阶段有明确契约」的场景（比如投放：规划 → 建样式包 → 配排期 → 发布 → 校验）

两者的取舍：

| | session 引擎 | pipeline 引擎 |
|---|---|---|
| 阶段数 | 固定三段 | 任意 |
| 契约 | 靠 spec 里的输出约定 | 每步可挂 JSON Schema，硬校验 |
| 中间产物 | Plan → Results 两份 | 每步产物都可被下游消费 |
| 适合 | 单次决策 + 批量写入 | 多阶段、阶段间有数据依赖 |

**用哪个**：默认用 session 引擎。只有当「阶段超过三段，且后一段要消费前一段的产物」时才值得上 pipeline。

## 两种执行引擎

### session 引擎

命令式。适合「一次决策 + 一次批量写入」。

```
catalogRoute → routeSkill(brain) → invokeSession(spec) → executor → runReview
```

- 单 skill 域（如 `qa`）跳过 brain routing，直接进 skill，省一次模型调用
- 多 skill 域（如 `build`）先过 brain，再进 skill

### pipeline 引擎

声明式。适合「多阶段、每阶段有明确契约」。

```
executePipeline → for each step: invokeSession(agent) → schema 校验 → context[step.output] = result
```

- `step.input` 指定消费上一步的哪个产物
- `step.output` 指定本步产物写入 `context` 的哪个键
- `step.foreach` 对上一步产物做数组展开，逐项执行
- `step.schema` 声明产物契约，校验不过直接中断

两种引擎共用同一套基础设施：MCP 客户端池、LLM 客户端、运行上下文、追踪、进度上报。

## 为什么「模型出计划、代码做执行」

这是整个框架最核心的取舍。

| 维度 | 模型直接调接口 | 模型出计划 + 代码执行 |
|---|---|---|
| 正确性 | 模型可能调错工具、传错参数 | 计划里的参数是结构化数据，可 schema 校验 |
| 并发 | 只能串行 | 代码层并发（Layer 2A / 2B 就是并行的） |
| 重试 | 难以精确重试 | 按步骤重试，幂等边界清晰 |
| 可审计 | 只有对话记录 | 计划是纯数据，可 diff、可人工审阅 |
| 时间 | 模型可能编造时间 | 时间由代码从平台推导 |
| 成本 | 每步都要重新喂上下文 | 一次规划，多步执行 |

代价是：平台的接口要能抽象成「明确的参数结构」。如果你的场景是开放式探索，session 引擎更合适。

## 运行产物

```
.runs/<runId>/
├── meta.json            { runId, domain, status, startedAt, endedAt }
├── trace.jsonl          链路追踪（每行一个事件）
├── mcp-config.json      解析占位符后的 MCP 配置
├── mcp-catalog.json     Catalog 阶段的空 MCP 配置
└── sessions/
    ├── catalog.json     Catalog 会话记录
    ├── brain.json       brain 会话记录
    ├── query.json       query 会话记录
    ├── init.json        init 会话记录
    └── review.json      review 会话记录
```

`runId` 格式：`20261027-224755-a3f9c2`。

## 扩展点

| 想加什么 | 改哪里 |
|---|---|
| 新增一个域 | `src/domains/<新域>/` + `DOMAIN_META` + `DOMAIN_CONFIGS` + `catalog.md` |
| 新增域内 skill | `src/domains/<域>/skills/<新 skill>/spec.md` + `validSkills` |
| 给 skill 加审查 | `src/domains/<域>/skills/<skill>/review.md` |
| 换 LLM Provider | `src/runtime/llm.ts` 加一个 case + `src/runtime/config.ts` 加预设 |
| 换 MCP 传输 | `src/runtime/mcp-client.ts` 的 `McpHttpClient` |
| 换计划结构 | `src/domains/<域>/schemas/plan.schema.json` + `executor.ts` |
| 加一层执行 | `src/domains/<域>/` 加一个 `layerN-*.ts`，在 `executor.ts` 里挂上 |
| 换并发策略 | `src/runtime/parallel.ts` |

## 安全边界

- **密钥只走环境变量**。`mcp.json` 里的 `{{VAR}}` 占位符在运行时替换，磁盘上不落明文。
- **工具白名单双重约束**。System Prompt 里的工具表 + 代码侧的 `allowedTools`，两边同时生效；模型即使硬编码了白名单外的工具名，执行侧也会拒绝。
- **只读域显式拒绝写入**。`qa` 域的 executor 直接抛错，不存在「不小心写进去」的可能。
- **执行失败不扩散**。并发任务里单个失败只影响它自己，其余照常执行。
- **路由失败往安全侧兜底**。Catalog 挂了退到只读域，而不是退到创建域。
