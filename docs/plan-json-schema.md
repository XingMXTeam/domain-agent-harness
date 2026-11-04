# plan.json 结构规范

`plan.json` 是 **build 域**的结构化执行计划。它由模型产出，由 `executor` 分层落地。

**一句话原则：模型只描述「要什么」，绝不描述「什么时候」。**

---

## 结构

```json
{
  "setup": {
    "childScene": {
      "name": "618 大促",
      "nations": "BR",
      "countryTimeRef": { "id": "br-618-2026" }
    },
    "initModulePool": true
  },
  "pages": [
    {
      "name": "首页",
      "nations": "BR",
      "floors": [
        {
          "name": "首屏 Banner",
          "template": { "name": "banner" },
          "floorSetting": { "height": 200 },
          "hidden": false,
          "schedules": [
            {
              "name": "banner-main",
              "nations": ["BR"],
              "dataSourceType": "datapool",
              "contentData": {}
            }
          ]
        }
      ]
    }
  ],
  "points": [{ "name": "首屏浮层" }]
}
```

完整 Schema 见 [`src/domains/build/schemas/plan.schema.json`](../src/domains/build/schemas/plan.schema.json)。

---

## 关键约束

### 1. 模型不输出任何时间值

`phases`、`offlineTime`、`expireTime`、点位素材的 `startTime` / `endTime` —— 这些**一个都不许由模型产出**。

executor 会：

1. 读 `setup.childScene.extendInfo.renderConfig.countryTimeRef`
2. 调 `childScene_getCountryTimeList` 拿到平台真实档期
3. 转成 `activityTime` 分区（teaser 段 + mega 段）
4. 推导 `phases.full` / `phases.teaser`，注入到后续所有调用里

模型只需要给一个引用（`id` 或 `name`）。

### 2. `version` 由代码从模块池匹配

```json
{ "template": { "name": "banner" } }
```

就够了。executor 调 `modulePool_create` 拿到「组件名 → 模板版本列表」，自动取第一个匹配版本填进 `version`。

模型不要写 `version` —— 它猜不准，写错就渲染失败。

### 3. `category` 有默认值，plan 里可以不写

executor 会兜底。

### 4. 缺失的 locale / theme 排期由 executor 注入

executor 先 `schedule_createOrGetList` 读已有排期，发现缺 `locale` 或 `theme` 就补一个空 `contentData`。

模型不要为了「看起来完整」去编造排期内容。

### 5. `nations` 的类型在两处不同

| 位置 | 类型 | 例子 |
|---|---|---|
| `pages[].nations` | **字符串** | `"BR"` |
| `schedules[].nations` | **数组** | `["BR", "MX"]` |

这是平台侧的历史约定，写错 schema 校验会直接拦下。

### 6. 楼层与排期是嵌套的

排期挂在**楼层**下面，不是挂在页面下面：

```
page.floors[].schedules[]
```

---

### 7. 知识库带来的两个字段

规划师按知识库组装计划时会多写两个字段，Executor 不执行它们：

| 字段 | 来源 | 用途 |
|---|---|---|
| `manualTodos[]` | 楼层 `scheduling_type = manual` | `{ pageName, floorName, reason }`，不写排期，执行结果末尾列为「人工待办」 |
| `notes[]` | 知识库缺失或与需求冲突 | 给人看的备注 |

详见 [knowledge-base.md](knowledge-base.md)。

## Executor 分层

```
Layer 1      Setup          childScene_create
                           → resolveCountryTimeRef（推导时间轴）
                           → modulePool_create（组件池）
      ↓
Layer 2A     数据准备（并发） moduleTask / datapool 取数 → outerTaskIds
      ↓
Layer 2B     页面搭建（并发） pageAgent_create → module_addModule → module_showOrHide
      ↓
Layer 2.5    点位素材       point_create → point_addMaterial
      ↓
Layer 3      排期配置       schedule_createOrGetList → schedule_update → stagePrepub
```

Layer 2A / 2B / 2.5 内部都是并发的，失败不扩散：单个楼层失败不影响同层其它楼层。

### 选品失败兜底

选品（`datapool` / `moduleTask`）失败时，executor 会用配置的兜底外层任务 ID 回填，并在结果里标记失败原因，让 Review 阶段能看出来。

兜底 ID 通过 `DAH_MOCK_SELECTION_ID` 配置。

---

## 执行结果

```ts
interface ExecutionResult {
  success: boolean;
  items: Array<{ step: string; target: string; ok: boolean; error?: string }>;
  summary: string;
}
```

`items` 是逐条明细，`step` 取值：`setup` / `data-prep` / `page` / `module` / `point` / `schedules` / `prepub`。

`summary` 是一行人类可读的汇总，例如：

```
页面 3/3，模块 12/13，排期 8/8
```
