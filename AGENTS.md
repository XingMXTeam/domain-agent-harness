# AGENTS.md

> 面向 AI 编码助手的仓库工作说明。人类贡献者请看 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 这是什么

多域 Agent Harness。统一域路由（Catalog）+ 双执行引擎（session / pipeline）。
**模型只出计划，代码负责并发执行。**

## 常用命令

```bash
npm run typecheck   # tsc --noEmit
npm test            # node:test，全部离线
npm run build       # tsc + 复制域资产到 dist/
npm start -- --list-domains
```

改完代码必须跑完这三条再提交。

## 不可破坏的架构约束

违反以下任何一条的改动都会被要求回退：

1. **模型不产出时间值**
   `phases` / `offlineTime` / `expireTime` / 素材起止时间一律由 executor 从 `countryTimeRef` 推导。
   新增提示词字段时，不要加任何让模型填时间的字段。

2. **版本由代码匹配**
   `floorSetting.template.version` 由模块池自动匹配。提示词里不要要求模型写版本号。

3. **工具白名单双重约束**
   `src/orchestrator.ts` 的 `QUERY_ALLOWED_TOOLS`（代码侧，硬约束）
   + `src/domains/<域>/skills/query/spec.md` 的工具表（提示词侧，软引导）
   两边必须同步。只改一边会让模型看到工具却调不到，或调得动却不知道。

4. **计划与执行分离**
   计划是纯数据（必须过 JSON Schema），执行是纯代码（可并发、可重试）。
   不要在 executor 里塞模型调用。

5. **只读域必须只读**
   `src/domains/qa/executor.ts` 显式抛错拒绝批量执行。不要给它加"顺手写一下"的能力。

6. **路由失败往安全侧兜底**
   Catalog 兜底到只读域 `qa`，不是创建域。

## 目录约定

```
src/runtime/    基础设施：MCP、LLM、会话、流水线、并发、追踪、日志
src/domains/    业务域：每个域自带 mcp.json / brain.md / skills / schemas / pipelines
src/prompts/    跨域提示词（目前只有 catalog.md）
docs/           中文文档
test/           node:test 单测，全部离线
```

域内的东西不要往 `runtime/` 放；基础设施不要往 `domains/` 放。

## 写代码时

- TypeScript strict + `noUncheckedIndexedAccess` 开启。数组下标访问要处理 `undefined`。
- 新逻辑优先写成纯函数并配单测。需要 I/O 的部分留注入点（参考 `invokeSession` 的 `options.llm` / `options.pool`）。
- 运行时只允许依赖 `yaml`。不要引入新的运行时依赖。
- 日志用 `runtime/log.ts` 的 `log` / `logError` / `logWarn` / `logDebug`，**不要**用 `console.log`（stdout 留给结构化进度）。
- 中文注释只写在业务语义处；标识符和工具名保持英文。

## 改提示词时

提示词（`*.md`）是路由和行为的控制面，改动等同于改代码：

- 改了工具清单 → 同步改 `QUERY_ALLOWED_TOOLS`
- 改了计划结构 → 同步改 `schemas/*.schema.json` 和对应 executor
- 改了路由规则 → 注意 `catalog.md` 的规则是**严格按顺序匹配**的
- 每个提示词都要写明「只输出 JSON」和输出契约

## 测试要求

新增逻辑必须有对应测试。测试不能依赖网络、API Key 或外部服务。

```
npm test   # 必须 0 失败
```

## 不要做的事

- 不要把密钥、内网地址、公司内部系统名写进源码或配置
- 不要在 `mcp.json` 里写明文 Token（用 `{{ENV_VAR}}` 占位符）
- 不要在 executor 里直接 `await` 平台接口而跳过 `gcpCall` 封装
- 不要把 `dist/` 提交进 git

<!-- frontend-harness:start -->
## Feature work runs under frontend-harness

- For any feature work, first run `fh` (= `fh next`) and do exactly the action it returns.
- Start a feature with `fh new <name>` (or `fh new <name> --prd <file>`); it becomes the current feature.
- When a step is finished, run `fh done` — it records the right thing for the current phase
  (clarify, task, remediation, replan) and rejects work that has not earned it.
- Never edit `.harness/tasks/*/state.json` by hand, and never declare a feature done yourself:
  only a passing `fh eval` plus the delivery gate can set done.
- "Tests pass" is evidence only as a recorded `fh verify` run; cite its ids, never describe a run.
- After a feature is done, run `fh learn` and show the user any proposal; adopt only with their yes.
- Ask the user only at the clarify confirmation and when the harness pauses.
<!-- frontend-harness:end -->
