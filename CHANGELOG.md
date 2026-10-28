# Changelog

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.1.0] - 2026-10-28

首个开源版本。脱胎自一个内部多域 Agent Harness 的实战沉淀，
保留完整设计的同时，把内网地址、内部标识与平台专有名词全部替换为通用可配置项。

### 新增

- **双执行引擎**
  - `session`：命令式，单次 LLM 会话 + 域内 skill 路由
  - `pipeline`：声明式，YAML 多 Agent 流水线 + JSON Schema 契约
- **统一域路由 Catalog**
  - `src/prompts/catalog.md` 描述所有域，一次轻量 LLM 调用完成路由
  - 路由失败 / 返回非法值时兜底到只读域 `qa`
- **三个内置域**
  - `build`：搭建域，产出 `plan.json`，由 executor 分层并发执行
  - `qa`：答疑域，单 skill，纯只读，代码侧显式拒绝批量执行
  - `gop`：投放域，5 个 Agent + 2 条流水线 + 5 个 Schema
- **build 域 Executor 六层拆分**
  - Layer 1 `setup.ts` —— 建子场景 → 推导时间轴 → 建模块池
  - Layer 2A `data-prep.ts` —— 选品 / 外层任务（并发）
  - Layer 2B `page-build.ts` —— 建页面 / 挂模块 / 隐藏模块（并发）
  - Layer 2.5 `point-material.ts` —— 点位素材
  - Layer 3 `schedules.ts` —— 排期写入 + 预发布
  - `resolve-time.ts` —— `countryTimeRef` → 实际时间分区
- **运行时基础设施**
  - `mcp-client.ts` —— MCP 客户端池，Streamable HTTP，失败自动重试 + 会话重建
  - `sdk-client.ts` —— 模型 ↔ 工具闭环，工具轮数上限保护
  - `llm.ts` —— Provider 无关的 LLM 客户端
  - `https-client.ts` —— POST + SSE 流式 POST（兼容 OpenAI 与 DashScope 两种增量格式）
  - `parallel.ts` —— 带并发上限的并发执行器
  - `schema-resolver.ts` —— 零依赖的轻量 JSON Schema 校验
  - `keepalive.ts` / `reporter.ts` / `trace.ts` —— 心跳、进度上报、链路追踪
- **约束固化在代码里**
  - 模型不产出时间值，时间由 executor 从 `countryTimeRef` 推导
  - `template.version` 由模块池自动匹配
  - 缺失的 locale / theme 排期由 executor 自动注入
  - 工具白名单在提示词侧与代码侧双重约束
- **工程**
  - 60 个离线单元测试，覆盖路由、schema、流水线、并发器、build 域纯函数
  - GitHub Actions CI：类型检查 / 测试 / 构建 / 产物校验 / 内网地址与密钥扫描
  - 完整中文文档：`docs/architecture.md`、`plan-json-schema.md`、`pipeline.md`、`configuration.md`、`domains.md`

[0.1.0]: https://github.com/XingMXTeam/domain-agent-harness/releases/tag/v0.1.0
