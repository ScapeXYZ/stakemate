#!/usr/bin/env bash
set -euo pipefail

slot="${1:?Usage: run-stakemate-mcp-slot.sh <local-slot>}"
case "$slot" in
  [a-z0-9][a-z0-9_-][a-z0-9_-]*) ;;
  *) echo "Invalid local MCP slot." >&2; exit 2 ;;
esac
: "${STAKEMATE_MCP_CONTEXT_DIRECTORY:?Protected MCP context directory is required}"
export STAKEMATE_MCP_AUTH_CONTEXT_FILE="$STAKEMATE_MCP_CONTEXT_DIRECTORY/$slot.json"
cd "$(dirname "$0")/.."
exec ./node_modules/.bin/tsx scripts/stakemate-mcp.ts
