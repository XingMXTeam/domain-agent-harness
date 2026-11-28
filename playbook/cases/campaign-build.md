# 案例拆解：活动搭建与投放（L2 + L1 双引擎 · `scaffolds/plan-execute`）

> 代码位置：[scaffolds/plan-execute/](../../scaffolds/plan-execute/README.md)
> 判定级别：**路由积木 + L2（`build` 搭建域 / `qa` 只读域）+ L1（`gop` YAML 声明式投放域）**。

## 一、为什么把「搭建」做成 L2，把「投放」做成 L1？

这是同一个多域业务中**按确定性分层共存**的教科书样本：

1. **跨域入口（路由积木）**：
   [orchestrator.ts](../../scaffolds/plan-execute/src/orchestrator.ts) 的 `catalogRoute` 用一次轻量 LLM 调用判定请求属于 `build`、`qa` 还是 `gop`；任何解析异常或非法值一律 fail-closed 兜底到只读域 `qa`（**C5**）。
2. **`build` 搭建域（L2：模型出计划 → 代码并发执行 → 代码验收 + 只读审查）**：
   - 痛点：32 个活动页面 × 约 10 个楼层 = 300+ 次写接口调用，让模型逐一调工具耗时 60–120 分钟且极易漏字段、编时间戳、猜组件版本。
   - 解法：规划师只读知识库（L0→L1→L2 目录导航）输出一份过 `plan.schema.json` 的纯数据 `plan.json`（**C3**）；执行器 `executor.ts` 分层并发调用 MCP 写入，时间轴由 `resolve-time.ts` 从 `countryTimeRef` 推导、模板版本由 `page-build.ts` 从模块池匹配（**C1**），耗时压到 **~5–7 分钟**；执行完先由 `acceptance.ts` 按 `review-rules.md` 代码核对平台状态，再由只读 Review 模型解释失败原因且不能改判（**C4**）。
3. **`gop` 投放域（L1：YAML 声明式多步流水线）**：
   - 步骤可提前画清：`deployment.pipeline.yaml`（`plan` → `foreach` 楼层并发 4 跑子流水线 `style → schedule → publish` → `review`）。
   - 每步产物过 JSON Schema 校验并落盘 `state.json` 与 `artifacts/<stepId>.json`（**C9**），业务侧调整步骤只需改 YAML 并可审计 diff。
4. **`qa` 答疑域（只读安全边界）**：
   - 单 skill 跳过域内 `brain.md` 路由，工具受 `QUERY_ALLOWED_TOOLS` 与 Prompt 双重白名单限制（**C2**），`qa/executor.ts` 显式抛错拒绝任何批量执行（**C5**）。

## 二、什么时候直接拷这个脚手架起步？

- 业务需要**批量写入外部系统**（建活动、配权限、批量上架、批处理配置），且接口参数能抽象成结构化 JSON Schema → 用 `session` 引擎（L2）。
- 业务是**3 步以上的固定多阶段流程**，每阶段契约清晰、常需微调顺序或并发度 → 用 `pipeline` 引擎（L1）。
- 需要**零重型依赖、离线可测、多 LLM Provider 切换** → 直接复用 [scaffolds/plan-execute/](../../scaffolds/plan-execute/README.md)（运行时仅依赖 `yaml`，自带 124 条离线单测与完整 mock 演示环境）。
