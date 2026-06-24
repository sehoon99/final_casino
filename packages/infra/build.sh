#!/usr/bin/env bash
# Lambda 번들 빌드 스크립트 (Git Bash / WSL / macOS / Linux)
# 실행: bash packages/infra/build.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BACKEND="$ROOT/packages/backend"
INFRA="$ROOT/packages/infra"
OUT="$INFRA/dist"

echo "🔨 Cleaning dist..."
rm -rf "$OUT" && mkdir -p "$OUT"

# esbuild 설치 확인
if ! npx --yes esbuild --version >/dev/null 2>&1; then
  echo "❌ esbuild not found. Run: npm install -D esbuild"
  exit 1
fi

bundle() {
  local name="$1"
  local entry="$2"
  shift 2
  echo "  → $name"
  mkdir -p "$OUT/$name"
  npx esbuild "$entry" \
    --bundle \
    --platform=node \
    --target=node20 \
    --format=cjs \
    --outfile="$OUT/$name/index.js" \
    --external:aws-sdk \
    "$@"
  (cd "$OUT/$name" && zip -q "../$name.zip" index.js)
  rm -rf "$OUT/$name"
}

echo "📦 Bundling Lambda functions..."
bundle "connect"    "$BACKEND/functions/websocket/connect.ts"
bundle "disconnect" "$BACKEND/functions/websocket/disconnect.ts"
bundle "default"    "$BACKEND/functions/websocket/default.ts"
bundle "create"     "$BACKEND/functions/room/create.ts"
bundle "join"       "$BACKEND/functions/room/join.ts"
bundle "leave"      "$BACKEND/functions/room/leave.ts"
bundle "ttl-kick"   "$INFRA/ttl-kick/index.ts"
bundle "admin"      "$BACKEND/functions/room/admin.ts"
bundle "janitor"    "$BACKEND/functions/room/janitor.ts"
bundle "destroy"    "$BACKEND/functions/room/destroy.ts"
# @aws-sdk/client-cost-explorer은 Node 20 Lambda 런타임 내장 → 번들 제외
bundle "costs"      "$BACKEND/functions/room/costs.ts" "--external:@aws-sdk/client-cost-explorer"

echo ""
echo "✅ Build complete → packages/infra/dist/"
ls -lh "$OUT"/*.zip
