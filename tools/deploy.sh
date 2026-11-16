#!/usr/bin/env bash
# 一键把本仓库推到 GitHub，交给 Actions 自动构建并发布 Pages
#
# 用法：
#   bash tools/deploy.sh <GitHub用户名> [仓库名]
# 例：
#   bash tools/deploy.sh zhangsan
#   bash tools/deploy.sh zhangsan ganpo-fossils
#
# 前提：已在 GitHub 网页建好同名空仓库（Public，不要勾 README）
set -euo pipefail

GH_USER="${1:-}"
REPO="${2:-ganpo-fossils}"

if [ -z "$GH_USER" ]; then
  echo "用法：bash tools/deploy.sh <GitHub用户名> [仓库名]"
  echo "例：  bash tools/deploy.sh zhangsan"
  exit 1
fi

cd "$(dirname "$0")/.."
URL="https://github.com/${GH_USER}/${REPO}.git"

# 工作区必须干净：部署的是已提交的代码，不是本地半成品
if [ -n "$(git status --porcelain)" ]; then
  echo "⚠ 有未提交的改动，先处理再部署："
  git status --short
  echo ""
  echo "提交：git add -A && git commit -m \"改了什么\""
  exit 1
fi

if git remote get-url origin >/dev/null 2>&1; then
  echo "已存在 origin，改为：$URL"
  git remote set-url origin "$URL"
else
  git remote add origin "$URL"
  echo "已设置 origin → $URL"
fi

echo ""
echo "开始推送。首次会弹出 GitHub 登录窗口，按提示用浏览器授权即可。"
echo ""
git push -u origin main

echo ""
echo "✅ 代码已推送。还差三步（网页上点，一次就够）："
echo ""
echo "  1. 打开 https://github.com/${GH_USER}/${REPO}/settings/pages"
echo "  2. Source 选「GitHub Actions」（不要选 Deploy from a branch）"
echo "  3. 等 1–2 分钟，访问 https://${GH_USER}.github.io/${REPO}/"
echo ""
echo "⚠ 最后一件别忘：天地图控制台 → 该 key 的「域名白名单」加上 ${GH_USER}.github.io"
echo "   （不加的话，key 公开在源码里，可能被别人盗刷配额）"
