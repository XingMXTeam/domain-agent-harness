# AGENTS.md — ShipKeel

> 面向 AI 编码助手的仓库工作说明。人类贡献者请看 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 这是什么

**ShipKeel**：做任何 Agent 之前先定下的龙骨 —— 五级范式决策树（`playbook/`）+ 与语言无关的通用契约（`contracts/`）+ 按范式分的起步脚手架（`scaffolds/*`）。

各脚手架的局部约束与依赖预算见各自目录下的 `AGENTS.md`（例如 [scaffolds/plan-execute/AGENTS.md](scaffolds/plan-execute/AGENTS.md)）。

## 常用命令（根目录）

```bash
npm run typecheck     # 全 workspace 类型检查
npm test              # 全 workspace 离线单测（node:test）
npm run build         # 全 workspace 构建与静态资产复制
npm run smoke         # 离线 E2E 冒烟测试（mock LLM + mock MCP）
npm run list-domains  # 校验 CLI 入口
npm run verify        # 以上 5 项串联
```

改完代码必须跑完 `npm run verify`（或 `fh verify`）再提交。

## 全仓通用契约（C1–C11，所有脚手架与未来项目共同遵守）

完整细则与确定性检查方法见 [contracts/universal-contracts.md](contracts/universal-contracts.md)：

1. **C1 确定性的值由代码推导**：时间、版本号、ID、金额、公式结果不让模型产出，模型只给引用键。
2. **C2 工具白名单双重约束**：提示词侧声明与代码侧 `allowedTools` 拦截必须同步。
3. **C3 计划与执行分离**：批量写场景下计划是过 Schema 的纯数据，执行是不含 LLM 调用的纯代码。
4. **C4 验收由代码判定**：pass / fail 由确定性代码/探针裁决，模型只解释原因，不能改判。
5. **C5 失败往安全侧兜底，只读显式拒写**：路由失败落只读路径；只读执行器显式抛错拒绝写操作。
6. **C6 真值只有一条写入路径**：额外 Agent（排障/审查）只读输出结构化提议，经唯一校验路径写入。
7. **C7 循环必有上限与无进展早停**：修复/返工/工具循环须设最大轮次，连续相同失败签名提前终止。
8. **C8 三模式 Provider 与全离线测试**：支持 `real / mock / replay`；单测与冒烟测试不依赖网络或真实 Key。
9. **C9 运行事件与产物外置落盘**：落盘状态、事件流与中间产物；大文本/精确数值/二进制传键不传值。
10. **C10 不可逆写操作前可插入人工审批点**：L3+ 与外发写动作支持 `interrupt` 暂停与 `checkpoint` 续跑。
11. **C11 严禁硬编码密钥、内网地址与内部标识**：凭证统一用 `{{ENV_VAR}}` 占位符，不把 `dist/` 提交进 git。

## 目录约定

```text
playbook/               五级范式决策树、模式积木、框架选型、案例拆解（纯 Markdown）
contracts/              通用契约 C1–C11 细则与检查方法（纯 Markdown）
scaffolds/<paradigm>/   按范式分的独立起步脚手架（各自维护 package.json 与局部 AGENTS.md）
.harness/ & .agents/    ShipProof 交付验真体系与 27 份 Skills
```

- 根目录 `package.json` 保持 `private: true` 且**零运行时依赖**；各脚手架在自身 `AGENTS.md` 中声明各自的依赖预算。
- TypeScript 保持 `strict` + `noUncheckedIndexedAccess`；库代码不直接 `console.log`。

<!-- frontend-harness:start -->
## Feature work runs under frontend-harness

- For any feature work, first run `fh` (= `fh next`) and do exactly the action it returns.
- Start a feature with `fh new <name>` (or `fh new <name> --prd <file>`); it becomes the current feature.
- When a step is finished, run `fh done` — it records the right thing for the current phase
  (clarify, task, remediation, replan) and rejects work that has not earned it.
- Never edit `.harness/tasks/*/state.json` by hand, and never declare a feature done yourself:
  only a passing `fh eval` plus the delivery gate can set done.
- "Tests pass" is evidence only as a recorded `fh verify` run; cite its ids, never describe a run.
- After a feature is done, run `fh learn` and show the user any proposal; adopt only with their yes.
- Ask the user only at the clarify confirmation and when the harness pauses.
<!-- frontend-harness:end -->
