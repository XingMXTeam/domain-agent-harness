---
level: shared
consumers: [reviewer]
---
# 验收规则

| 编号 | 规则 | 怎么查 |
|---|---|---|
| R1 | 每个页面都包含其页面知识里 `required = yes` 的全部楼层 | 列页面模块，对照楼层表 |
| R2 | `scheduling_type = selection` 的楼层都有排期 | 查排期列表 |
| R3 | `scheduling_type = manual` 的楼层没有被自动写排期 | 查排期列表 |
| R4 | `hidden = yes` 的楼层处于隐藏状态 | 列页面模块 |
| R5 | 页面 `offlineTime` 非空 | 查页面 |

每条输出 rule / expected / actual / pass。
