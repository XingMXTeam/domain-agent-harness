#!/usr/bin/env node
/**
 * CLI 入口。
 *
 * 用法：
 *   dah "<prompt>"                    自动路由（Catalog）
 *   dah --domain=qa "<prompt>"        指定域
 *   dah --list-domains                列出可用域
 */
import { orchestrate, DOMAIN_META, DOMAIN_CONFIGS } from "./orchestrator.js";

function printUsage(): void {
  console.log(`
  domain-agent-harness — 多域 Agent Harness

  用法:
    dah <prompt>                      自动路由（Catalog）
    dah --domain=<域> <prompt>        指定域
    dah --list-domains                列出可用域

  示例:
    dah "创建 618 大促"
    dah --domain=build "创建 618 大促"
    dah --domain=qa "查一下活动的页面结构"

  可用域: ${Object.keys(DOMAIN_META).join(" / ")}
`);
}

async function main(): Promise<void> {
  console.error(
    `[env] node=${process.version} platform=${process.platform} arch=${process.arch} cwd=${process.cwd()}`,
  );

  const args = process.argv.slice(2);

  if (args.includes("--list-domains")) {
    for (const [name, meta] of Object.entries(DOMAIN_META)) {
      const config = DOMAIN_CONFIGS[name];
      console.log(
        `${name.padEnd(8)} engine=${meta.engine.padEnd(9)} skills=${
          config?.validSkills.join(",") || "-"
        }${meta.singleSkill ? ` single=${meta.singleSkill}` : ""}`,
      );
    }
    return;
  }

  // 未指定域时保持 undefined，触发 Catalog 自动路由
  let domain: string | undefined = process.env.DAH_DOMAIN || undefined;
  const rest: string[] = [];

  for (const arg of args) {
    if (arg.startsWith("--domain=")) {
      domain = arg.split("=")[1];
    } else if (arg !== "--help" && arg !== "-h") {
      rest.push(arg);
    }
  }

  // CLI args 优先，沙箱环境走 USER_INPUT 环境变量
  const userPrompt = rest.join(" ") || process.env.USER_INPUT || "";

  if (args.includes("--help") || args.includes("-h") || !userPrompt) {
    printUsage();
    return;
  }

  await orchestrate(userPrompt, domain);
}

main().catch((err: unknown) => {
  console.error(`[fatal] ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exitCode = 1;
});
