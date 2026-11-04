# Changelog

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 新增

- **build 域验收（代码判定）**：init 执行后、模型审查前，按 `knowledge/shared/review-rules.md` 的 R1–R5 只读核对平台真实状态（`src/domains/build/acceptance.ts`）
  - 期望值取自知识库楼层表，实际值取自平台；不看执行器自报，也不看计划写了哪些楼层，计划漏楼层同样会被抓到
  - 每条输出 `rule / target / expected / actual / pass`
  - 平台调用走 `READ_TOOLS` 白名单（`page_getList` / `page_listModules` / `schedule_getList`），白名单外的工具名直接抛错、不发请求
  - 验收未通过时整体判为不通过，模型审查不能改判，只负责解释原因、给修复建议
  - 计划没有任何页面标注知识库来源时跳过验收，并在输出里写明「未执行」
  - 测试对齐 `review-rules.md` 的规则表与已实现规则，加规则不写实现会失败
- `plan.json` 新增 `pages[].knowledge`：该页对应的页面知识文件，规划师必填
- 本地假平台新增只读工具 `page_getList`、`schedule_getList`

- **规划评测**（`npm run eval`，详见 `docs/evals.md`）：10 条需求用例，只跑规划阶段给 `plan.json` 打 14 类检查；楼层、隐藏、排期期望现读知识库，改知识库不用改用例。`EVAL_REAL_LLM=1` 评真模型，`EVAL_MIN_SCORE` 接 CI
- `DAH_PLAN_ONLY=1`：只产出计划不执行；init 的 `plan.json` 现在始终写入运行目录

### 修复

- 剧本规划师：用户没给国家时默认成 BR（应写 notes 让人确认）；需求带年份时把年份当活动标识。均由规划评测首次运行发现

- 写排期时没有带页面和楼层（`schedule_update` 载荷缺 `pageName` / `floorName`），排期无法关联到楼层。执行器报「排期 5/5」，但平台上按楼层查不到任何排期；验收的 R2 首次跑就暴露了这个问题

## [0.1.0] - 2026-10-28

首个开源版本。脱胎自一个内部多域 Agent Harness 的实战沉淀，
保留完整设计的同时，把内网地址、内部标识与平台专有名词全部替换为通用可配置项。

### 新增

- **三阶段模型**
  - Plan（模型出计划）→ Execute（代码并发执行）→ Review（模型只读审查）
  - 32 页面场景：模型逐一执行 ~60-120 min，三阶段 ~5-7 min
- **双执行引擎**
  - `session`：命令式，Catalog 路由 + 域内 skill 路由 + 三阶段
  - `pipeline`：声明式，YAML 多 Agent 流水线 + JSON Schema 契约
  - 两条路都保留：默认 session，只有「阶段超过三段且后段消费前段产物」才上 pipeline
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
  - `review.ts` —— Phase 3 只读审查，与执行路径解耦
  - 运行产物落盘 `meta.json`（runId / domain / status / 起止时间）
- **约束固化在代码里**
  - 模型不产出时间值，时间由 executor 从 `countryTimeRef` 推导
  - `template.version` 由模块池自动匹配
  - 缺失的 locale / theme 排期由 executor 自动注入
  - 工具白名单在提示词侧与代码侧双重约束
- **工程**
  - 72 个离线单元测试 + 11 项端到端冒烟检查（本地 mock LLM/MCP，真实 CLI 进程）
  - GitHub Actions CI：类型检查 / 测试 / 构建 / 产物校验 / 内网地址与密钥扫描
  - 完整中文文档：`docs/architecture.md`、`plan-json-schema.md`、`pipeline.md`、`configuration.md`、`domains.md`

[0.1.0]: https://github.com/XingMXTeam/domain-agent-harness/releases/tag/v0.1.0
