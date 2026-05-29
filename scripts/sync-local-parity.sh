#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CANON_DB="${HOME}/.asset-dashboard/dashboard.db"

if [[ "$ROOT_DIR" == *"/asset-dashboard-staging" ]]; then
  PEER_DIR="${ROOT_DIR%-staging}"
else
  PEER_DIR="${ROOT_DIR}-staging"
fi

if [[ ! -d "$PEER_DIR" ]]; then
  echo "Peer repo not found: $PEER_DIR"
  exit 1
fi

ENV_SOURCE="$ROOT_DIR/.env"
if [[ ! -f "$ENV_SOURCE" ]]; then
  ENV_SOURCE="$PEER_DIR/.env"
fi

if [[ ! -f "$ENV_SOURCE" ]]; then
  echo "No .env file found in either repo."
  exit 1
fi

for repo in "$ROOT_DIR" "$PEER_DIR"; do
  mkdir -p "$repo/data"
  TARGET_ENV="$repo/.env"
  if [[ "$ENV_SOURCE" != "$TARGET_ENV" ]]; then
    cp "$ENV_SOURCE" "$TARGET_ENV"
  fi
done

if [[ -f "$CANON_DB" ]]; then
  DB_SOURCE="$CANON_DB"
elif [[ -f "$ROOT_DIR/data/dashboard.db" ]]; then
  DB_SOURCE="$ROOT_DIR/data/dashboard.db"
else
  DB_SOURCE="$PEER_DIR/data/dashboard.db"
fi

if [[ ! -f "$DB_SOURCE" ]]; then
  echo "No dashboard.db source file found."
  exit 1
fi

for repo in "$ROOT_DIR" "$PEER_DIR"; do
  cp "$DB_SOURCE" "$repo/data/dashboard.db"
done

echo "Synced .env and dashboard.db across:"
echo "- $ROOT_DIR"
echo "- $PEER_DIR"
echo
shasum -a 256 "$ROOT_DIR/.env" "$PEER_DIR/.env" "$ROOT_DIR/data/dashboard.db" "$PEER_DIR/data/dashboard.db"
echo
sqlite3 "$ROOT_DIR/data/dashboard.db" "select count(*) as workspaces from workspaces;"
