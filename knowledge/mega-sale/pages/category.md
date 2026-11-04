---
level: L2
consumers: [planner, reviewer]
page_type: 类目会场
---
# 大促类目会场 · 页面知识

## 楼层结构

| position | component | name | required | scheduling_type | hidden | industries | selection_prompt |
|---|---|---|---|---|---|---|---|
| 1 | banner | 类目主视觉 | yes | none | no | | |
| 2 | product-feed | 类目爆款 | yes | selection | no | | {类目}会场爆款 |
| 3 | coupon | 类目券 | no | manual | yes | 3C数码,家居 | |
| 4 | brand-wall | 类目品牌墙 | no | strategy | no | 服饰,美妆,运动 | |

## 字段说明

- `{类目}` 在生成计划时替换成页面所属类目，例如 `服饰会场爆款`。
- 其余字段含义同首页。
