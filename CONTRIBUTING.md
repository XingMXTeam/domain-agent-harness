# Contributing

感谢你愿意参与这个项目。

## 开发环境

- Node.js >= 20.10
- npm >= 10

```bash
npm install
npm run typecheck
npm test
```

测试全部离线运行，**不需要**任何 API Key 或外部服务。

## 提交前检查清单

- [ ] `npm run typecheck` 通过
- [ ] `npm test` 通过
- [ ] `npm run build` 通过，且 `dist/` 里包含域资产
- [ ] 新增逻辑有对应测试
- [ ] 没有把密钥、内网地址、内部标识写进源码或配置
- [ ] 改动过的提示词（`*.md`）同步更新了对应的 schema

## 架构红线

这几条是整个框架的地基，改动前请先读 [`docs/architecture.md`](docs/architecture.md)：

1. **模型不产出时间值** —— 时间由 executor 从 `countryTimeRef` 推导。
   新增字段时不要在提示词里让模型填时间。
2. **版本由代码匹配** —— `template.version` 由模块池自动匹配，不要让模型写版本号。
3. **工具白名单双重约束** —— 提示词侧的工具表和代码侧的 `allowedTools` 要同步改。
4. **计划与执行分离** —— 计划是纯数据（要过 schema），执行是纯代码（可并发、可重试）。
5. **只读域不许写** —— `qa` 域的 executor 必须显式拒绝批量执行。

改动违反以上任何一条的 PR 会被要求修改。

## 代码风格

- TypeScript strict 模式，`noUncheckedIndexedAccess` 开启
- 标识符、注释用英文；面向用户的文档用中文
- 优先写纯函数并配单元测试；需要 I/O 的部分留出注入点
- 不引入运行时重依赖。当前运行时只依赖 `yaml`

## 提交信息

用祈使句描述改动，一行以内说明「做了什么」，正文说明「为什么」。

```
fix(build): 排期写入前补齐缺失的 locale 排期

平台侧 locale 排期可能不存在，直接写入会失败。
现在由 executor 自动注入空 contentData，模型不需要关心。
```

## 新增一个域

见 [`docs/domains.md`](docs/domains.md) 的「新增一个域」。注意 `catalog.md` 的判断规则是严格按顺序匹配的，新域规则的位置很重要。

## Issue

提 issue 时请附上：

- 用的哪个域、哪个 skill
- 完整的 `userPrompt`
- `.runs/<runId>/trace.jsonl` 与 `.runs/<runId>/sessions/*.json`
- 版本（`git rev-parse HEAD`）

**注意：这些文件里可能包含业务数据，贴之前先脱敏。**
