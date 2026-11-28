# 案例拆解：VisualStudio（L0 · 增强型 LLM 应用）

> 仓库：`XingMXTeam/VisualStudio`（小红书 / 公众号双图 / 博客全平台封面工作室）
> 判定级别：**L0（增强型 LLM 调用）—— 不是 Agent，而且不该做成 Agent。**

## 一、为什么它不是 Agent？

判定一个系统是不是 Agent，只看一条：**下一步做什么，是由代码决定，还是由模型决定？**

看 `VisualStudio` 的核心源码证据：

1. **风格匹配与 Prompt 组装全由确定性代码完成**：
   `src/lib/templates/prompt-builder.ts` 中，`matchTemplateByTopic(text)` 是纯关键词加权打分（连 LLM 都没调），`assemblePrompt(template, topic, mode, title)` 是确定性字符串模板拼接。
2. **模型只做一次生成**：
   `src/app/api/generate/route.ts` → `src/lib/providers/openai-image.ts` 发起一次图片生成请求（经异步队列与 R2 存储），模型不决定后续路由、不调工具、不循环。
3. **真正的产品壁垒在确定性外围工程**：
   - `src/lib/canvas/composer.ts` & `typography.ts`：客户端 Canvas 2D 精准排版、中英文零截断、公众号 900×383 + 500×500 焦点裁切与纯前端 ZIP 导出。
   - `src/lib/security/`：BYOK 零落库、SSRF 拦截、Turnstile 校验、每日配额与上游失败自动退款。

## 二、常见误区：仓库里有 `.agents/skills/` 就算 Agent 吗？

**不算。** `VisualStudio` 仓库里的 `.agents/skills/` 与 `.harness/` 是 **ShipProof 给「开发它的 Coding Agent」用的（开发时）**，不是用户打开网页生成封面时的运行时逻辑（运行时）。把两者混为一谈，是团队做技术选型时最常见的误判。

## 三、对齐了哪些通用契约？

即使是 L0 应用，生产级交付依然直接受益于 ShipKeel 契约：
- **C1**：尺寸规格（`1080×1440`、`900×383`、`1920×1080`）与排版坐标 100% 由 `PLATFORM_SPECS` 和 Canvas 代码算出，不让生图模型自由发挥像素规格。
- **C8**：本地开发与 CI 有完整本地 fallback 与 Vitest / Playwright 离线单测。
- **C11**：BYOK API Key 严禁落库、严禁进日志或 URL。

## 四、给选型的启发

如果你面对的新需求是「**固定输入 → 模板增强 → 单次文本/生图/生视频调用 → 确定性后处理**」，请果断停在 **L0**，把工程精力花在后处理、安全边界与用户体验上，不要为了「听起来像 Agent」硬加多步循环。
