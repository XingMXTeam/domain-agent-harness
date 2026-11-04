---
level: shared
consumers: [planner]
---
# 组件字典

| 组件 | 用途 | 限制 |
|---|---|---|
| banner | 主视觉横幅 | 每页最多 1 个，放第一屏 |
| countdown | 活动倒计时 | 只用于大促首页 |
| coupon | 优惠券楼层 | 券由人工配置，不自动排期 |
| product-feed | 商品流 | 必须有排期，否则前台为空 |
| brand-wall | 品牌墙 | 由策略服务自动填充 |

组件名就是平台模板名。版本号由执行器从模块池匹配，计划里不写。

## 排期类型

| scheduling_type | 含义 | 计划里怎么写 |
|---|---|---|
| none | 无排期 | 只加楼层，不写排期 |
| selection | 需要选品 | 在 `schedules` 加一条，`contentData.selectionPrompt` 填楼层的 `selection_prompt` |
| strategy | 策略驱动 | 在 `schedules` 加一条，`contentData.strategy` 填 `auto` |
| manual | 人工配置 | 不写排期，在 `manualTodos` 记一条待办 |
