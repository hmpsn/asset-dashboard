#!/usr/bin/env bash
#
# Pull a fresh SQLite DB export from the deployed app's admin endpoint.
# This avoids Render CLI SSH/SCP behavior changes and works well for local
# cadence sync jobs.
#
# Usage:
#   APP_PASSWORD=... bash scripts/pull-render-latest-backup.sh
#
# Optional env vars:
#   PROD_URL           default: https://insights.hmpsn.studio
#   LOCAL_BACKUP_ROOT  default: $HOME/.asset-dashboard/render-backups
#   LOCAL_STATE_FILE   default: $LOCAL_BACKUP_ROOT/.last-db-export-sha256
#   KEEP_LOCAL         default: 7
#   FORCE_PULL         default: 0  (1 = keep file even if hash unchanged)
#   LOCAL_DEV_DB_PATH  default: "" (if set, copy latest DB into this path)
#   AUTH_TOKEN         default: "" (if set, skips login step)
#
set -euo pipefail

PROD_URL="${PROD_URL:-https://insights.hmpsn.studio}"
APP_PASSWORD="${APP_PASSWORD:-}"
LOCAL_BACKUP_ROOT="${LOCAL_BACKUP_ROOT:-$HOME/.asset-dashboard/render-backups}"
LOCAL_STATE_FILE="${LOCAL_STATE_FILE:-$LOCAL_BACKUP_ROOT/.last-db-export-sha256}"
KEEP_LOCAL="${KEEP_LOCAL:-7}"
FORCE_PULL="${FORCE_PULL:-0}"
LOCAL_DEV_DB_PATH="${LOCAL_DEV_DB_PATH:-}"
AUTH_TOKEN="${AUTH_TOKEN:-}"

if [[ -z "$APP_PASSWORD" ]]; then
  echo "Error: APP_PASSWORD is required."
  echo "Usage: APP_PASSWORD=yourpassword npm run db:pull-render-backup"
  exit 1
fi

mkdir -p "$LOCAL_BACKUP_ROOT"

if [[ -z "$AUTH_TOKEN" ]]; then
  echo "Authenticating with $PROD_URL..."
  login_payload="$(node -e 'console.log(JSON.stringify({ password: process.env.APP_PASSWORD || "" }))')"
  login_body_file="$LOCAL_BACKUP_ROOT/.login-response.json"
  login_code="$(
    curl -sS \
      -H "Content-Type: application/json" \
      -d "$login_payload" \
      -o "$login_body_file" \
      -w "%{http_code}" \
      "$PROD_URL/api/auth/login"
  )"
  if [[ "$login_code" != "200" ]]; then
    rm -f "$login_body_file"
    echo "Error: login failed with HTTP $login_code."
    echo "Tip: verify APP_PASSWORD and PROD_URL."
    exit 1
  fi

  AUTH_TOKEN="$(
    node -e "const fs=require('fs');const raw=fs.readFileSync(process.argv[1],'utf8');const data=JSON.parse(raw);if(!data.token){process.exit(2)}process.stdout.write(String(data.token));" "$login_body_file" \
      || true
  )"
  rm -f "$login_body_file"
  if [[ -z "$AUTH_TOKEN" ]]; then
    echo "Error: login succeeded but no auth token returned."
    exit 1
  fi
fi

timestamp="$(date '+%Y-%m-%dT%H-%M-%S')"
tmp_file="$LOCAL_BACKUP_ROOT/render-db-export-${timestamp}.sqlite3.partial"
final_file="$LOCAL_BACKUP_ROOT/render-db-export-${timestamp}.sqlite3"

echo "Downloading DB export from $PROD_URL..."
http_code="$(
  curl -sS \
    -H "x-auth-token: $AUTH_TOKEN" \
    -H "Accept: application/octet-stream" \
    -o "$tmp_file" \
    -w "%{http_code}" \
    "$PROD_URL/api/admin/db-export"
)"

if [[ "$http_code" != "200" ]]; then
  rm -f "$tmp_file"
  echo "Error: export request failed with HTTP $http_code"
  exit 1
fi

if [[ ! -s "$tmp_file" ]]; then
  rm -f "$tmp_file"
  echo "Error: exported file is empty."
  exit 1
fi

sha256="$(shasum -a 256 "$tmp_file" | awk '{print $1}')"
last_sha=""
if [[ -f "$LOCAL_STATE_FILE" ]]; then
  last_sha="$(cat "$LOCAL_STATE_FILE")"
fi

if [[ "$FORCE_PULL" != "1" ]] && [[ -n "$last_sha" ]] && [[ "$sha256" == "$last_sha" ]]; then
  rm -f "$tmp_file"
  echo "No change: DB hash matches last pull ($sha256)."
  echo "Skipping local update."
  exit 0
fi

mv "$tmp_file" "$final_file"
echo "$sha256" > "$LOCAL_STATE_FILE"
echo "Saved: $final_file"

if [[ -n "$LOCAL_DEV_DB_PATH" ]]; then
  mkdir -p "$(dirname "$LOCAL_DEV_DB_PATH")"
  cp "$final_file" "$LOCAL_DEV_DB_PATH"
  echo "Updated local dev DB at '$LOCAL_DEV_DB_PATH'."
fi

if [[ "$KEEP_LOCAL" =~ ^[0-9]+$ ]] && (( KEEP_LOCAL > 0 )); then
  mapfile -t local_dbs < <(ls -1t "$LOCAL_BACKUP_ROOT"/render-db-export-*.sqlite3 2>/dev/null || true)
  if (( ${#local_dbs[@]} > KEEP_LOCAL )); then
    echo "Pruning old local exports (keeping newest $KEEP_LOCAL)..."
    for (( i=KEEP_LOCAL; i<${#local_dbs[@]}; i++ )); do
      rm -f "${local_dbs[$i]}"
    done
  fi
fi

echo "Done. Pulled DB export hash: $sha256"
