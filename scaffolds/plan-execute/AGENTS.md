# AGENTS.md — `@shipkeel/plan-execute`（L2 脚手架局部约束）

> 本文件承接 L2（Plan-Execute-Review + YAML 声明式流水线）参考实现的**局部约束**。全仓通用契约 C1–C11 与 ShipProof 协议见根目录 [AGENTS.md](../../AGENTS.md)。

## 依赖预算

- 运行时只允许依赖 `yaml`。不要在本子包引入新的运行时依赖（TypeScript / tsx / `@types/node` 由根 workspace 统一提供）。

## 常用命令（本目录或根目录均可运行）

```bash
npm run typecheck   # tsc --noEmit
npm test            # node:test，全部离线
npm run build       # tsc + 复制域资产到 dist/
npm run smoke       # 离线 E2E 冒烟（mock LLM + mock MCP）
npm run list-domains
```

## 本脚手架不可破坏的局部约束

1. **模型不产出时间值（落实 C1）**
   `phases` / `offlineTime` / `expireTime` / 素材起止时间一律由 executor 从 `countryTimeRef` 推导。新增提示词字段时，不要加任何让模型填时间的字段。
2. **版本由代码匹配（落实 C1）**
   `floorSetting.template.version` 由模块池自动匹配。提示词里不要要求模型写版本号。
3. **工具白名单双重约束（落实 C2）**
   `src/orchestrator.ts` 的 `QUERY_ALLOWED_TOOLS`（代码侧，硬约束）与 `src/domains/<域>/skills/query/spec.md` 的工具表（提示词侧，软引导）两边必须同步。
4. **计划与执行分离（落实 C3）**
   计划是纯数据（必须过 JSON Schema），执行是纯代码（可并发、可重试）。不要在 executor 里塞模型调用，也不要在 executor 里直接 `await` 平台接口而跳过 `gcpCall` 封装。
5. **只读域必须只读（落实 C5）**
   `src/domains/qa/executor.ts` 显式抛错拒绝批量执行。不要给它加写入能力。
6. **路由失败往安全侧兜底（落实 C5）**
   Catalog 兜底到只读域 `qa`，不是创建域。

## 目录约定

```text
src/runtime/    基础设施：MCP、LLM、会话、流水线、并发、追踪、日志
src/domains/    业务域：每个域自带 mcp.json / brain.md / skills / schemas / pipelines
src/prompts/    跨域提示词（catalog.md）
docs/           本脚手架运行与设计文档
knowledge/      示例知识库（L0 / L1 / L2）
test/           node:test 单测，全部离线
```

域内的东西不要往 `src/runtime/` 放；基础设施不要往 `src/domains/` 放。日志用 `src/runtime/log.ts`，不要用 `console.log`（stdout 留给最终答案）。
