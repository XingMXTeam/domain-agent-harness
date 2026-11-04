# 声明式流水线

pipeline 引擎用于「多阶段、每阶段有明确契约」的场景，比如投放：规划 → 按楼层投放 → 校验。

一句话：**提示词即配置、YAML 即编排、Schema 即契约**。新增 Agent、流程、契约都不用改引擎代码。

---

## 流水线定义

位置：`src/domains/<域>/pipelines/<名字>.pipeline.yaml`

```yaml
name: deployment
description: 投放主流程

steps:
  - id: plan
    agent: agents/deployment-planner.md
    input: ${user_prompt}
    output: deployment_plan
    retries: 1

  - id: floors
    foreach: ${deployment_plan.floors}
    parallel: 4
    pipeline: pipelines/floor-deployment.pipeline.yaml
    input:
      floor: ${item}
      activity: ${deployment_plan.activity}
    output: floor_results

  - id: review
    agent: agents/deployment-reviewer.md
    when: ${floor_results}
    input: { plan: "${deployment_plan}", floors: "${floor_results}" }
    output: deployment_report
```

## 步骤字段

| 字段 | 说明 |
|---|---|
| `id` | 步骤 ID，同一条流水线内唯一。用于日志、`state.json`、产物文件名。旧写法 `name` 仍可用 |
| `agent` | Agent 提示词文件（相对域目录）。与 `pipeline` **二选一** |
| `pipeline` | 子流水线文件（相对域目录）。与 `agent` **二选一** |
| `input` | 输入：表达式、带表达式的对象。agent 步骤不写时为 `${user_prompt}` |
| `output` | 产物写入作用域的键，不写则用 `id` |
| `when` | 条件表达式，结果为假则跳过（`skipped`） |
| `retries` | 失败重试次数，默认 0 |
| `foreach` | 对数组逐项执行本步；项在作用域里叫 `item`，下标叫 `index` |
| `parallel` | foreach 的并发数，默认 1（顺序）。只能和 `foreach` 一起用 |
| `schema` | 产物 JSON Schema（相对域目录）。优先于 Agent frontmatter 的 `outputSchema` |
| `description` | 人类可读说明 |

加载时会校验：`steps` 非空、`id` 唯一、`agent` / `pipeline` 恰好一个、`parallel` ≥ 1、`retries` ≥ 0、`parallel` 必须配 `foreach`。

流水线本身可以写 `output`（表达式或带表达式的对象）声明它的产物；不写则为最后一个执行的步骤的产物。

## 表达式

只支持点号路径，刻意不做图灵完备，不用 `eval`。

| 写法 | 结果 |
|---|---|
| `${plan.pages}` | 整串是单个表达式 → 原始值（数组 / 对象保持不变） |
| `${plan.pages.0.name}` | 数字段即数组下标 |
| `"页面 ${item.name} 已建好"` | 嵌在字符串里 → 文本替换，对象转 JSON，取不到替换为空串 |
| `{ page: "${item}" }` | 对象 / 数组递归解析 |

作用域 = `user_prompt` + 已完成步骤的产物（按 `output` 键）+ foreach 的 `item` / `index` + 子流水线收到的 `input`。

**兼容旧写法**：`input` / `foreach` 写一个不带 `${}` 的键名，等价于 `${键名}`。

## when

真值规则：`undefined`、`null`、`false`、`0`、空串、`"false"`、`"0"`、空数组、空对象为假，其余为真。

典型用法是上游失败就别做下游：

```yaml
- id: schedule
  agent: agents/schedule-builder.md
  when: ${style.results.0.success}
```

## retries

只在这三种情况重试：模型调用失败、输出解析不出 JSON、产物不符合 schema。

配置错误（文件不存在、foreach 不是数组）和表达式写错**不重试**，重试也没用。

**写接口的步骤不要设 retries**：Agent 已经调用过写接口、只是输出格式错了时，重试会重复写入。只读步骤（规划、审查）可以放心设 1。

## foreach 与 parallel

- `parallel: N` 就是 N 个 worker 抢任务，输出数组按输入顺序排列。
- **fail-fast**：任一项失败后不再派发新项，已在跑的项跑完，然后整步失败。
- 每一项的状态单独记录：`floors[0]`、`floors[1]`……

## 子流水线

```yaml
- id: floors
  foreach: ${deployment_plan.floors}
  pipeline: pipelines/floor-deployment.pipeline.yaml
  input: { floor: "${item}", activity: "${deployment_plan.activity}" }
```

子流水线的作用域 = 父作用域 + 本步 `input`（对象时展开成顶层键，其他值放在 `input` 键下）。子步骤的 ID 带前缀：`floors[0]/style`。嵌套超过 8 层会报错，用来拦住循环引用。

## Agent frontmatter

Agent 提示词文件可以带 YAML frontmatter，正文原样作为 system prompt：

```markdown
---
allowedTools:
  - mcp__knowledge__kb_read
maxTurns: 12
outputSchema: deployment-plan.schema.json
---
# 投放规划师
...
```

| 字段 | 说明 |
|---|---|
| `allowedTools` | 本 Agent 可见、可调用的工具白名单；不写不限制 |
| `maxTurns` | 最大工具轮数；不写用会话默认（30） |
| `outputSchema` | 输出 schema 文件名（在域的 `schemas/` 下找），步骤没写 `schema` 时用它 |

schema 优先级：步骤的 `schema` > Agent 的 `outputSchema` > 不校验。

## 运行产物

```
runs/<runId>/
├── state.json                 流水线与每一步的 status / attempts / 起止时间 / error
├── artifacts/<stepId>.json    每个成功步骤的产物（ID 里的特殊字符换成 _）
├── trace.jsonl                事件流：pipeline.step / pipeline.skip / pipeline.attempt_failed / ...
└── sessions/<label>.json      每次模型会话的完整记录
```

`state.json` 每次变更同步写盘，进程中途退出也能看出跑到哪一步。排查失败：

```bash
jq '.status, .errors' runs/<id>/state.json                          # 哪一步失败、为什么
jq '.steps | to_entries[] | select(.value.attempts > 1)' runs/<id>/state.json   # 哪些步骤重试过
jq . runs/<id>/artifacts/plan.json                                  # 看某一步的产物
```

## Schema 契约

产物必须通过 schema 校验，否则按 `retries` 重试，用完仍不通过就中断流水线，**不会**把不合规的产物传给下游。

校验器支持：`type` / `properties` / `required` / `items` / `enum` / `additionalProperties` / `minimum` / `maximum` / `pattern`。

## 内置的 gop 域流水线

### 主流水线 `deployment.pipeline.yaml`

```
plan ──► floors（foreach 楼层，并发 4）──► review（有楼层结果才跑）
            └─ 每个楼层：floor-deployment 子流水线
```

| step | 类型 | 职责 |
|---|---|---|
| plan | `deployment-planner.md` | 只读知识库，产出投放计划（retries: 1） |
| floors | 子流水线 × 楼层数 | 每个楼层独立投放 |
| review | `deployment-reviewer.md` | 只读校验投放结果（retries: 1） |

### 子流水线 `floor-deployment.pipeline.yaml`

```
style ──► schedule（样式包成功才跑）──► publish（排期成功才跑）
```

产物是 `{ floorName, style, schedule, publish }`，没执行的步骤为空。一个楼层的样式包失败只会跳过它自己的排期和发布，不影响其他楼层。

## 反模式

- 在 `input` 里塞逻辑：表达式只取值，判断写在 `when`，计算交给 Agent 或代码
- 关键步骤省略 schema：下游拿到格式漂移的数据会静默出错
- 给写接口步骤设 retries：可能重复写入
- `retries` 设很大：模型连续三次输出不合规，通常是提示词或 schema 的问题
- 在提示词里写死资源 ID：让 Agent 按目录或名称去查

## 写一个新流水线

1. 在 `src/domains/<域>/pipelines/` 建 YAML
2. 在 `src/domains/<域>/agents/` 写 Agent 提示词，必须写明只输出 JSON；需要时加 frontmatter
3. 在 `src/domains/<域>/schemas/` 写产物的 JSON Schema
4. 在 `src/orchestrator.ts` 的 `DOMAIN_META` 里把该域标记为 `engine: "pipeline"`

主文件名默认是 `pipelines/deployment.pipeline.yaml`，`executePipeline` 的 `pipelineFile` 选项可以换成别的文件。
