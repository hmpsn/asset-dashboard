#!/usr/bin/env bash
#
# Pull the newest Render backup directory to local storage.
# Supports:
#  - skipping download when the newest remote backup is unchanged
#  - pruning old local backup archives
#  - optionally copying dashboard.db into a local dev DB path
#
# Usage:
#   bash scripts/pull-render-latest-backup.sh
#
# Required setup:
#   - Render CLI installed and authenticated (`render login`)
#   - Access to the target service shell/SSH
#
# Optional env vars:
#   RENDER_SERVICE         default: asset-dashboard
#   REMOTE_BACKUP_ROOT     default: /var/data/asset-dashboard/backups
#   LOCAL_BACKUP_ROOT      default: $HOME/.asset-dashboard/render-backups
#   LOCAL_EXTRACT_ROOT     default: $LOCAL_BACKUP_ROOT/extracted
#   LOCAL_STATE_FILE       default: $LOCAL_BACKUP_ROOT/.last-remote-backup
#   KEEP_LOCAL             default: 7
#   FORCE_PULL             default: 0  (1 = always pull, even if unchanged)
#   EXTRACT_ARCHIVE        default: 1  (1 = untar archive locally)
#   LOCAL_DEV_DB_PATH      default: "" (if set, copy extracted dashboard.db here)
#   REMOTE_TMP_ARCHIVE     default: /tmp/render-latest-backup.tar.gz
#
set -euo pipefail

RENDER_SERVICE="${RENDER_SERVICE:-asset-dashboard}"
REMOTE_BACKUP_ROOT="${REMOTE_BACKUP_ROOT:-/var/data/asset-dashboard/backups}"
LOCAL_BACKUP_ROOT="${LOCAL_BACKUP_ROOT:-$HOME/.asset-dashboard/render-backups}"
LOCAL_EXTRACT_ROOT="${LOCAL_EXTRACT_ROOT:-$LOCAL_BACKUP_ROOT/extracted}"
LOCAL_STATE_FILE="${LOCAL_STATE_FILE:-$LOCAL_BACKUP_ROOT/.last-remote-backup}"
KEEP_LOCAL="${KEEP_LOCAL:-7}"
FORCE_PULL="${FORCE_PULL:-0}"
EXTRACT_ARCHIVE="${EXTRACT_ARCHIVE:-1}"
LOCAL_DEV_DB_PATH="${LOCAL_DEV_DB_PATH:-}"
REMOTE_TMP_ARCHIVE="${REMOTE_TMP_ARCHIVE:-/tmp/render-latest-backup.tar.gz}"

if ! command -v render >/dev/null 2>&1; then
  echo "Error: Render CLI not found. Install it and run 'render login' first."
  exit 1
fi

mkdir -p "$LOCAL_BACKUP_ROOT"
mkdir -p "$LOCAL_EXTRACT_ROOT"

echo "Checking newest backup on service '$RENDER_SERVICE'..."
latest_remote_backup="$(
  render ssh "$RENDER_SERVICE" --command "ls -1dt \"$REMOTE_BACKUP_ROOT\"/backup-* 2>/dev/null | head -n 1" \
    | tr -d '\r' \
    | grep '/backup-' \
    | tail -n 1 \
    | xargs
)"

if [[ -z "$latest_remote_backup" ]]; then
  echo "Error: no backup directories found under '$REMOTE_BACKUP_ROOT'."
  exit 1
fi

latest_backup_name="$(basename "$latest_remote_backup")"
if [[ "$latest_backup_name" != backup-* ]]; then
  echo "Error: unexpected backup name '$latest_backup_name'."
  exit 1
fi

if [[ "$FORCE_PULL" != "1" ]] && [[ -f "$LOCAL_STATE_FILE" ]]; then
  last_synced_backup="$(cat "$LOCAL_STATE_FILE")"
  if [[ "$last_synced_backup" == "$latest_backup_name" ]]; then
    echo "No change: newest backup is still '$latest_backup_name'."
    echo "Skipping download."
    exit 0
  fi
fi

echo "Creating remote archive for '$latest_backup_name'..."
render ssh "$RENDER_SERVICE" --command "tar -czf \"$REMOTE_TMP_ARCHIVE\" -C \"$REMOTE_BACKUP_ROOT\" \"$latest_backup_name\""

local_archive="$LOCAL_BACKUP_ROOT/${latest_backup_name}.tar.gz"
tmp_local_archive="${local_archive}.partial"

echo "Downloading archive to '$local_archive'..."
rm -f "$tmp_local_archive"
render scp "${RENDER_SERVICE}:${REMOTE_TMP_ARCHIVE}" "$tmp_local_archive"
mv "$tmp_local_archive" "$local_archive"

echo "Cleaning up remote temp archive..."
render ssh "$RENDER_SERVICE" --command "rm -f \"$REMOTE_TMP_ARCHIVE\""

echo "$latest_backup_name" > "$LOCAL_STATE_FILE"

if [[ "$EXTRACT_ARCHIVE" == "1" ]]; then
  extract_dir="$LOCAL_EXTRACT_ROOT/$latest_backup_name"
  rm -rf "$extract_dir"
  mkdir -p "$extract_dir"
  tar -xzf "$local_archive" -C "$extract_dir" --strip-components=1
  echo "Extracted to '$extract_dir'."

  if [[ -n "$LOCAL_DEV_DB_PATH" ]]; then
    src_db="$extract_dir/dashboard.db"
    if [[ ! -f "$src_db" ]]; then
      echo "Warning: '$src_db' not found. Skipping local DB refresh."
    else
      mkdir -p "$(dirname "$LOCAL_DEV_DB_PATH")"
      cp "$src_db" "$LOCAL_DEV_DB_PATH"
      echo "Updated local dev DB at '$LOCAL_DEV_DB_PATH'."
    fi
  fi
fi

if [[ "$KEEP_LOCAL" =~ ^[0-9]+$ ]] && (( KEEP_LOCAL > 0 )); then
  mapfile -t local_archives < <(ls -1t "$LOCAL_BACKUP_ROOT"/backup-*.tar.gz 2>/dev/null || true)
  if (( ${#local_archives[@]} > KEEP_LOCAL )); then
    echo "Pruning old local archives (keeping newest $KEEP_LOCAL)..."
    for (( i=KEEP_LOCAL; i<${#local_archives[@]}; i++ )); do
      rm -f "${local_archives[$i]}"
      old_name="$(basename "${local_archives[$i]}" .tar.gz)"
      rm -rf "$LOCAL_EXTRACT_ROOT/$old_name"
    done
  fi
fi

echo "Done. Pulled latest backup: '$latest_backup_name'."
