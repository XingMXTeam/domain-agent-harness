# 通用契约细则与确定性检查方法（C1–C11）

> 每一条契约都来自真实项目里踩过的坑（`plan-execute` 搭建/投放、`Atoms` 应用生成、`finance` 财报解析、`VisualStudio` 封面生成），且每一条都必须能被**脚本、单测或 CI 门禁**机械校验，而不是口头倡议。

---

## C1：确定性的值由代码推导，模型不产出

- **规则**：凡是能由代码或上游数据源确定性算出的字段——时间戳、有效期、组件版本号、实体 ID、金额换算、财务公式结果——一律禁止让模型生成；模型只输出引用键（如 `countryTimeRef`、`template.name`、`fact.id`）。
- **真实证据**：
  - `scaffolds/plan-execute`：时间轴由 `resolve-time.ts` 从 `countryTimeRef` 推导，模板版本由 `page-build.ts` 的 `resolveFloorSetting` 从模块池匹配，Schema 与单测验证模型无需填版本号。
  - `finance`（`final.ts`）：`analyst` 只负责查数存 `facts.json`，ROA/ROAE 公式由纯代码 `compute()` 节点按键计算，彻底消除模型心算与口径漂移。
- **反例**：在 Prompt 里写「请根据活动时间推算 PDT 时间戳并填入 `offlineTime`」，或让模型在散文里自己算百分比。
- **确定性检查**：JSON Schema 不声明需由代码推导的字段；单测验证缺少这些字段的计划能被代码补全，且计算节点纯函数单测 100% 覆盖。

---

## C2：工具白名单双重约束

- **规则**：工具权限必须同时在**提示词侧**（System Prompt / frontmatter 声明工具清单）与**代码侧**（运行时 `allowedTools` 拦截）生效。即使模型幻觉出白名单外的工具名，执行层也必须直接拒绝并返回错误。
- **真实证据**：`scaffolds/plan-execute/src/orchestrator.ts` 的 `QUERY_ALLOWED_TOOLS` 与 `sdk-client.ts` 的 `executeToolCall` 硬校验，配合 `test/domains.test.ts` 与 `test/acceptance.test.ts` 的只读白名单单测。
- **反例**：只在 System Prompt 里写「请不要调用删除接口」，但代码把全量 MCP 工具暴露给了模型。
- **确定性检查**：单测构造一个调用白名单外工具的 mock LLM 响应，断言工具执行器返回拒绝错误且底层平台/MCP 调用次数为 0。

---

## C3：计划与执行分离

- **规则**：需要批量写入或强幂等的场景（L2），模型只产出结构化计划（纯数据，必须通过 JSON Schema / Zod 校验）；真正调用外部写接口的是纯代码执行器（支持并发、重试、幂等，不含任何 LLM 调用）。
- **真实证据**：`scaffolds/plan-execute/src/domains/build/executor.ts` 与 `schemas/plan.schema.json`，将 32 页搭建从逐一调模型（~60–120 min）降到 ~5–7 min。
- **反例**：在批量 `for` 循环的 executor 里塞入 LLM 调用，或在未过 Schema 校验前直接把模型文本解析后写入线上接口。
- **确定性检查**：静态检查执行器目录不含 LLM client import；Schema 校验单测覆盖必填项缺失、类型错误、非法枚举等负例。

---

## C4：验收由代码判定，模型只解释

- **规则**：任务的 `pass / fail` 必须由确定性代码判定（编译器退出码、真实 DOM/API 探针、平台状态核对、财务外部披露值对账）。Review / QA 模型只能读取代码判定结果，负责解释失败原因和给修复建议，**永远不能把代码的 `fail` 改判为 `pass`**。
- **真实证据**：
  - `scaffolds/plan-execute/src/orchestrator.ts`：`acceptance.ok === false` 时强制 `blocked` 覆盖 review 结论。
  - `Atoms`（`pipeline.ts`）：`hasProbeFailure(probe)`（真实浏览器 `compileErrors` / `runtimeErrors` / `blankScreen` + 后端 `tsc --noEmit` 沙箱）独立触发修复，不靠模型自评。
  - `finance`（`final.ts`）：`reconcile()` 用代码比对计算结果与年报披露值。
- **反例**：让同一个生成模型「检查一下刚才的代码有没有问题」，模型回复「一切正常」即放行。
- **确定性检查**：单测构造「代码验收失败 + mock Review 模型返回 `ok: true`」，断言最终输出仍为失败。

---

## C5：失败往安全侧兜底，只读单元显式拒写

- **规则**：路由失败、JSON 解析失败或返回未知域时，必须 fail-closed 兜底到只读路径，绝不兜底到创建/写入路径；所有只读域或只读节点在代码层显式抛错拒绝任何写入动作。
- **真实证据**：`scaffolds/plan-execute/src/orchestrator.ts` 中 `catalogRoute` 失败返回 `"qa"`，`src/domains/qa/executor.ts` 直接 `throw new Error("QA domain does not support batch execution")`。
- **反例**：路由异常时默认进入主业务写流程，或给只读查询助手「顺手」开放一个修改接口。
- **确定性检查**：单测与冒烟测试覆盖非法域输出、非 JSON 输出、网络异常三种情况，断言全部落入只读兜底；调用只读执行器断言抛错。

---

## C6：真值只有一条写入路径，额外 Agent 只献智不动手

- **规则**：任何事实库、状态表或外部业务系统的写入，全系统只能有**唯一一条受校验的写入通道**（如过 Schema 的 `save_fact` 或受控工具）。当系统引入额外智能体（如对账失败后叫来的 Pi、Claude Code 等外部工程手、审查 Agent）时，它们必须保持**只读**，只能输出结构化修正提议（JSON），由编排代码逐条走唯一校验通道落盘。
- **真实证据**：`finance` 原型 `final.ts` 中 `piOps` 曾给 Pi 开放 `bash,read,write,edit` 直接改写 `facts.json`，绕过了 `save_fact` 的 Zod 校验——这与「最不可信的排障时刻恰恰最不该无校验直写」相悖，因此在 ShipKeel 升级为强制契约 C6。
- **反例**：给排障 Agent 开目录写权限直接改数据库/事实文件，或多 Agent 并行写同一份共享产物。
- **确定性检查**：外部智能体调用参数中工具白名单不含写工具；单测验证外部提议中的非法字段会被唯一写入通道的 Schema 校验拦截并拒绝落盘。

---

## C7：修复与返工循环必有上限与无进展早停

- **规则**：任何生成-验证-修复（L1）或对账返工环（L3）或工具循环（L4），都必须同时具备两道刹车：① 硬性的最大轮次上限（如 `MAX_FIX_ROUNDS = 3`、`maxTurns`）；② **无进展提前停止**（当连续两轮的失败签名完全相同且无新进展时，立即终止并交给人或升级节点）。
- **真实证据**：`Atoms`（`pipeline.ts` L376–439）计算 `failureSignature`，连续两轮相同即 `stalled = true` 提前退出；`scaffolds/plan-execute/src/runtime/sdk-client.ts` 设 `MAX_TOOL_ROUNDS = 30`。
- **反例**：`while (!ok)` 无限重试，直到把 API 额度烧光或超时。
- **确定性检查**：离线单测模拟「持续返回同一错误」与「每次不同错误超过上限」，分别断言触发早停与上限退出，且实际调用次数不超过配置值。

---

## C8：三模式 Provider 与全离线测试

- **规则**：所有模型与外部平台接入层都应支持可注入的 `real`（真实服务）、`mock`（确定性剧本，供单测与 CI 冒烟）、`replay`（录制回放或只读降级）模式；仓库内的单测与冒烟测试必须 100% 离线运行，不依赖网络与真实 API Key。
- **真实证据**：`Atoms` 的 `gemini / mock / replay` 三模式及故障自动降级；`scaffolds/plan-execute` 的 `scripts/smoke-e2e.mjs` + `scripts/local/mock-llm.mjs` + `mock-platform-mcp.mjs`。
- **反例**：必须配置真实 OpenAI / Gemini Key 才能跑 `npm test`，导致 CI 无法覆盖主链路。
- **确定性检查**：在清空所有 `*_API_KEY` 环境变量且断网的条件下运行 `npm test` 与 `npm run smoke`，退出码必须为 0。

---

## C9：运行事件与产物外置落盘

- **规则**：每次运行必须将元信息、步骤状态、事件时间线与中间产物外置落盘（如 `state.json`、`trace.jsonl`、`artifacts/<step>.json` 或数据库事件表）。跨步骤交接遵循**传键不传值**原则：大文本、精确数值、图片/视频等二进制资产先落盘为结构化记录或 URI，下游按键读取，禁止在多轮对话里口头转述。
- **真实证据**：`scaffolds/plan-execute` 的 `pipeline-state.ts` + `trace.ts`；`Atoms` 的 `agent_events` 顺序表；`finance` 的 `facts.json` 事实键层。
- **反例**：把 50KB 网页 HTML 或长文档全文直接拼进下一轮 Prompt，或进程崩溃后没有任何可排查的运行记录。
- **确定性检查**：跑完一次离线冒烟后，断言运行目录下生成了元信息、追踪文件与结构化产物，且可被独立解析。

---

## C10：不可逆写操作前可插入人工审批点

- **规则**：凡是进入 L3（持久状态图）或涉及不可逆外部副作用（发送 BD 消息、提交报价、写 CRM、线上发布、资金/权限变更）的 Agent，架构上必须在写动作前支持**暂停（`interrupt`）→ 状态持久化（`checkpoint`）→ 人工审批后按 `thread_id` 续跑**，且写动作携带幂等键防重放。
- **真实证据**：`finance` 原型 `final.ts` 缺少 checkpointer 与 interrupt，崩了只能重头来过；未来的 BD 商家 Agent 与浏览器手操提交动作都需要跨小时/跨天等待人工拍板。
- **反例**：BD Agent 拼好话术后未经确认直接群发商家，或进程重启后把已发过的消息再发一遍。
- **确定性检查**：单测覆盖「执行到审批节点暂停 → 进程外重新加载 checkpoint → 人工批准后仅执行后续节点且不重复执行前置节点」。

---

## C11：严禁硬编码密钥、内网地址与内部标识

- **规则**：源码、配置文件、Prompt、测试夹具与文档中严禁出现明文 API Key、Token、公司内网域名或内部专有系统代号。所有外部凭证统一使用环境变量占位符（如 `{{PLATFORM_MCP_TOKEN}}`），并在运行时注入、日志中脱敏。
- **真实证据**：`.github/workflows/ci.yml` 的 `security` job 与 `scaffolds/plan-execute/src/runtime/run-context.ts` 的 `resolveTokenPlaceholders`。
- **反例**：在 `mcp.json` 里写死 `Bearer sk-...` 或在测试里粘贴内网接口域名。
- **确定性检查**：CI 与 ShipProof 门禁运行正则扫描，命中内网地址、内部标识或常见密钥前缀（`sk-` / `ghp_` / `gho_` / `xox*-`）立即返回非零退出码。
