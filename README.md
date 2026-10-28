# domain-agent-harness

> 多域 Agent Harness —— 统一域路由（Catalog）+ 双执行引擎（session / pipeline）
>
> **模型负责决策，代码负责并发执行。**

一个把「自然语言需求」变成「可审计、可复现的批量执行」的开源框架。

---

## 这是什么

大多数 Agent 项目把一切都塞进一个巨大的 Prompt：领域知识、工具清单、业务规则、输出格式全揉在一起。模型一换、工具一多，行为立刻漂移。

`domain-agent-harness` 换了个思路：

| 关注点 | 交给谁 | 为什么 |
|---|---|---|
| 判断用户意图属于哪个域 | **Catalog**（一次轻量 LLM 调用） | 域之间共享一个入口，路由后可分派到不同引擎 |
| 域内该走哪个 skill | **brain.md**（一次轻量 LLM 调用） | 域内再分一次，避免单域 Prompt 膨胀 |
| 产出结构化计划 | **模型 + JSON Schema** | 计划与执行解耦，产出可校验、可 diff |
| 真正调用平台接口 | **代码（并发执行器）** | 模型不直接写接口，减少幻觉、重试与幂等可控 |
| 事后校验 | **Review Agent（只读）** | 与执行解耦，校验不复用执行路径 |

### 性能

32 个页面的搭建任务：

| 方案 | 耗时 |
|---|---|
| 模型逐一执行 | ~60-120 min |
| 三阶段（模型规划 + 代码并发 + 模型审查） | **~5-7 min** |

一句话：**LLM 只出计划，代码只做执行**。

---

## 核心特性

- **双引擎并存**
  - `session` —— 命令式：单次 LLM 会话 + 域内 skill 路由（适合「查一查」「修一修」）
  - `pipeline` —— 声明式：YAML 定义的多 Agent 流水线，步骤间用 JSON Schema 契约约束（适合「投放」这类多阶段流程）
- **统一域路由（Catalog）**
  - 一个 `catalog.md` 描述所有域，路由失败自动兜底到只读域（查询比创建安全）
- **零重型依赖**
  - 运行时只依赖 `yaml`；MCP 客户端、LLM 客户端、JSON Schema 校验全部自实现，可离线审计
- **LLM Provider 可切换**
  - Anthropic / OpenAI 兼容端点 / DashScope 兼容模式，同一套抽象
- **MCP 原生**
  - Streamable HTTP 与 stdio 两种传输；工具名统一 `mcp__<server>__<tool>`
  - 失败自动重试 + 会话重建
- **并发执行器**
  - 分层并发 + 并发上限（默认 8）；单点失败不扩散
- **三阶段模型**
  - Plan（模型）→ Execute（代码并发）→ Review（模型只读审查）
- **可审计**
  - 每次运行落盘 `trace.jsonl` 与会话记录，stderr 是日志、stdout 是结构化进度

---

## 快速开始

```bash
git clone https://github.com/XingMXTeam/domain-agent-harness.git
cd domain-agent-harness
npm install
cp .env.example .env      # 填入 LLM_PROVIDER 与对应的 API Key
```

### 自动路由（Catalog）

```bash
npm start -- "查一下 618 大促的页面结构"
```

### 指定域

```bash
npm start -- --domain=build "创建 618 大促，巴西站，首屏放 Banner"
npm start -- --domain=qa   "这个楼层的选品规则是什么"
npm start -- --domain=gop  "给 618 大促投放样式包和排期"
```

### 查看可用域

```bash
npm start -- --list-domains
```

### 沙箱入口

容器 / CI 里用 `entrypoint.sh`：以 root 启动时自动降权到普通用户再执行。

```bash
bash entrypoint.sh "创建 618 大促"
```

---

## 目录结构

```
src/
├── index.ts                     CLI 入口
├── orchestrator.ts              编排器：Catalog 路由 + 引擎分派 + 域内 skill 路由
├── types.ts                     全局类型契约
├── prompts/
│   └── catalog.md               域路由 System Prompt
├── runtime/
│   ├── mcp-client.ts            MCP 客户端池（重试 / 会话重建）
│   ├── sdk-client.ts            会话执行器（模型 ↔ 工具闭环）
│   ├── llm.ts                   Provider 无关的 LLM 客户端
│   ├── https-client.ts          POST + SSE 流式 POST
│   ├── run-context.ts           运行上下文 / MCP 配置生成
│   ├── pipeline-engine.ts       声明式流水线引擎
│   ├── schema-resolver.ts       轻量 JSON Schema 校验
│   ├── tool-runner.ts           代码侧工具执行器
│   ├── parallel.ts              并发执行器
│   ├── keepalive.ts             长任务心跳
│   ├── reporter.ts              进度上报
│   ├── trace.ts                 链路追踪
│   ├── log.ts                   日志
│   └── paths.ts                 路径解析
└── domains/
    ├── build/                   搭建域（session 引擎）
    │   ├── brain.md             域内意图路由
    │   ├── types.ts             plan.json 类型
    │   ├── helpers.ts           gcpCall / 时间格式化 / plan 预处理
    │   ├── resolve-time.ts      countryTimeRef → 实际时间
    │   ├── setup.ts             Layer 1：建子场景 → 推导时间轴 → 建模块池
    │   ├── data-prep.ts         Layer 2A：选品 / 外层任务（并发）
    │   ├── page-build.ts        Layer 2B：建页面 / 挂模块（并发）
    │   ├── point-material.ts    Layer 2.5：点位素材
    │   ├── schedules.ts         Layer 3：排期写入 + 预发布
    │   ├── executor.ts          分层编排 + 选品兜底
    │   ├── skills/              init / query / fix 三个 skill
    │   └── schemas/             plan.schema.json
    ├── qa/                      答疑域（session 引擎，单 skill，只读）
    └── gop/                     投放域（pipeline 引擎）
        ├── agents/              5 个 Agent 提示词
        ├── pipelines/           2 条 YAML 流水线
        └── schemas/             5 个 JSON Schema
```

---

## 两种执行引擎

### session 引擎（命令式）

```
用户输入
   ↓
Catalog 路由 → build
   ↓
brain.md 路由 → init
   ↓
init/spec.md 产出 plan.json ──schema 校验──┐
                                            ↓
                                   executor 分层执行（代码并发）
                                            ↓
                                   init/review.md 只读审查
```

即 **Plan（模型）→ Execute（代码并发）→ Review（模型只读审查）** 三阶段。

适合「一次决策 + 一次批量写入」的场景。审查阶段与执行解耦：它只看结果，不复用执行路径，因此不会因为执行失败而失效。

### pipeline 引擎（声明式）

```yaml
steps:
  - name: plan
    agent: agents/deployment-planner.md
    schema: schemas/deployment-plan.schema.json
    output: deployment_plan
  - name: style
    agent: agents/style-builder.md
    input: deployment_plan
    schema: schemas/style-results.schema.json
    output: style_results
```

每步的产物由 JSON Schema 校验，通过后写入 `context[step.output]` 传给下一步；校验不过直接中断，不会把脏数据带到下游。

适合「多阶段、每阶段有明确契约」的场景。

---

## 关键设计约束

这些约束是整个框架的骨架，改动前请先读 [`docs/architecture.md`](docs/architecture.md)。

1. **模型不产出时间值**
   `phases` / `offlineTime` / `expireTime` / 素材起止时间全部由 executor 从 `countryTimeRef` 推导。模型给出引用即可。
2. **版本由代码匹配**
   `floorSetting.template` 只需给 `name`，`version` 由 executor 从模块池自动匹配。模型不猜版本号。
3. **工具白名单双重约束**
   System Prompt 里的工具表 + 代码侧的 `allowedTools`，两边同时生效。
4. **缺失项由代码补齐**
   缺失的 locale / theme 排期由 executor 自动注入（空 `contentData`），模型不编造。
5. **路由失败往安全侧兜底**
   Catalog 路由失败或返回非法值时兜底到只读域 `qa`。
6. **计划与执行分离**
   计划是纯数据（可校验、可 diff、可人工审阅）；执行是纯代码（可重试、可幂等、可并发）。

---

## 配置

见 [`.env.example`](.env.example) 与 [`docs/configuration.md`](docs/configuration.md)。

| 变量 | 说明 |
|---|---|
| `LLM_PROVIDER` | `anthropic` / `openai` / `dashscope` |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `DASHSCOPE_API_KEY` | 对应 Provider 的密钥 |
| `LLM_TIMEOUT_MS` / `LLM_MAX_TOKENS` / `LLM_TEMPERATURE` | 通用调参 |
| `DAH_DOMAIN` | 强制指定域，等价于 `--domain=` |
| `DAH_RUNS_ROOT` | 运行产物根目录，默认 `./.runs` |
| `DAH_LOG_LEVEL` | `debug` / `info` / `warn` / `error` |
| `USER_INPUT` | 沙箱模式下由外部注入的用户输入 |

MCP 服务的 Token 一律通过 `{{ENV_VAR}}` 占位符注入，不硬编码在源码或配置文件里。

---

## 接入自己的平台

1. 改 `src/domains/<域>/mcp.json`，把 URL 指向你自己的 MCP 服务
2. 改 `src/orchestrator.ts` 的 `QUERY_ALLOWED_TOOLS`，按你的工具清单逐条列出
3. 改 `src/prompts/catalog.md`，声明你的域与路由规则
4. 改 `src/domains/build/helpers.ts` 的 `PLATFORM_SERVER`，对齐 MCP 服务名
5. 按需改 `src/domains/build/*.ts` 里的工具名与分层逻辑

新增一个域：在 `src/domains/` 下建目录 → 补 `mcp.json` → 在 `DOMAIN_META` / `DOMAIN_CONFIGS` 注册 → 写 `brain.md` 与 `skills/*/spec.md`（session 引擎）或 `pipelines/*.yaml`（pipeline 引擎）。

---

## 开发

```bash
npm run typecheck   # 类型检查
npm test            # 单元测试（node:test，无网络依赖）
npm run build       # 编译 + 复制域资产到 dist/
```

测试全部离线运行，不依赖任何外部服务或 API Key。

---

## 文档

| 文档 | 内容 |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | 三阶段模型、设计理念、性能对比、扩展点 |
| [`docs/plan-json-schema.md`](docs/plan-json-schema.md) | plan.json 结构规范与 Executor 分层 |
| [`docs/pipeline.md`](docs/pipeline.md) | YAML 流水线规范与 Schema 契约 |
| [`docs/configuration.md`](docs/configuration.md) | 全部环境变量与 MCP 配置 |
| [`docs/domains.md`](docs/domains.md) | 三个内置域的职责边界与工具清单 |

---

## 贡献

欢迎 PR。详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## License

[Apache-2.0](LICENSE)

## 致谢

本项目脱胎自一个内部多域 Agent Harness 的实战沉淀，开源版本在保留完整设计的同时，
把内网地址、内部标识与平台专有名词全部替换为通用可配置项。
