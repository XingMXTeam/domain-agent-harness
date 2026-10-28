#!/bin/bash
# 沙箱入口。
#
# 沙箱以 root 运行，但部分 CLI 工具禁止 root 下 bypassPermissions。
# 这里创建普通用户并降权执行。
set -euo pipefail

if [ "$(id -u)" = "0" ]; then
  useradd -m harness 2>/dev/null || true
  chown -R harness:harness .
  exec su harness -c "cd $(pwd) && ./node_modules/.bin/tsx src/index.ts $*"
else
  exec tsx src/index.ts "$@"
fi
