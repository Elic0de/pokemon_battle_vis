#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]]; then
  echo "CLOUDFLARE_TUNNEL_TOKEN is required." >&2
  echo "Set it in your shell; do not save the token in this repository." >&2
  exit 1
fi

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared is not installed." >&2
  exit 1
fi

FRONTEND_URL="${FRIEND_BATTLE_FRONTEND_URL:-http://127.0.0.1:5173}"
API_URL="${FRIEND_BATTLE_API_URL:-http://127.0.0.1:5000/api/config}"

if ! curl --fail --silent --show-error --max-time 3 "$FRONTEND_URL" >/dev/null; then
  echo "Frontend is not reachable: $FRONTEND_URL" >&2
  echo "Start it with: cd web && pnpm dev" >&2
  exit 1
fi

if ! curl --fail --silent --show-error --max-time 3 "$API_URL" >/dev/null; then
  echo "API is not reachable: $API_URL" >&2
  echo "Start it with: python app.py" >&2
  exit 1
fi

echo "Starting Cloudflare Tunnel. Configure its Public Hostname service as: $FRONTEND_URL"
exec cloudflared tunnel --no-autoupdate run --token "$CLOUDFLARE_TUNNEL_TOKEN"
