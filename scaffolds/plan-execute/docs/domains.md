# 内置域

三个域覆盖了三类典型需求：**写入型**（build）、**只读型**（qa）、**多阶段型**（gop）。

| 域 | 引擎 | skill | 能写吗 |
|---|---|---|---|
| `build` | session | init / query / fix | 能（init、fix） |
| `qa` | session | query | **不能**，只读 |
| `gop` | pipeline | 5 个 Agent | 能（建样式包、配排期、发布） |

---

## build —— 搭建域

把「创建一个活动会场」拆成计划 + 分层执行。

**skills**

| skill | 触发 | 产出 |
|---|---|---|
| `init` | 创建 / 搭建 / 新建 | `plan.json` → executor 分层执行 |
| `query` | 查询 / 了解 / 检查 | 直接输出 markdown 答案 |
| `fix` | 修复 / 纠错 / 补翻 | 修复动作列表 → 逐条执行 |

**执行分层**见 [plan-json-schema.md](plan-json-schema.md)。

**关键文件**

```
src/domains/build/
├── brain.md              域内意图路由
├── skills/init/spec.md   规划师提示词
├── skills/query/spec.md  只读查询
├── skills/fix/spec.md    修复助手
├── schemas/plan.schema.json
├── mcp.json
├── types.ts helpers.ts resolve-time.ts
└── setup.ts data-prep.ts page-build.ts point-material.ts schedules.ts executor.ts
```

---

## qa —— 答疑域

跨平台只读查询。**单 skill 域** —— Catalog 路由命中后直接进 `query`，跳过 brain routing，省一次 LLM 调用。

**领域模型**

搭建平台：场景 → 子场景 → 页面 → 模块 → 排期
多语言素材平台：场景 → 文案需求 → 翻译 → 发布

**查询模式：先定位再深挖**

1. `childScene_getList` / `scene_getList` —— 定位活动
2. `page_getBasic` + `page_listModules` —— 看页面结构
3. `module_listResourcesAndSchedules` + `schedule_getContent` —— 看排期细节

**只读保证有两层**

1. 提示词侧：工具表里只有只读工具，并明确禁止 create / update / publish / submit
2. 代码侧：`allowedTools` 白名单 + executor 直接抛错拒绝批量执行

`src/domains/qa/executor.ts`：

```ts
export const executor: DomainExecutor = {
  async execute(): Promise<never> {
    throw new Error("QA domain does not support batch execution");
  },
};
```

---

## gop —— 投放域

**pipeline 引擎**。5 个 Agent + 2 条流水线 + 5 个 Schema。

**Agent**

| Agent | 职责 | 可写 |
|---|---|---|
| `deployment-planner.md` | 投放规划师（只读知识库） | 否 |
| `style-builder.md` | 样式包构建器 | 是 |
| `schedule-builder.md` | 排期构建器 | 是 |
| `floor-publisher.md` | 楼层发布器 | 是 |
| `deployment-reviewer.md` | 投放检查员（只读校验） | 否 |

**流水线**

```
deployment.pipeline.yaml         plan → floors（foreach 楼层，并发 4，跑子流水线）→ review
floor-deployment.pipeline.yaml   style → schedule（when 样式包成功）→ publish（when 排期成功）
```

详见 [pipeline.md](pipeline.md)。

---

## 新增一个域

1. 建目录 `src/domains/<新域>/`
2. 写 `mcp.json`，声明你的 MCP 服务
3. **session 引擎**：写 `brain.md` + `skills/<skill>/spec.md`
   **pipeline 引擎**：写 `pipelines/*.yaml` + `agents/*.md` + `schemas/*.json`
4. 在 `src/orchestrator.ts` 注册：

```ts
export const DOMAIN_META: Record<string, DomainMeta> = {
  // ...
  mydomain: { engine: "session" },
};

export const DOMAIN_CONFIGS: Record<string, DomainConfig> = {
  // ...
  mydomain: {
    validSkills: ["query"],
    singleSkill: "query",     // 单 skill 域可省掉 brain routing
    queryAllowedTools: QUERY_ALLOWED_TOOLS,
  },
};
```

5. 在 `src/prompts/catalog.md` 里声明这个域的触发条件与能力，并加进判断规则
6. 加进 `VALID_DOMAINS`

> 注意：`catalog.md` 的判断规则是**严格按顺序匹配**的。新域的规则要放在合适的位置 —— 「创建」类规则要在「投放」类之前，「查询」兜底永远放最后。
