#!/usr/bin/env node
/**
 * 构建后把静态资源（域定义 / 提示词 / schema / pipeline）复制到 dist/。
 *
 * 运行时用 `ASSETS_DIR = <module dir>/..` 定位资源，
 * 因此 src/ 与 dist/ 下都能找到同一套资产。
 */
import { cp, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const DIST = join(ROOT, "dist");

/** 需要整体复制的目录 */
const ASSET_DIRS = ["domains", "prompts"];

async function main() {
  if (!existsSync(DIST)) {
    await mkdir(DIST, { recursive: true });
  }

  for (const dir of ASSET_DIRS) {
    const from = join(SRC, dir);
    if (!existsSync(from)) {
      console.error(`[copy-assets] 缺少资源目录: ${from}`);
      process.exitCode = 1;
      continue;
    }
    await cp(from, join(DIST, dir), { recursive: true });
    const count = await countFiles(join(DIST, dir));
    console.log(`[copy-assets] ${dir} → dist/${dir}（${count} 个文件）`);
  }
}

async function countFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  let total = 0;
  for (const entry of entries) {
    if (entry.isDirectory()) {
      total += await countFiles(join(dir, entry.name));
    } else {
      total += 1;
    }
  }
  return total;
}

await main();
