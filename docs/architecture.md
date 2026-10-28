# 架构

## 一句话

`domain-agent-harness` 是一个**多域 Agent 编排框架**：统一入口做域路由，域内按引擎分派，模型只出计划、代码负责执行。

## 请求生命周期

```
                          ┌─────────────────────────────┐
   用户输入 ────────────► │ Phase 0  Catalog Route      │  一次轻量 LLM 调用
                          │ 读 catalog.md → 判定 domain  │  输出 {"domain":"..."}
                          └──────────────┬──────────────┘
                                         │
              ┌──────────────────────────┼──────────────────────────┐
              │ engine=session                                   engine=pipeline
              ▼                                                          ▼
   ┌────────────────────────┐                        ┌──────────────────────────┐
   │ 域内 brain routing      │                        │ 读 pipelines/*.yaml       │
   │ 一次轻量 LLM 调用       │                        │ 按 step 顺序执行 Agent    │
   │ → {"skill":"init"}      │                        │ 每步产物过 JSON Schema    │
   └───────────┬────────────┘                        └────────────┬─────────────┘
               │                                                  │
               ▼                                                  ▼
   ┌────────────────────────┐                        ┌──────────────────────────┐
   │ Plan（模型出计划）      │                        │ Plan（每个 Agent 出计划） │
   │ init/spec.md           │                        └──────────────────────────┘
   │ → plan.json            │
   └───────────┬────────────┘
               │ schema 校验
               ▼
   ┌────────────────────────┐
   │ Execute（代码并发执行）  │  ← 关键：这里没有模型
   │ Layer 1 / 2A / 2B /    │
   │ 2.5 / 3                │
   └───────────┬────────────┘
               ▼
   ┌────────────────────────┐
   │ Review（只读校验）       │
   └────────────────────────┘
```

## 三层路由

| 层 | 文件 | 作用 | 失败兜底 |
|---|---|---|---|
| Catalog | `src/prompts/catalog.md` | 跨域路由：build / qa / gop | 兜底 `qa`（只读域） |
| Brain | `src/domains/<域>/brain.md` | 域内 skill 路由：init / query / fix | 兜底第一个合法 skill |
| Plan | `src/domains/<域>/skills/<skill>/spec.md` | 产出结构化计划 | schema 校验不过则直接失败，不带脏数据执行 |

三层都是「读一个 Markdown → 让模型输出 JSON」。好处是：**改路由规则不用改代码**，改完立刻生效。

## 双引擎

### session 引擎

命令式。适合「一次决策 + 一次批量写入」。

```
catalogRoute → routeSkill(brain) → invokeSession(spec) → [build 域] executor
```

- 单 skill 域（如 `qa`）跳过 brain routing，直接进 skill，省一次 LLM 调用
- 多 skill 域（如 `build`）先过 brain，再进 skill

### pipeline 引擎

声明式。适合「多阶段、每阶段有明确契约」。

```
executePipeline → for each step: invokeSession(agent) → schema 校验 → context[step.output] = result
```

- `step.input` 指定消费上一步的哪个产物
- `step.output` 指定本步产物写入 `context` 的哪个键
- `step.foreach` 对上一步产物做数组展开，逐项执行
- `step.schema` 声明产物契约，校验不过直接中断流水线

两种引擎共用同一套基础设施：MCP 客户端池、LLM 客户端、运行上下文、追踪、进度上报。

## 为什么「模型出计划、代码做执行」

这是整个框架最核心的取舍。

| 维度 | 模型直接调接口 | 模型出计划 + 代码执行 |
|---|---|---|
| 正确性 | 模型可能调错工具、传错参数 | 计划里的参数是结构化数据，可 schema 校验 |
| 并发 | 只能串行 | 代码层并发（本项目 Layer 2A / 2B 就是并行的） |
| 重试 | 难以精确重试 | 按步骤重试，幂等边界清晰 |
| 可审计 | 只有对话记录 | 计划是纯数据，可 diff、可人工审阅 |
| 时间 | 模型可能编造时间 | 时间由代码从平台推导 |
| 成本 | 每步都要重新喂上下文 | 一次规划，多步执行 |

代价是：平台的接口要能抽象成「明确的参数结构」。如果你的场景是开放式探索（比如「帮我查查有什么」），session 引擎更合适。

## 运行时目录

```
.runs/<runId>/
├── trace.jsonl            链路追踪（每行一个事件）
├── mcp-config.json        解析占位符后的 MCP 配置
├── mcp-catalog.json       Catalog 阶段的空 MCP 配置
└── sessions/
    ├── catalog.json       Catalog 会话记录
    ├── brain.json         brain 会话记录
    ├── query.json         query 会话记录
    └── init.json          init 会话记录
```

`runId` 格式：`20261027-224755-a3f9c2`。

## 扩展点

| 想加什么 | 改哪里 |
|---|---|
| 新增一个域 | `src/domains/<新域>/` + `DOMAIN_META` + `DOMAIN_CONFIGS` + `catalog.md` |
| 新增域内 skill | `src/domains/<域>/skills/<新 skill>/spec.md` + `validSkills` |
| 换 LLM Provider | `src/runtime/llm.ts` 加一个 case + `src/runtime/config.ts` 加预设 |
| 换 MCP 传输 | `src/runtime/mcp-client.ts` 的 `McpHttpClient` |
| 换计划结构 | `src/domains/<域>/schemas/plan.schema.json` + `executor.ts` |
| 加一层执行 | `src/domains/<域>/` 加一个 `layerN-*.ts`，在 `executor.ts` 里挂上 |
| 换并发策略 | `src/runtime/parallel.ts` |

## 安全边界

- **密钥只走环境变量**。`mcp.json` 里的 `{{VAR}}` 占位符在运行时替换，磁盘上不落明文。
- **工具白名单**。`allowedTools` 在代码侧生效，模型请求白名单外的工具不会执行。
- **只读域显式拒绝写入**。`qa` 域的 executor 直接抛错，不存在「不小心写进去」的可能。
- **执行失败不扩散**。并发任务里单个失败只影响它自己，其余照常执行。
- **路由失败往安全侧兜底**。Catalog 挂了退到只读域，而不是退到创建域。
