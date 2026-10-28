# Security Policy

## 支持的版本

| 版本 | 支持 |
|---|---|
| 0.1.x | ✅ |

## 报告漏洞

请**不要**用公开 issue 报告安全问题。

用 GitHub 的 [Private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) 提交，或直接联系维护者。

请在报告里包含：

- 受影响版本
- 复现步骤
- 影响范围（是否会导致越权写入、密钥泄露等）
- 已知缓解方案

我们会在 7 个工作日内给出初步回应。

## 安全设计

本项目在设计层面做了以下处理：

### 密钥不落盘

- 所有 API Key、Token 一律通过环境变量注入
- `mcp.json` 里的 `{{VAR}}` 占位符在运行时替换
- 解析后的 `mcp-config.json` 写在运行目录 `.runs/` 下，该目录已在 `.gitignore` 中
- CI 里有一条扫描规则，检测疑似硬编码密钥

### 只读域的只读保证

`qa` 域是纯只读域，两层约束：

1. 提示词里的工具表只含只读工具，并明确禁止 create / update / publish / submit
2. 代码侧 `allowedTools` 白名单硬拦截；`src/domains/qa/executor.ts` 直接抛错拒绝批量执行

### 路由失败往安全侧兜底

Catalog 路由失败、返回非法域或模型输出无法解析时，一律兜底到只读域 `qa`，不会退到创建域。

### 沙箱降权

`entrypoint.sh` 在 root 环境下创建普通用户并降权执行。

### 出网面

运行时只需要访问：

- 一个 LLM API 端点（Anthropic / OpenAI 兼容 / DashScope）
- 若干 MCP 服务端点

没有其它出网行为。HTTPS 客户端使用 Node 内置能力，不引入会偷偷带第三方 SDK 的依赖。

## 使用者需要注意的

- `mcp.json` 里的 URL 请指向你自己的服务；开源版本用的是占位地址 `https://mcp.example.com/...`
- `.runs/` 目录里会有完整的会话记录，可能包含业务数据。**不要**直接上传到 issue 或公开仓库
- 如果给多个用户共用一个实例，注意 `DAH_RUNS_ROOT` 的读写权限
