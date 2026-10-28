# 声明式流水线

pipeline 引擎用于「多阶段、每阶段有明确契约」的场景，比如投放：规划 → 建样式包 → 配排期 → 发布 → 校验。

---

## 流水线定义

位置：`src/domains/<域>/pipelines/<名字>.pipeline.yaml`

```yaml
name: deployment
description: 投放主流程：规划 → 建样式包 → 建排期 → 发布 → 校验

steps:
  - name: plan
    agent: agents/deployment-planner.md
    schema: schemas/deployment-plan.schema.json
    output: deployment_plan
    description: 只读知识库，产出投放计划

  - name: style
    agent: agents/style-builder.md
    input: deployment_plan
    schema: schemas/style-results.schema.json
    output: style_results
```

## step 字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | ✅ | 步骤名，用作日志标签与产物文件名 |
| `agent` | ✅ | Agent 提示词文件路径（相对域目录） |
| `output` | ✅ | 本步产物写入 `context` 的键 |
| `input` | | 消费上一步的哪个产物；不填则消费 `user_prompt` |
| `schema` | | 产物 JSON Schema（相对域目录），校验不过直接中断 |
| `foreach` | | 对 `context[foreach]` 做数组展开，逐项执行本步 |
| `description` | | 人类可读说明 |

## 上下文传递

```
context = { user_prompt: <原始输入> }

step.plan   → context.deployment_plan
step.style  input=deployment_plan  → context.style_results
step.review input=publish_results  → context.deployment_report
```

`step.output` 就是产物在 `context` 里的键。下游用 `step.input` 引用它。

## Schema 契约

每个 step 都可以声明 `schema`，产物必须通过校验：

```json
{
  "type": "object",
  "required": ["results"],
  "properties": {
    "results": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["floorName", "success"],
        "properties": {
          "floorName": { "type": "string" },
          "success": { "type": "boolean" }
        }
      }
    }
  }
}
```

校验不通过 → 抛错中断流水线，**不会**把不合规的产物传给下游。

校验器支持：`type` / `properties` / `required` / `items` / `enum` / `additionalProperties` / `minimum` / `maximum` / `pattern`。

## foreach 展开

```yaml
- name: deploy-floor
  agent: agents/floor-publisher.md
  foreach: floors
  output: deploy_results
```

如果 `context.floors` 是数组，这一步会对每个元素各跑一次 Agent，结果汇总成数组写进 `context.deploy_results`。

## 内置的 gop 域流水线

### 主流水线 `deployment.pipeline.yaml`

```
plan → style → schedule → publish → review
```

| step | Agent | 职责 |
|---|---|---|
| plan | `deployment-planner.md` | 只读知识库，产出投放计划 |
| style | `style-builder.md` | 为每个楼层创建样式包 |
| schedule | `schedule-builder.md` | 为楼层配置排期 |
| publish | `floor-publisher.md` | 发布楼层 |
| review | `deployment-reviewer.md` | 只读校验投放结果 |

### 子流水线 `floor-deployment.pipeline.yaml`

```
schedule → publish
```

单楼层投放流程，可被主流水线按楼层 foreach 展开。

## 写一个新流水线

1. 在 `src/domains/<域>/pipelines/` 建 YAML
2. 在 `src/domains/<域>/agents/` 写对应的 Agent 提示词
   - Agent 提示词里**必须**写明输出格式（只输出 JSON）
3. 在 `src/domains/<域>/schemas/` 写产物的 JSON Schema
4. 在 `src/orchestrator.ts` 的 `DOMAIN_META` 里把该域标记为 `engine: "pipeline"`

主文件名固定为 `deployment.pipeline.yaml`（引擎按这个名字加载），需要别的名字请改 `src/runtime/pipeline-engine.ts` 的 `pipelinePath`。
