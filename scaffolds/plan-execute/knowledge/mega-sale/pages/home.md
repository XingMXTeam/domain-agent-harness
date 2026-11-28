---
level: L2
consumers: [planner, reviewer]
page_type: 首页
---
# 大促首页 · 页面知识

## 楼层结构

| position | component | name | required | scheduling_type | hidden | industries | selection_prompt |
|---|---|---|---|---|---|---|---|
| 1 | banner | 主视觉 | yes | none | no | | |
| 2 | countdown | 倒计时 | yes | none | no | | |
| 3 | coupon | 优惠券 | yes | manual | yes | | |
| 4 | product-feed | 爆款商品流 | yes | selection | no | | 首页爆款，全类目 |
| 5 | brand-wall | 品牌墙 | no | strategy | no | 服饰,美妆 | |

## 字段说明

- `required = yes` 的楼层必须出现；`no` 的楼层只在页面类目命中 `industries`，或用户明确要求时才加。
- `hidden = yes` 表示默认隐藏，预热期由人工打开。
- `scheduling_type` 的动作见 `shared/components.md` 末尾的「排期类型」一节。
