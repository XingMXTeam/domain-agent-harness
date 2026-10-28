/**
 * 路径解析。
 *
 * 源码运行（tsx src/index.ts）与构建产物运行（node dist/index.js）都要能工作，
 * 因此所有静态资源都相对于「本模块所在目录的上一级」解析：
 *   - src/runtime/paths.ts  → ASSETS_DIR = <root>/src
 *   - dist/runtime/paths.js → ASSETS_DIR = <root>/dist
 * 构建时由 scripts/copy-assets.mjs 把 src/domains、src/prompts 复制进 dist/。
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

/** 资源根目录：src/ 或 dist/ */
export const ASSETS_DIR = resolve(MODULE_DIR, "..");

/** 仓库根目录 */
export const PROJECT_ROOT = resolve(ASSETS_DIR, "..");

/** 域目录：src/domains/ */
export const DOMAINS_DIR = join(ASSETS_DIR, "domains");

/** 提示词目录：src/prompts/ */
export const PROMPTS_DIR = join(ASSETS_DIR, "prompts");

/** 运行产物根目录 */
export const RUNS_ROOT =
  process.env.DAH_RUNS_ROOT ?? join(PROJECT_ROOT, ".runs");

/** 取某个域的目录 */
export function getDomainDir(domain: string): string {
  return join(DOMAINS_DIR, domain);
}
