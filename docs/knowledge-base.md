# 知识库

规划阶段的业务知识（活动有哪些页面、页面有哪些楼层、楼层要不要排期）不写在提示词里，而是放在一个 Markdown 知识库中，由模型通过 MCP 按目录逐层读取。

## 为什么这样做

- **知识和提示词分开**：改页面结构只改知识库，不改 `spec.md`，也不改代码。
- **按目录导航，不做向量检索**：Agent 先读总览，再按目录名和文件名往下找。路径即契约，结果可复现，排查时能看到它读了哪几篇。
- **字段驱动动作**：楼层表里的 `scheduling_type` 直接决定计划里怎么写，模型只做翻译，不做猜测。
- **只读**：规划阶段的工具白名单只有知识库和模板库的只读工具，写接口一律调不到。

## 三层结构

```
knowledge/
├── README.md                     L0 总览：活动类型 → 目录
├── mega-sale/                    大促
│   ├── campaign.md               L1 活动定义：国家、档期引用、页面清单、点位
│   └── pages/
│       ├── home.md               L2 首页楼层结构
│       └── category.md           L2 类目会场楼层结构
├── brand-day/                    品牌日
│   ├── campaign.md
│   └── pages/brand-home.md
└── shared/
    ├── components.md             组件字典 + 排期类型
    └── review-rules.md           验收规则（审查阶段用）
```

每篇文档开头用 frontmatter 标注层级和消费者：

```markdown
---
level: L2
consumers: [planner, reviewer]
---
```

`consumers` 不含当前角色的文档不用读。

## 楼层表

L2 页面知识里的楼层表是规划的核心输入：

| 列 | 含义 |
|---|---|
| `position` | 楼层顺序 |
| `component` | 组件名（即平台模板名，不带版本） |
| `name` | 楼层的业务名 |
| `required` | `yes` 必须出现；`no` 只在类目命中 `industries` 或用户要求时出现 |
| `scheduling_type` | `none` / `selection` / `strategy` / `manual` |
| `hidden` | `yes` 表示默认隐藏 |
| `industries` | 可选楼层适用的类目，逗号分隔 |
| `selection_prompt` | 选品楼层的选品描述，可含 `{类目}` / `{品牌}` 占位 |

`scheduling_type` 到计划的映射：

| 值 | 计划里写成 |
|---|---|
| `none` | 只加楼层 |
| `selection` | `schedules[]` 一条，`contentData.selectionPrompt` |
| `strategy` | `schedules[]` 一条，`contentData.strategy = "auto"` |
| `manual` | 不写排期，`manualTodos[]` 记一条待办，执行结果里列出 |

## MCP 服务

`scripts/knowledge-mcp.mjs` 把任意 Markdown 目录暴露成三个只读工具（Streamable HTTP）：

| 工具 | 入参 | 说明 |
|---|---|---|
| `kb_list` | `path?` | 列出子目录和文档，带 `level` / `consumers` / 标题 |
| `kb_read` | `path` | 读取文档全文 |
| `kb_search` | `query`, `limit?` | 关键词搜索，返回命中行；只作辅助 |

路径限制在知识库根目录内，只能读 `.md` 文件。

```bash
npm run kb:mcp                              # 读 ./knowledge，端口 7803
KB_DIR=/path/to/your-kb PORT=7803 npm run kb:mcp
```

build / gop 域的 `mcp.json` 通过 `KM_MCP_URL` 指向它，默认 `http://127.0.0.1:7803/mcp`。换成自己的知识库服务时，只要提供同名的三个工具即可。

## 规划阶段的工具约束

`skills/<skill>/spec.md` 支持可选的 YAML frontmatter：

```markdown
---
allowedTools:
  - mcp__knowledge__kb_list
  - mcp__knowledge__kb_read
  - mcp__knowledge__kb_search
  - mcp__platform__modulePool_getModulesWithTemplate
maxTurns: 12
---
# 活动搭建规划师
...
```

- `allowedTools`：本次会话可见、可调用的工具；不写则不限制
- `maxTurns`：最大工具轮数；不写用会话默认上限（30）

frontmatter 会从 system prompt 里去掉，正文原样发给模型。

## 写自己的知识库

1. 照 `knowledge/` 的结构建目录：一个总览、每种活动类型一个目录、每种页面类型一个文件。
2. 一个页面类型的所有楼层放在同一个文件里，类目差异用 `industries` 列表达，不要按类目拆文件。
3. 楼层表的组件名必须出现在 `shared/components.md`。
4. 跑 `npm test`，`knowledge-base.test.ts` 会检查页面清单引用的文件都存在、组件都在字典里、选品楼层都有 `selection_prompt`。

示例知识库是为演示虚构的通用领域模型，不对应任何真实平台。
