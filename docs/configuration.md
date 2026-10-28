# 配置

## 环境变量

### LLM Provider

| 变量 | 默认值 | 说明 |
|---|---|---|
| `LLM_PROVIDER` | `anthropic` | `anthropic` / `openai` / `dashscope` |
| `LLM_TIMEOUT_MS` | `600000` | 单次请求超时（毫秒） |
| `LLM_MAX_TOKENS` | `8192` | 单次响应上限 |
| `LLM_TEMPERATURE` | `0` | 采样温度 |

### Anthropic

| 变量 | 默认值 |
|---|---|
| `ANTHROPIC_API_KEY` | 必填 |
| `ANTHROPIC_BASE_URL` | `https://api.anthropic.com` |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-5` |

### OpenAI 兼容端点

也适用于 vLLM、Ollama、各类网关 —— 只要它实现 `/chat/completions`。

| 变量 | 默认值 |
|---|---|
| `OPENAI_API_KEY` | 必填 |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` |
| `OPENAI_MODEL` | `gpt-4o-mini` |

### DashScope（通义千问）

走 OpenAI 兼容模式。

| 变量 | 默认值 |
|---|---|
| `DASHSCOPE_API_KEY` | 必填 |
| `DASHSCOPE_BASE_URL` | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `DASHSCOPE_MODEL` | `qwen-plus` |

### MCP 服务的 Token

`mcp.json` 里的 `{{XXX}}` 占位符会被同名环境变量替换。

| 变量 | 用途 |
|---|---|
| `PLATFORM_MCP_TOKEN` | 活动搭建平台 |
| `LOCALE_MCP_TOKEN` | 多语言素材平台 |
| `CAMPAIGN_MCP_TOKEN` | 投放平台 |
| `KM_MCP_TOKEN` | 知识库 |

> 未设置的环境变量会被替换成空串，并在日志里告警。**不会**把字面量 `{{XXX}}` 写进磁盘上的 `mcp-config.json`。

### 运行时行为

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DAH_DOMAIN` | 空 | 强制指定域，等价于 `--domain=`；不设则走 Catalog 自动路由 |
| `DAH_RUNS_ROOT` | `./.runs` | 运行产物根目录 |
| `DAH_LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `DAH_MOCK_SELECTION_ID` | `39412075` | 选品失败时的兜底外层任务 ID |
| `USER_INPUT` | 空 | 沙箱模式下由外部注入的用户输入 |

---

## MCP 配置

每个域有一份 `mcp.json`，位置 `src/domains/<域>/mcp.json`：

```json
{
  "mcpServers": {
    "platform": {
      "type": "http",
      "url": "https://mcp.example.com/platform/mcp",
      "headers": {
        "PRIVATE-TOKEN": "{{PLATFORM_MCP_TOKEN}}"
      }
    }
  }
}
```

运行时会被复制到 `<runDir>/mcp-config.json`（占位符已替换）。

支持两种传输：

- `http` —— Streamable HTTP（`url` + `headers`）
- `stdio` —— 本地进程（`command` + `args` + `env`）

工具名统一为 `mcp__<server>__<tool>`，例如：

```
mcp__platform__scene_getList
mcp__locale__locale_getTextInfo
```

---

## 工具白名单

白名单在两处生效，**必须同时维护**：

1. **代码侧** —— `src/orchestrator.ts` 的 `QUERY_ALLOWED_TOOLS`
2. **提示词侧** —— `src/domains/<域>/skills/query/spec.md` 的工具表

代码侧是硬约束：模型请求白名单外的工具不会被执行。提示词侧是软引导：让模型知道有哪些工具可用、少绕弯路。

新增只读工具时，两边都要加。

---

## 日志与产物

| 流 | 内容 |
|---|---|
| stderr | 人读日志（`log` / `logError` / `logWarn` / `logDebug`） |
| stdout | 结构化进度（JSON Lines，`{"type":"progress",...}`） |
| `.runs/<runId>/trace.jsonl` | 链路追踪 |
| `.runs/<runId>/sessions/*.json` | 每次 LLM 会话的完整记录 |

生产环境建议把 stdout 单独接走消费，stderr 接日志系统。

---

## 沙箱运行

`entrypoint.sh` 处理降权：

```bash
#!/bin/bash
# 沙箱以 root 运行，但某些 CLI 工具禁止 root 下 bypassPermissions。
# 创建普通用户并降权执行。
if [ "$(id -u)" = "0" ]; then
  useradd -m harness 2>/dev/null || true
  chown -R harness:harness .
  exec su harness -c "cd $(pwd) && ./node_modules/.bin/tsx src/index.ts $*"
else
  exec tsx src/index.ts "$@"
fi
```

配合 `USER_INPUT` 环境变量，可以在没有 TTY 的调度器里直接喂输入。
