# `@shipkeel/plan-execute`

> ShipKeel **L2（模型出计划 → 代码并发执行 → 代码验收与只读审查）** + **L1（YAML 声明式流水线）** 参考实现。
>
> 在使用本脚手架前，建议先读根目录 [选型决策树](../../playbook/README.md) 与 [通用契约 C1–C11](../../contracts/README.md)。

## 这是什么

把「自然语言需求」变成「可审计、可复现的批量执行」的零重型依赖 TypeScript 参考实现：

- **统一域路由（Catalog）**：一次轻量 LLM 调用判定域，失败自动兜底到只读域 `qa`。
- **双执行引擎**：
  - `session` 引擎（L2，`build` / `qa` 域）：Plan（模型 + JSON Schema）→ Execute（代码分层并发）→ Acceptance（代码核对）→ Review（模型只读解释）。
  - `pipeline` 引擎（L1，`gop` 域）：YAML 声明式多步流水线，支持 `${a.b}`、`when`、`retries`、`foreach + parallel` 与每步 JSON Schema 契约。
- **单运行时依赖**：仅依赖 `yaml`；MCP 客户端、LLM 客户端、JSON Schema 校验器全部自研，测试 100% 离线。

## 快速开始

在仓库根目录执行 `npm install` 后，可在根目录或本目录直接运行：

```bash
# 本地一键演示（无需 API Key、无需外部服务，启动 3 个本地 mock 服务）
npm run demo

# 全量离线验证（typecheck + 单测 + 构建 + 离线 E2E 冒烟）
npm run verify

# 查看可用域
npm run list-domains
```

## 文档

- [架构与三阶段模型](docs/architecture.md)
- [plan.json 规范与执行分层](docs/plan-json-schema.md)
- [YAML 声明式流水线](docs/pipeline.md)
- [知识库结构与只读 MCP](docs/knowledge-base.md)
- [内置域说明](docs/domains.md)
- [配置与环境变量](docs/configuration.md)
- [局部开发约束](AGENTS.md)
