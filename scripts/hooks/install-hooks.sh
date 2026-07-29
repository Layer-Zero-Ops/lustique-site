#!/usr/bin/env bash
set -euo pipefail
HOOK_DIR="$(git rev-parse --git-dir)/hooks"
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"

install() {
  local src="$1"
  local dst="$HOOK_DIR/$(basename "$src")"
  cp "$src" "$dst"
  chmod +x "$dst"
  echo "installed: $(basename "$src")"
}

install "$SRC_DIR/pre-push"

echo "Lustique git hooks installed. They are local-only; re-run this script after cloning."
