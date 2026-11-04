# 规划评测

换模型、改 prompt、改知识库之后，计划是变好还是变坏？`npm run eval` 回答这个问题。

## 怎么跑

```bash
npm run eval                              # 剧本模型（基线，应为 100%）
EVAL_REAL_LLM=1 npm run eval              # 用 .env 里的真模型（如本地 Ollama / Qwen）
npm run eval -- mega-br-4 brand-nike-br   # 只跑指定用例
EVAL_MIN_SCORE=0.9 npm run eval           # 平均分低于 90% 时退出码 1，可接 CI
```

每条用例只跑规划阶段（`DAH_PLAN_ONLY=1`）：模型读知识库、产出 `plan.json`，不执行、不写平台。
报告写到运行目录下的 `eval-report.json`。

## 期望从哪来

| 来源 | 内容 |
|---|---|
| 用例金标 `evals/plan-cases.json` | 需求里能确定的事实：国家、档期引用、页面清单、每页对应的页面知识、类目 / 品牌、点位 |
| 知识库现读 | 每页该有的楼层（必选 + 类目命中的可选）、隐藏状态、哪些楼层要排期、选品提示怎么写、哪些是人工待办 |

楼层层面的期望全部现读知识库，改楼层表不用改用例；用例只在需求本身变化时才动。

## 检查项

| id | 查什么 |
|---|---|
| `schema` | 过 `plan.schema.json` |
| `no-time` | 计划里没有任何时间值（`countryTimeRef` 除外） |
| `nation` / `nation-note` | 国家正确；用户没给国家时不得默认，且在 `notes` 里提示确认 |
| `time-ref` | `countryTimeRef` 正确 |
| `pages` | 页面清单不缺、不多、不重复 |
| `knowledge` | 每页 `knowledge` 指向正确的页面知识 |
| `required-floors` / `no-extra-floors` | 楼层与知识库一致 |
| `hidden` | 隐藏状态与知识库一致 |
| `schedules` / `schedule-content` | selection / strategy 楼层有排期，且选品提示、策略写对 |
| `manual` | 人工楼层没写排期，且记了 `manualTodos` |
| `points` | 点位与活动定义一致 |

用例分 = 通过项 / 总项；汇总里有每个检查项的通过率，能直接看出是哪类能力退化。

## 和验收的区别

验收（`acceptance.ts`）在执行后核对**平台真实状态**；评测在执行前核对**计划本身**，不需要平台，几秒跑完，适合每次改动都跑。

## 第一次跑就发现的问题

基线剧本规划师有两处违反知识库：用户没给国家时默认成 BR（`campaign.md` 要求不要默认）；
需求带年份（「2027 年 618」）时把年份当成活动标识，档期引用写成 `br-2027-2027`。两处均已修。
