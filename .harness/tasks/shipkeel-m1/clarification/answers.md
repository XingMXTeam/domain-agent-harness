# Clarification Answers — shipkeel-m1

User answers to Batch 1 (verbatim):

1. **包名与 CLI 命令名**: 根目录 package.json 改名为 shipkeel（private: true + npm workspaces）；scaffolds/plan-execute/ 命名为 @shipkeel/plan-execute，保留 bin: dah 兼容原有命令
2. **scaffolds/plan-execute/ 示例资产**: 全部保留（build / qa / gop 三个域 + knowledge/ + scripts/local/ mock + smoke-e2e），保证迁移后原有 demo、单测、冒烟 100% 离线可跑
3. **playbook/ 交付形态**: 纯 Markdown（playbook/ 决策树 + 模式积木 + 4 份案例拆解 + contracts/），M1 不引入前端构建链，保持仓库极简
4. **质量档位与红线 (Module 11)**: 生产工程级：红线为 ① 迁移后原有 typecheck/test/build/smoke/CI 校验 100% 全绿；② scaffolds/plan-execute 仍仅依赖 yaml；③ 零断链/旧路径残留/敏感词泄露；④ 契约和案例拆解直接引用真实代码证据、不写空话
